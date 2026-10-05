import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { readJsonOrWarn } from '../utils/jsonFile';
const archiver = require('archiver');
const unzipper = require('unzipper');

export async function exportSetup(context: vscode.ExtensionContext) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const dwPath = path.join(workspace, 'dw.json');
    const envPath = path.join(workspace, 'dw-envs.json');
    if (!fs.existsSync(dwPath) || !fs.existsSync(envPath)) return;

    const global = {
        'dw-username': context.globalState.get('dw-username'),
        'dw-password': context.globalState.get('dw-password'),
        'dw-hostnames': context.globalState.get('dw-hostnames'),
        'dw-usernames': context.globalState.get('dw-usernames'),
        'dw-codeversions': context.globalState.get('dw-codeversions')
    };

    const folder = await vscode.window.showOpenDialog({ canSelectFolders: true });
    if (!folder) return;

    const zipPath = path.join(folder[0].fsPath, 'sandbox_config.zip');
    const archive = archiver('zip');
    const output = fs.createWriteStream(zipPath);

    archive.pipe(output);
    archive.file(dwPath, { name: 'dw.json' });
    archive.file(envPath, { name: 'dw-envs.json' });
    archive.append(JSON.stringify(global, null, 4), { name: 'globalState.json' });

    archive.finalize();
}

export async function importSetup(context: vscode.ExtensionContext) {
    const zip = await vscode.window.showOpenDialog({ canSelectFiles: true, filters: { Zip: ['zip'] } });
    if (!zip) return;

    const extractPath = path.dirname(zip[0].fsPath);

    fs.createReadStream(zip[0].fsPath).pipe(unzipper.Extract({ path: extractPath })).on('close', async () => {
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspace) return;

        ['dw.json', 'dw-envs.json'].forEach(f => {
            const src = path.join(extractPath, f);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(workspace, f));
            }
        });

        const globalFile = path.join(extractPath, 'globalState.json');
        if (fs.existsSync(globalFile)) {
            const global = readJsonOrWarn<Record<string, unknown>>(globalFile, 'globalState.json');
            if (global) {
                for (const key in global) {
                    await context.globalState.update(key, global[key]);
                }
            }
        }

        vscode.window.showInformationMessage('Import completed.');
        vscode.commands.executeCommand('dwManagerView.refresh');
        vscode.commands.executeCommand('dw-manager.refreshLogs');
    });
}
