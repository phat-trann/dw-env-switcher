import * as vscode from 'vscode';
import { ConfigManager, EntryKind } from './manager';
import { Environment, Site } from '../types';

export class EntryItem extends vscode.TreeItem {
    readonly id: string;
    constructor(readonly kind: EntryKind, readonly entry: Environment | Site, selected: boolean) {
        super(entry.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = entry.id;
        this.contextValue = kind;
        this.description = selected ? 'Selected' : undefined;
        this.tooltip = `${entry.name}\nID: ${entry.id}`;
        this.iconPath = new vscode.ThemeIcon(selected ? 'check' : kind === 'environment' ? 'server-environment' : 'globe', selected ? new vscode.ThemeColor('testing.iconPassed') : undefined);
        this.command = { command: kind === 'environment' ? 'dw-manager.selectEnvironment' : 'dw-manager.selectSite', title: `Select ${kind}`, arguments: [this] };
    }
}

export class ConfigTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    readonly onDidChangeTreeData: vscode.Event<void>;
    constructor(private manager: ConfigManager, private kind: EntryKind) { this.onDidChangeTreeData = manager.onDidChange; }
    getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
    getChildren(item?: vscode.TreeItem): vscode.TreeItem[] {
        const store = this.manager.store;
        if (!store) return [];
        if (!item) {
            const entries = this.kind === 'environment' ? store.config.environments : store.config.sites;
            const selected = this.kind === 'environment' ? store.environmentId : store.siteId;
            return entries.map(entry => new EntryItem(this.kind, entry, entry.id === selected));
        }
        if (!(item instanceof EntryItem)) return [];
        const record = item.entry;
        const details: [string, string][] = this.kind === 'environment' ? [
            ['ID', record.id], ['Hostname', (record as Environment).hostname],
            ['Username', (record as Environment).username], ['Version', (record as Environment).version]
        ] : [['ID', record.id], ['Cartridges path', (record as Site).cartridgesPath]];
        return details.map(([label, description]) => { const node = new vscode.TreeItem(label); node.description = description; node.tooltip = description; return node; });
    }
}
