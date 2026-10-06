import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UploadCanceled } from './client';
const archiver = require('archiver');

export interface ArchiveEntry { filename: string; name: string; }
/** Disk-backed ZIP keeps large batches out of memory; always remove its private temp directory. */
export async function createUploadArchive(entries: ArchiveEntry[], signal: AbortSignal): Promise<{ filename: string; dispose(): void }> {
    if (signal.aborted) throw new UploadCanceled();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-manager-upload-'));
    const filename = path.join(directory, 'cartridge.zip');
    const output = fs.createWriteStream(filename, { mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 1 } });
    try {
        await new Promise<void>((resolve, reject) => {
            const cancel = () => { archive.abort(); output.destroy(); reject(new UploadCanceled()); };
            signal.addEventListener('abort', cancel, { once: true });
            const finish = (error?: unknown) => {
                signal.removeEventListener('abort', cancel);
                if (error) { archive.abort(); output.destroy(); reject(new Error('Cannot create upload ZIP.')); }
                else resolve();
            };
            output.once('close', () => { if (!signal.aborted) finish(); });
            output.once('error', finish); archive.once('error', finish);
            archive.once('warning', finish); // Missing files must not silently produce an incomplete cartridge.
            archive.pipe(output);
            for (const entry of entries) archive.file(entry.filename, { name: entry.name });
            void archive.finalize().catch(finish);
        });
        if (signal.aborted) throw new UploadCanceled();
        return { filename, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
    } catch (error) {
        await new Promise<void>(resolve => { if (output.closed) resolve(); else output.once('close', resolve); });
        fs.rmSync(directory, { recursive: true, force: true }); throw error;
    }
}
