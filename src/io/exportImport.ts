import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ActiveConfig } from '../types';
import { CONFIG_FILE, ConfigStore } from '../config/store';
import { migrateLegacy, validateConfig } from '../config/model';
const archiver = require('archiver');
const unzipper = require('unzipper');

export async function exportSetup(_context: vscode.ExtensionContext): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    try {
        const store = new ConfigStore(root); store.load(); store.save();
        const folder = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
        if (!folder) return;
        const archive = archiver('zip');
        const output = fs.createWriteStream(path.join(folder[0].fsPath, 'dw-manager-setup.zip'));
        const completion = new Promise<void>((resolve, reject) => {
            output.on('close', resolve); output.on('error', reject); archive.on('error', reject);
        });
        archive.pipe(output);
        archive.file(store.configPath, { name: CONFIG_FILE });
        if (fs.existsSync(store.activePath)) archive.file(store.activePath, { name: 'dw.json' });
        await Promise.all([archive.finalize(), completion]);
        vscode.window.showInformationMessage('DW Manager setup exported.');
    } catch { vscode.window.showErrorMessage('Cannot export DW Manager setup. Check workspace configuration and destination.'); }
}

export async function importSetup(_context: vscode.ExtensionContext, beforeWrite?: () => Promise<boolean>): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return;
    const choice = await vscode.window.showOpenDialog({ canSelectFiles: true, filters: { Zip: ['zip'] } });
    if (!choice) return;
    try {
        // Read only allowlisted root entries; never extract arbitrary archive paths.
        const archive = await unzipper.Open.file(choice[0].fsPath);
        const read = async (name: string): Promise<any> => {
            const entries = archive.files.filter((entry: { path: string; type: string }) => entry.path === name && entry.type === 'File');
            if (entries.length > 1) throw new Error('Duplicate ZIP config entry.');
            return entries.length ? JSON.parse((await entries[0].buffer()).toString('utf8')) : undefined;
        };
        let active: ActiveConfig | undefined = await read('dw.json');
        if (active && (typeof active !== 'object' || Array.isArray(active))) throw new Error('Invalid dw.json.');
        let config = await read(CONFIG_FILE);
        if (!config) {
            const legacy = await read('dw-envs.json');
            const migration = migrateLegacy(legacy, active); config = migration.config; active = migration.active ?? active;
        }
        validateConfig(config);
        if (beforeWrite && !await beforeWrite()) return;
        const store = new ConfigStore(root); store.config = config; store.save();
        if (active) fs.writeFileSync(store.activePath, JSON.stringify(active, null, 4) + '\n');
        vscode.window.showInformationMessage('DW Manager setup imported.');
    } catch { vscode.window.showErrorMessage('Cannot import DW Manager setup. Check the ZIP configuration files.'); }
}
