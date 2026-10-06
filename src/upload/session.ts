import { DEFAULT_UPLOAD_CONCURRENCY, resolveUploadConcurrency, UploadSettings, resolveUploadSettings, compileUploadIgnore } from './config';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { discoverCartridgeRoots, isDemandwareProjectXml } from '../cartridges/discovery';
import { ActiveConfig } from '../types';
import { UploadClient, UploadCanceled } from './client';
import { UploadCartridge, UploadEngine, UploadStatus, eligibleUploadPath } from './engine';

/** Prophet adds SFRA modules to its default Site scope without persisting a path change. */
export function uploadCartridgeNames(cartridgesPath: string): string[] {
    const names = [...new Set(cartridgesPath.split(':').filter(Boolean))];
    if (names.length && !names.includes('modules')) names.push('modules');
    return names;
}
function modulesRoot(root: string): boolean {
    try {
        const project = path.join(root, '.project');
        return path.basename(root) === 'modules' && !fs.lstatSync(project).isSymbolicLink() && fs.statSync(project).isFile() && isDemandwareProjectXml(fs.readFileSync(project, 'utf8'));
    } catch { return false; }
}
export interface DuplicateUploadRoot { name: string; kept: string; skipped: string[]; }
export async function resolveUploadCartridges(workspaceRoot: string, names: string[], missing: (name: string) => void = () => {}, duplicate: (entry: DuplicateUploadRoot) => void = () => {}): Promise<UploadCartridge[]> {
    const boundary = fs.realpathSync(workspaceRoot);
    // Prophet deduplicates the parents of valid .project files in discovery order.
    // Keep that order ahead of our supplemental bare-folder discovery.
    const roots: string[] = [];
    if (typeof vscode.workspace.findFiles === 'function') {
        // Match Prophet's folder-scoped include/exclude query, without a result cap.
        // A workspace-wide glob can return the same files in a different order.
        const projects = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceRoot, '**/.project'),
            new vscode.RelativePattern(workspaceRoot, '**/{node_modules,.git}/**'));
        for (const project of projects) {
            try {
                if (!fs.lstatSync(project.fsPath).isSymbolicLink() && isDemandwareProjectXml(fs.readFileSync(project.fsPath, 'utf8'))) roots.push(path.dirname(project.fsPath));
            } catch { /* Unreadable/disappearing projects cannot become upload roots. */ }
        }
    }
    roots.push(...await discoverCartridgeRoots(workspaceRoot));
    // The Company layout also has immediate repositories with cartridges/<name>.
    for (const entry of fs.readdirSync(boundary, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const base = path.join(boundary, entry.name);
        if (fs.existsSync(path.join(base, 'cartridge')) || modulesRoot(base)) roots.push(base);
        const cartridges = path.join(base, 'cartridges');
        if (fs.existsSync(cartridges) && !fs.lstatSync(cartridges).isSymbolicLink() && fs.statSync(cartridges).isDirectory()) {
            for (const child of fs.readdirSync(cartridges, { withFileTypes: true })) if (child.isDirectory()) roots.push(path.join(cartridges, child.name));
        }
    }
    const normalizedRoots = roots.map(root => {
        const relative = path.relative(path.resolve(workspaceRoot), root);
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? path.join(boundary, relative) : root;
    });
    return [...new Set(names)].flatMap(name => {
        if (!/^[a-z0-9_.-]+$/i.test(name) || ['.', '..'].includes(name)) throw new Error('Invalid Site cartridge name.');
        const candidates = [...new Set(normalizedRoots.filter(root => path.basename(root) === name))].filter(root => {
            const relative = path.relative(boundary, root);
            const realRelative = path.relative(boundary, fs.realpathSync(root));
            return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) &&
                realRelative === relative && !fs.lstatSync(root).isSymbolicLink() && (modulesRoot(root) || (fs.existsSync(path.join(root, 'cartridge')) && !fs.lstatSync(path.join(root, 'cartridge')).isSymbolicLink() && fs.statSync(path.join(root, 'cartridge')).isDirectory()));
        });
        if (!candidates.length) { missing(name); return []; }
        if (candidates.length > 1) duplicate({ name, kept: candidates[0], skipped: candidates.slice(1) });
        return [{ name, root: candidates[0], ...(name === 'modules' && modulesRoot(candidates[0]) ? { layout: 'modules' as const } : {}) }];
    });
}

export class UploadSession implements vscode.Disposable {
    private engine: UploadEngine;
    private watchers: vscode.Disposable[] = [];
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private stopped = false;
    private ignore: RegExp[];
    private watchDebounceMs: number;
    constructor(active: ActiveConfig, cartridges: UploadCartridge[], status: (status: UploadStatus) => void, private failed: (message: string) => void, log: (message: string) => void = () => {}, concurrency = DEFAULT_UPLOAD_CONCURRENCY, settings?: UploadSettings) {
        const resolved = resolveUploadSettings(settings);
        this.ignore = compileUploadIgnore(resolved.ignore); this.watchDebounceMs = resolved.watchDebounceMs;
        resolveUploadConcurrency({ concurrency });
        this.engine = new UploadEngine(cartridges, new UploadClient({ ...active }, concurrency), status, log, concurrency, resolved.ignore);
        try {
            for (const cartridge of cartridges) {
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(cartridge.root, '**/*'));
                this.watchers.push(watcher,
                    watcher.onDidChange(uri => this.changed(cartridge, uri)),
                    watcher.onDidCreate(uri => this.changed(cartridge, uri)),
                    watcher.onDidDelete(uri => this.changed(cartridge, uri, true)));
            }
        } catch (error) { this.dispose(); throw error; }
    }
    private changed(cartridge: UploadCartridge, uri: vscode.Uri, deleted = false): void {
        if (this.stopped || uri.scheme !== 'file' || !eligibleUploadPath(path.relative(cartridge.root, uri.fsPath), this.ignore, cartridge.layout === 'modules')) return;
        const key = uri.fsPath; const previous = this.timers.get(key); if (previous) clearTimeout(previous);
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            void this.engine.change(cartridge, uri.fsPath, deleted).catch(error => {
                if (this.stopped || error instanceof UploadCanceled) return;
                this.dispose(); this.failed(error instanceof Error ? error.message : 'Upload failed.');
            });
        }, this.watchDebounceMs));
    }
    uploadAll(): Promise<void> { return this.engine.uploadAll(); }
    dispose(): void { this.stopped = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.watchers.forEach(watcher => watcher.dispose()); this.watchers = []; this.engine.dispose(); }
}
