import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { discoverCartridgeRoots } from './discovery';

export class CartridgeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly cartridgeRoot: vscode.Uri
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'cartridge';
        this.tooltip = cartridgeRoot.fsPath;
        this.resourceUri = cartridgeRoot;
        this.iconPath = new vscode.ThemeIcon('package');
    }
}

/**
 * A folder or file inside a cartridge root. Left without an explicit iconPath
 * so VS Code renders it using the active file icon theme (matching resourceUri),
 * the same way the built-in Explorer does.
 */
export class CartridgeFileItem extends vscode.TreeItem {
    constructor(public readonly fsPath: string, isDirectory: boolean) {
        super(path.basename(fsPath), isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.contextValue = isDirectory ? 'cartridgeFolder' : 'cartridgeFile';
        this.resourceUri = vscode.Uri.file(fsPath);
        if (!isDirectory) {
            this.command = {
                title: 'Open File',
                command: 'vscode.open',
                arguments: [this.resourceUri]
            };
        }
    }
}

function readDirSorted(dirPath: string): fs.Dirent[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

export class CartridgesTreeDataProvider implements vscode.TreeDataProvider<CartridgeItem | CartridgeFileItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(context: vscode.ExtensionContext) {
        // Watch for typical structures and .project changes and refresh
        const watcher1 = vscode.workspace.createFileSystemWatcher('**/cartridge/**');
        const watcher2 = vscode.workspace.createFileSystemWatcher('**/*_cartridge/**');
        const watcher3 = vscode.workspace.createFileSystemWatcher('**/.project');

        const refresh = () => this.refresh();
        watcher1.onDidCreate(refresh);
        watcher1.onDidDelete(refresh);
        watcher1.onDidChange(refresh);

        watcher2.onDidCreate(refresh);
        watcher2.onDidDelete(refresh);
        watcher2.onDidChange(refresh);

        watcher3.onDidCreate(refresh);
        watcher3.onDidDelete(refresh);
        watcher3.onDidChange(refresh);

        context.subscriptions.push(watcher1, watcher2, watcher3);
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CartridgeItem | CartridgeFileItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CartridgeItem | CartridgeFileItem): Promise<(CartridgeItem | CartridgeFileItem)[]> {
        if (!element) {
            const roots = await discoverCartridgeRoots(); // all roots in workspace
            return roots.map(r => new CartridgeItem(path.basename(r), vscode.Uri.file(r)));
        }

        const dirPath = element instanceof CartridgeItem ? element.cartridgeRoot.fsPath : element.fsPath;
        return readDirSorted(dirPath).map(entry =>
            new CartridgeFileItem(path.join(dirPath, entry.name), entry.isDirectory())
        );
    }
}
