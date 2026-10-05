import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SandboxConfig, EnvsFile } from '../types';
import { readJsonOrWarn } from '../utils/jsonFile';

export class SandboxItem extends vscode.TreeItem {
    constructor(
        public sandbox: SandboxConfig,
        activeSandboxName?: string
    ) {
        super(sandbox.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'sandbox';
        this.tooltip = `Hostname: ${sandbox.hostname}\nUsername: ${sandbox.username ?? '(none)'}\nCode Version: ${sandbox["code-version"]}`;

        if (sandbox.name === activeSandboxName) {
            this.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("testing.iconPassed"));
        } else {
            this.iconPath = new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("problemsErrorIcon.foreground"));
            this.label = `${sandbox.name}`;
        }

        this.command = {
            command: 'dw-manager.activateSandbox',
            title: 'Activate Sandbox',
            arguments: [this.sandbox]
        };
    }
}

export class SandboxDetailItem extends vscode.TreeItem {
    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }
}

export class SandboxTreeDataProvider implements vscode.TreeDataProvider<SandboxItem | SandboxDetailItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SandboxItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private context: vscode.ExtensionContext) {}

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SandboxItem | SandboxDetailItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SandboxItem): Promise<(SandboxItem | SandboxDetailItem)[]> {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) return [];

        const envPath = path.join(workspace, 'dw-envs.json');
        const dwPath = path.join(workspace, 'dw.json');

        if (!fs.existsSync(envPath)) return [];

        const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
        if (!envs) return [];
        const sandboxes = envs.sandboxes;

        let activeSandboxName: string | undefined = undefined;

        if (fs.existsSync(dwPath)) {
            const active = readJsonOrWarn<SandboxConfig>(dwPath, 'dw.json');
            activeSandboxName = active?.name;
        }

        // No parent -> top level -> list sandboxes
        if (!element) {
            return sandboxes.map(sb => new SandboxItem(sb, activeSandboxName));
        }

        // Has parent -> sandbox expanded -> show sandbox details
        const details: SandboxDetailItem[] = [];

        const hostnameItem = new SandboxDetailItem(`Hostname`);
        hostnameItem.description = element.sandbox.hostname;
        hostnameItem.tooltip = element.sandbox.hostname;
        details.push(hostnameItem);

        const usernameItem = new SandboxDetailItem(`Username`);
        usernameItem.description = element.sandbox.username ?? '(none)';
        usernameItem.tooltip = element.sandbox.username ?? '(none)';
        details.push(usernameItem);

        const codeVersionItem = new SandboxDetailItem(`Code Version`);
        codeVersionItem.description = element.sandbox["code-version"];
        codeVersionItem.tooltip = element.sandbox["code-version"];
        details.push(codeVersionItem);

        if (element.sandbox.cartridges?.length) {
            details.push(new SandboxDetailItem(`Cartridges:`));
            element.sandbox.cartridges.forEach(cart => {
                const cartItem = new SandboxDetailItem(`   - ${cart}`);
                cartItem.tooltip = cart;
                details.push(cartItem);
            });
        } else {
            details.push(new SandboxDetailItem(`Cartridges: (none)`));
        }

        return details;
    }
}
