import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'crypto';
import { ActiveConfig } from '../types';
import { listImpexEntries, fetchImpexFileBuffer } from './webdavClient';

export class ImpexItem extends vscode.TreeItem {
    constructor(readonly relativePath: string, readonly isDirectory: boolean, readonly target: string) {
        super(path.posix.basename(relativePath.replace(/\/$/, '')), isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.contextValue = isDirectory ? 'impexFolder' : 'impexFile';
        this.tooltip = `/${relativePath}`;
        this.iconPath = new vscode.ThemeIcon(isDirectory ? 'folder' : 'file');
        if (!isDirectory) this.command = { command: 'dw-manager.openImpexFile', title: 'Open Impex File', arguments: [this] };
    }
}

export class ImpexTreeDataProvider implements vscode.TreeDataProvider<ImpexItem>, vscode.Disposable {
    private emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private generation = 0;
    constructor(private readActive: () => ActiveConfig | undefined) {}
    private target(config: ActiveConfig): string {
        // Store only a digest on items; never put credentials in tree data.
        return createHash('sha256').update(JSON.stringify([config.hostname, config.username, config.password])).digest('hex');
    }
    refresh(): void { this.generation++; this.emitter.fire(); }
    getTreeItem(item: ImpexItem): vscode.TreeItem { return item; }
    async getChildren(item?: ImpexItem): Promise<ImpexItem[]> {
        const config = this.readActive();
        if (!config?.hostname || !config.username || !config.password) return [];
        const target = this.target(config); const generation = this.generation;
        if (item && item.target !== target) return [];
        try {
            const relative = item?.relativePath ?? '';
            const entries = await listImpexEntries(config.hostname, config.username, config.password, relative);
            if (generation !== this.generation) return [];
            return entries.map(entry => new ImpexItem(relative + entry.name, entry.isDirectory, target));
        } catch { if (generation === this.generation) vscode.window.showErrorMessage('Cannot load Impex. Check active Environment credentials and WebDAV permissions.'); return []; }
    }
    async openFile(item: ImpexItem): Promise<void> {
        if (!item || item.isDirectory) return;
        const config = this.readActive();
        if (!config?.hostname || !config.username || !config.password || item.target !== this.target(config)) {
            vscode.window.showErrorMessage('The active Environment changed. Refresh Impex and choose the file again.'); return;
        }
        const generation = this.generation;
        const ext = path.posix.extname(item.relativePath).toLowerCase();
        const text = ['.xml', '.json', '.txt', '.log', '.csv', '.properties'].includes(ext);
        try {
            const destination = text ? undefined : await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.posix.basename(item.relativePath)) });
            if ((!text && !destination) || generation !== this.generation) return;
            const buffer = await fetchImpexFileBuffer(config.hostname, config.username, config.password, item.relativePath);
            if (generation !== this.generation) return;
            if (text) {
                const language = ext === '.xml' ? 'xml' : ext === '.json' ? 'json' : 'plaintext';
                const doc = await vscode.workspace.openTextDocument({ content: buffer.toString('utf8'), language });
                await vscode.window.showTextDocument(doc, { preview: false });
            } else {
                await vscode.workspace.fs.writeFile(destination!, buffer);
                vscode.window.showInformationMessage('Impex file downloaded.');
            }
        } catch { vscode.window.showErrorMessage('Cannot open Impex file. Check connection, permissions, and destination.'); }
    }
    dispose(): void { this.generation++; this.emitter.dispose(); }
}
