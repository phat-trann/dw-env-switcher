import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { Environment, Site } from '../types';
import { ConfigStore } from './store';
import { getCartridgeFolderNames, getCartridgesFromDirectory } from '../cartridges/discovery';

export type EntryKind = 'environment' | 'site';
export interface EntryTarget { kind: EntryKind; id: string; }

export class ConfigManager implements vscode.Disposable {
    private emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    store?: ConfigStore;
    private watchers: vscode.Disposable[] = [];
    private timer?: ReturnType<typeof setTimeout>;
    private configText?: string;
    private activeText?: string;

    initialize(): void {
        this.watchers.forEach(watcher => watcher.dispose()); this.watchers = [];
        if (this.timer) clearTimeout(this.timer);
        this.store = undefined;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { this.emitter.fire(); return; }
        try {
            const store = new ConfigStore(root); store.load(); this.store = store;
            this.remember();
        } catch {
            vscode.window.showErrorMessage('Cannot load DW Manager configuration. Check dw-manager.json, dw-envs.json, and dw.json.');
        }
        for (const file of ['dw.json', 'dw-manager.json']) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, file));
            const update = () => {
                if (this.timer) clearTimeout(this.timer);
                this.timer = setTimeout(() => this.reloadExternal(), 150);
            };
            this.watchers.push(watcher, watcher.onDidCreate(update), watcher.onDidChange(update), watcher.onDidDelete(update));
        }
        this.emitter.fire();
    }

    private text(file?: string): string | undefined {
        return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    }
    private remember(): void {
        this.configText = this.text(this.store?.configPath);
        this.activeText = this.text(this.store?.activePath);
    }
    private reloadExternal(): void {
        if (!this.store) { this.initialize(); return; }
        try {
            if (this.configText === this.text(this.store.configPath) && this.activeText === this.text(this.store.activePath)) return;
            const fresh = new ConfigStore(this.store.root); fresh.load(); this.store = fresh;
            this.remember(); this.emitter.fire();
        } catch {
            this.store = undefined; this.emitter.fire();
            vscode.window.showErrorMessage('Cannot reload DW Manager configuration. Check the JSON files.');
        }
    }

    private requireStore(): ConfigStore {
        if (!this.store) throw new Error('Open a workspace with valid DW Manager configuration first.');
        return this.store;
    }
    async run(action: () => void | Promise<void>): Promise<void> {
        try { await action(); this.remember(); this.emitter.fire(); }
        catch { vscode.window.showErrorMessage('DW Manager action failed. Check the configuration files and selected entry.'); }
    }

    async select(kind: EntryKind, id?: string): Promise<void> {
        const store = this.requireStore();
        if (!id) {
            const entries = kind === 'environment' ? store.config.environments : store.config.sites;
            const item = await vscode.window.showQuickPick(entries.map(entry => ({ label: entry.name, description: entry.id, id: entry.id })), { placeHolder: `Select ${kind}` });
            if (!item) return;
            id = item.id;
        }
        const applied = store.select(kind, id);
        vscode.window.showInformationMessage(applied ? 'Environment and Site selected; dw.json updated.' : `Selected ${kind}. Select the other part to update dw.json.`);
    }

    private async input(prompt: string, value?: string, password = false): Promise<string | undefined> {
        return vscode.window.showInputBox({ prompt, value, password,
            validateInput: text => text.trim() ? undefined : 'A value is required.' });
    }

    async editEnvironment(id?: string): Promise<void> {
        const store = this.requireStore();
        const existing = id ? store.config.environments.find(entry => entry.id === id) : undefined;
        if (id && !existing) throw new Error('Environment no longer exists.');
        const name = await this.input('Environment name', existing?.name); if (name === undefined) return;
        const hostname = await this.input('Hostname', existing?.hostname); if (hostname === undefined) return;
        const username = await this.input('Username', existing?.username); if (username === undefined) return;
        const password = await this.input('Password', existing?.password, true); if (password === undefined) return;
        const version = await this.input('Version', existing?.version); if (version === undefined) return;
        const entry: Environment = { id: existing?.id ?? randomUUID(), name, hostname, username, password, version };
        store.upsert('environment', entry);
        vscode.window.showInformationMessage(`Environment ${existing ? 'updated' : 'created'}.`);
    }

    async editSite(id?: string): Promise<void> {
        const store = this.requireStore();
        const existing = id ? store.config.sites.find(entry => entry.id === id) : undefined;
        if (id && !existing) throw new Error('Site no longer exists.');
        const name = await this.input('Site name', existing?.name); if (name === undefined) return;
        const cartridgesPath = await vscode.window.showInputBox({ prompt: 'Cartridges path (colon-separated, in execution order)', value: existing?.cartridgesPath ?? '' });
        if (cartridgesPath === undefined) return;
        const site: Site = { id: existing?.id ?? randomUUID(), name, cartridgesPath };
        store.upsert('site', site);
        vscode.window.showInformationMessage(`Site ${existing ? 'updated' : 'created'}.`);
    }

    async chooseCartridges(id: string): Promise<void> {
        const store = this.requireStore();
        const site = store.config.sites.find(entry => entry.id === id);
        if (!site) throw new Error('Site no longer exists.');
        const current = site.cartridgesPath.split(':').filter(Boolean);
        const discovered = getCartridgeFolderNames(await getCartridgesFromDirectory(store.root));
        const names = [...new Set([...current, ...discovered])];
        const selected = await vscode.window.showQuickPick(names.map(label => ({ label, picked: current.includes(label) })), { canPickMany: true, placeHolder: 'Select cartridges; edit Site to set their exact order' });
        if (!selected) return;
        // Existing cartridge order first; append new selections in discovery order.
        const chosen = new Set(selected.map(item => item.label));
        store.upsert('site', { ...site, cartridgesPath: names.filter(name => chosen.has(name)).join(':') });
    }

    async remove(target: EntryTarget): Promise<void> {
        const store = this.requireStore();
        const confirm = await vscode.window.showWarningMessage(`Delete this ${target.kind}?`, { modal: true }, 'Delete');
        if (confirm !== 'Delete') return;
        store.remove(target.kind, target.id);
    }

    refresh(): void { this.reloadExternal(); this.emitter.fire(); }
    dispose(): void {
        if (this.timer) clearTimeout(this.timer);
        this.watchers.forEach(watcher => watcher.dispose()); this.emitter.dispose();
    }
}
