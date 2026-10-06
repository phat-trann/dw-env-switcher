import { retryUploadOperation, UploadHttpError } from './retry';
import { randomUUID } from 'crypto';
import { createUploadArchive } from './archive';
import { DEFAULT_UPLOAD_CONCURRENCY, resolveUploadConcurrency, compileUploadIgnore, ignoredUploadPath } from './config';
import * as fs from 'fs';
import * as path from 'path';
import { UploadQueue } from './queue';
import { DavTransport, UploadCanceled } from './client';

export interface UploadCartridge { name: string; root: string; layout?: 'modules'; }
export interface UploadStatus { state: 'watching' | 'uploading' | 'failed'; completed: number; total: number; cartridgesCompleted?: number; cartridgesTotal?: number; }
export function eligibleUploadPath(relative: string, ignore = compileUploadIgnore(), rootFiles = false): boolean {
    const parts = relative.split(/[\\/]/);
    if (parts.some(part => !part || part === '..' || part === '.' || part.startsWith('.'))) return relative === '.project' && !ignoredUploadPath(relative, ignore);
    if (rootFiles && ['dw.json', 'dw.js', 'dw-manager.json', 'dw-envs.json'].includes(parts[0].toLowerCase())) return false;
    return (rootFiles || parts[0] === 'cartridge' || relative === '.project') && !ignoredUploadPath(relative, ignore);
}

/** Bound to one immutable target and explicit local roots. Never cleans remote cartridges. */
export class UploadEngine {
    private stopped = false;
    private archiveAbort = new AbortController();
    private versionCheck?: Promise<void>;
    private directories = new Map<string, Promise<void>>();
    private queue: UploadQueue;
    private batch?: Promise<void>;
    private watchTotal = 0;
    private watchCompleted = 0;
    private ignore: RegExp[];
    constructor(readonly cartridges: UploadCartridge[], private client: DavTransport, private status: (status: UploadStatus) => void, private log: (message: string) => void = () => {}, private concurrency = DEFAULT_UPLOAD_CONCURRENCY, ignore?: string[]) {
        this.ignore = compileUploadIgnore(ignore);
        resolveUploadConcurrency({ concurrency });
        this.queue = new UploadQueue(concurrency);
        if (!cartridges.length || cartridges.some(c => !/^[a-z0-9_.-]+$/i.test(c.name) || ['.', '..'].includes(c.name))) throw new Error('Choose valid cartridges to upload.');
    }
    private checkStopped(): void { if (this.stopped) throw new UploadCanceled(); }
    private async checkVersion(): Promise<void> {
        this.checkStopped();
        this.versionCheck ??= (async () => {
            const code = await this.client.request('PROPFIND', []); this.checkStopped();
            if (![200, 207].includes(code)) throw new Error(`Code version is unavailable or WebDAV access failed (HTTP ${code}).`);
            this.log('Code version validated.');
        })();
        await this.versionCheck;
    }
    private async directory(segments: string[]): Promise<void> {
        if (!segments.length) return;
        const key = segments.join('/');
        let pending = this.directories.get(key);
        if (!pending) {
            pending = (async () => {
                await this.directory(segments.slice(0, -1)); this.checkStopped();
                const code = await this.client.request('MKCOL', segments);
                if (code !== 201 && code !== 405) throw this.httpError('MKCOL', segments, code);
                if (code === 405) {
                    const exists = await this.client.request('PROPFIND', segments);
                    if (![200, 207].includes(exists)) throw new Error(`Upload directory is unavailable (HTTP ${exists}).`);
                }
            })();
            this.directories.set(key, pending);
        }
        await pending;
    }
    private local(cartridge: UploadCartridge, filename: string): { relative: string; segments: string[] } | undefined {
        const relative = path.relative(cartridge.root, filename);
        if (!eligibleUploadPath(relative, this.ignore, cartridge.layout === 'modules') || path.isAbsolute(relative)) return;
        // Reject symlink components, including links whose destinations are inside the cartridge.
        let cursor = cartridge.root;
        if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Symlink cartridge roots cannot be uploaded.');
        for (const part of relative.split(path.sep)) {
            cursor = path.join(cursor, part);
            try { if (fs.lstatSync(cursor).isSymbolicLink()) return; }
            catch (error: any) { if (error.code !== 'ENOENT') throw error; }
        }
        return { relative, segments: [cartridge.name, ...relative.split(path.sep)] };
    }
    private files(directory: string, root = directory): string[] {
        const result: string[] = [];
        if (fs.lstatSync(directory).isSymbolicLink()) return result;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isSymbolicLink() || (entry.name.startsWith('.') && entry.name !== '.project')) continue;
            if (ignoredUploadPath(path.relative(root, filename), this.ignore)) continue;
            if (entry.isDirectory()) result.push(...this.files(filename, root));
            else if (entry.isFile()) result.push(filename);
        }
        return result;
    }
    private async put(cartridge: UploadCartridge, filename: string): Promise<void> {
        this.checkStopped(); const item = this.local(cartridge, filename); if (!item) return;
        let stat: fs.Stats;
        try { stat = fs.lstatSync(filename); } catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
        if (stat.isDirectory()) { await this.directory(item.segments); return; }
        if (!stat.isFile()) return;
        await this.checkVersion(); await this.directory(item.segments.slice(0, -1)); this.checkStopped();
        const content = await fs.promises.readFile(filename); this.checkStopped();
        const code = await this.client.request('PUT', item.segments, content);
        this.checkStopped();
        if (![200, 201, 204].includes(code)) throw this.httpError('PUT', item.segments, code);
        this.log(`[U] ${item.segments.join('/')}`);
    }
    private schedule(key: string, action: () => Promise<void>): Promise<void> {
        return this.queue.run(key, async () => {
            try { this.checkStopped(); await action(); this.checkStopped(); }
            catch (error) { this.dispose(); throw error; }
        });
    }
    private httpError(method: string, segments: string[], code: number): Error {
        return new UploadHttpError(`${method} ${segments.join('/') || '[code version]'} failed (HTTP ${code}).${code === 403 ? ' Server denied this operation; check WebDAV permissions, target code version restrictions and sandbox security rules.' : ''}`, code);
    }
    private async uploadCartridgeZip(cartridge: UploadCartridge): Promise<void> {
        this.checkStopped();
        const files = (cartridge.layout === 'modules' ? this.files(cartridge.root, cartridge.root) : [path.join(cartridge.root, '.project'), ...this.files(path.join(cartridge.root, 'cartridge'), cartridge.root)])
            .filter(file => fs.existsSync(file) && fs.lstatSync(file).isFile() && this.local(cartridge, file));
        if (!files.length) { this.log(`[${cartridge.name}] No eligible files; skipped.`); return; }
        this.log(`[${cartridge.name}] Zipping ${files.length} files.`);
        const archive = await createUploadArchive(files.map(filename => ({ filename, name: this.local(cartridge, filename)!.segments.join('/') })), this.archiveAbort.signal);
        const remote = [`dw-manager-${cartridge.name}-${randomUUID()}.zip`];
        let attempted = false, deleted = false;
        try {
            const run = (action: () => Promise<void>) => retryUploadOperation(action, this.archiveAbort.signal,
                (retry, error) => this.log(`[${cartridge.name}] ${error.message} Retry ${retry}/3.`));
            await run(async () => {
                this.checkStopped();
                this.log(`[${cartridge.name}] Sending ZIP to remote.`); attempted = true;
                const stream = fs.createReadStream(archive.filename);
                stream.on('error', () => {});
                let code: number;
                try { code = await this.client.request('PUT', remote, stream, { contentType: 'application/zip', contentLength: fs.statSync(archive.filename).size, timeoutMs: 300000 }); }
                finally {
                    const closed = new Promise<void>(resolve => { if (stream.closed) resolve(); else stream.once('close', resolve); });
                    stream.destroy(); await closed;
                }
                this.checkStopped();
                if (![200, 201, 204].includes(code)) throw this.httpError('PUT ZIP', remote, code);
            });
            await run(async () => {
                this.log(`[${cartridge.name}] Unzipping remote ZIP (preserving remote-only files).`);
                const code = await this.client.request('POST', remote, Buffer.from('method=UNZIP'), { contentType: 'application/x-www-form-urlencoded', timeoutMs: 300000 });
                this.checkStopped();
                if (![200, 201, 204].includes(code)) throw this.httpError('UNZIP', remote, code);
            });
            await run(async () => {
                this.log(`[${cartridge.name}] Deleting remote ZIP.`);
                const code = await this.client.request('DELETE', remote); this.checkStopped();
                if (![200, 204, 404].includes(code)) throw this.httpError('DELETE ZIP', remote, code);
            });
            deleted = true;
            this.log(`[${cartridge.name}] Upload complete.`);
        } finally {
            archive.dispose();
            // Only the ZIP owned by this attempt; reconnect even after the main session was aborted.
            if (attempted && !deleted) {
                try {
                    const code = this.client.cleanupZip ? await this.client.cleanupZip(remote) : !this.stopped ? await this.client.request('DELETE', remote) : undefined;
                    if (code === undefined || ![200, 204, 404].includes(code)) this.log(`Warning: temporary ZIP may remain${code === undefined ? '' : ` (HTTP ${code})`}: ${remote[0]}`);
                    else this.log(`[${cartridge.name}] Interrupted upload ZIP cleaned up.`);
                } catch { this.log(`Warning: temporary ZIP may remain: ${remote[0]}`); }
            }
        }
    }
    uploadAll(): Promise<void> {
        const previous = this.batch;
        const batch = (async () => {
            if (previous) await previous;
            await this.queue.idle(); this.checkStopped();
            const started = Date.now(); this.log(`Starting Upload All via ZIP (${this.concurrency} parallel cartridges).`);
            await this.checkVersion();
            let completed = 0, next = 0;
            let failure: unknown;
            const report = (state: UploadStatus['state']) => this.status({ state, completed, total: this.cartridges.length, cartridgesCompleted: completed, cartridgesTotal: this.cartridges.length });
            report('uploading');
            const worker = async () => {
                while (next < this.cartridges.length && !this.stopped) {
                    const cartridge = this.cartridges[next++];
                    try {
                        await this.schedule(cartridge.name, () => this.uploadCartridgeZip(cartridge));
                        completed++; report('uploading');
                    } catch (error) { if (!failure || !(error instanceof UploadCanceled)) failure = error; throw error; }
                }
            };
            await Promise.allSettled(Array.from({ length: Math.min(this.concurrency, this.cartridges.length) }, worker));
            if (failure) throw failure;
            this.checkStopped(); report('watching');
            this.log(`Upload complete: ${completed} cartridges in ${((Date.now() - started) / 1000).toFixed(1)}s. Watching files.`);
        })();
        this.batch = batch;
        void batch.then(() => { if (this.batch === batch) this.batch = undefined; }, () => { if (this.batch === batch) this.batch = undefined; this.dispose(); });
        return batch;
    }
    async change(cartridge: UploadCartridge, filename: string, deleted = false): Promise<void> {
        if (!this.cartridges.some(entry => entry.name === cartridge.name && entry.root === cartridge.root)) throw new Error('Cartridge is outside the upload scope.');
        const item = this.local(cartridge, filename); if (!item) return;
        const batch = this.batch; if (batch) await batch;
        this.checkStopped();
        this.watchTotal++; this.status({ state: 'uploading', completed: this.watchCompleted, total: this.watchTotal });
        await this.schedule(item.segments.join('/'), async () => {
            await this.checkVersion();
            if (deleted) {
                const code = await this.client.request('DELETE', item.segments);
                if (![200, 204, 404].includes(code)) throw this.httpError('DELETE', item.segments, code);
                this.checkStopped(); this.directories.clear(); this.log(`[D] ${item.segments.join('/')}${code === 404 ? ' (already absent)' : ''}`);
            } else {
                const stat = fs.existsSync(filename) ? fs.lstatSync(filename) : undefined;
                if (stat?.isDirectory()) for (const file of this.files(filename, cartridge.root)) await this.put(cartridge, file);
                else await this.put(cartridge, filename);
            }
        });
        this.watchCompleted++;
        if (this.watchCompleted === this.watchTotal) {
            this.status({ state: 'watching', completed: this.watchCompleted, total: this.watchTotal });
            this.watchCompleted = 0; this.watchTotal = 0;
        } else this.status({ state: 'uploading', completed: this.watchCompleted, total: this.watchTotal });
    }
    dispose(): void { this.stopped = true; this.archiveAbort.abort(); this.queue.dispose(); this.client.dispose(); }
}
