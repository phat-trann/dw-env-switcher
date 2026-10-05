import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ActiveConfig } from '../types';
import { readJsonOrWarn } from '../utils/jsonFile';
import { listLogFiles } from './webdavClient';
import { LogTailSession } from './tailSession';

export class LogFileItem extends vscode.TreeItem {
    constructor(public readonly fileName: string, isTailing: boolean) {
        super(fileName, vscode.TreeItemCollapsibleState.None);
        this.contextValue = isTailing ? 'logFileTailing' : 'logFile';
        this.tooltip = isTailing ? `${fileName} (tailing — click to reveal)` : `${fileName} (click to tail)`;
        this.iconPath = new vscode.ThemeIcon(
            isTailing ? 'debug-console' : 'file-text',
            isTailing ? new vscode.ThemeColor('testing.iconPassed') : undefined
        );
        this.command = {
            title: 'Tail Log',
            command: 'dw-manager.tailLog',
            arguments: [this]
        };
    }
}

export class LogsTreeDataProvider implements vscode.TreeDataProvider<LogFileItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly sessions = new Map<string, LogTailSession>();

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: LogFileItem): vscode.TreeItem {
        return element;
    }

    private getActiveConfig(): ActiveConfig | undefined {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) return undefined;

        const dwPath = path.join(workspace, 'dw.json');
        if (!fs.existsSync(dwPath)) return undefined;

        return readJsonOrWarn<ActiveConfig>(dwPath, 'dw.json');
    }

    async getChildren(): Promise<LogFileItem[]> {
        const config = this.getActiveConfig();
        if (!config?.hostname || !config.username || !config.password) return [];

        try {
            const files = await listLogFiles(config.hostname, config.username, config.password);
            return files.map(fileName => new LogFileItem(fileName, this.sessions.has(fileName)));
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to load environment logs: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }

    async tailLog(item: LogFileItem): Promise<void> {
        const existing = this.sessions.get(item.fileName);
        if (existing) {
            existing.reveal();
            return;
        }

        const config = this.getActiveConfig();
        if (!config?.hostname || !config.username || !config.password) {
            vscode.window.showErrorMessage('No active Environment with credentials found.');
            return;
        }

        const session = new LogTailSession({ hostname: config.hostname, username: config.username, password: config.password, fileName: item.fileName });
        this.sessions.set(item.fileName, session);
        this.refresh();
        await session.start();
    }

    stopTailing(item: LogFileItem): void {
        const session = this.sessions.get(item.fileName);
        if (!session) return;

        session.dispose();
        this.sessions.delete(item.fileName);
        this.refresh();
    }

    disposeAll(): void {
        for (const session of this.sessions.values()) session.dispose();
        this.sessions.clear();
    }
}
