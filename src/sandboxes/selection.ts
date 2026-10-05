import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SandboxConfig, EnvsFile } from '../types';
import { pickOrEnter } from '../utils/pick';
import { readJsonOrWarn, writeJson } from '../utils/jsonFile';
import { getCartridgeFolderNames, getCartridgesFromDirectory } from '../cartridges/discovery';
import { upsertSandbox } from './logic';

export async function simpleSandboxSelection(context: vscode.ExtensionContext) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return vscode.window.showErrorMessage('No workspace is open.');

    const envPath = path.join(workspace, 'dw-envs.json');
    const dwPath = path.join(workspace, 'dw.json');

    if (!fs.existsSync(envPath)) return detailedSandboxSelection(context);

    const envsFile = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
    if (!envsFile) return;
    const envs = envsFile.sandboxes;
    const sandboxName = await vscode.window.showQuickPick(envs.map(sb => sb.name), { placeHolder: 'Select a sandbox' });
    if (!sandboxName) return;

    const sandbox = envs.find(sb => sb.name === sandboxName);
    if (!sandbox) return;

    let username = sandbox.username || await context.globalState.get('dw-username');
    let password = sandbox.password || await context.globalState.get('dw-password');

    if (!username || !password) {
        username = await vscode.window.showInputBox({ prompt: 'Enter username' });
        password = await vscode.window.showInputBox({ prompt: 'Enter password', password: true });
        if (!username || !password) return;
        await context.globalState.update('dw-username', username);
        await context.globalState.update('dw-password', password);
    }

    if (await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Choose cartridges?' }) === 'Yes') {
        const available = await getCartridgesFromDirectory(workspace);
        const selected = await vscode.window.showQuickPick(getCartridgeFolderNames(available), { canPickMany: true });
        sandbox.cartridges = selected;
    }

    writeJson(dwPath, { hostname: sandbox.hostname, username, password, 'code-version': sandbox['code-version'], cartridges: sandbox.cartridges || [], name: sandbox.name });
    vscode.window.showInformationMessage(`dw.json updated for ${sandbox.name}`);
    vscode.commands.executeCommand('dw-env-switcher.refreshLogs');
}

export async function detailedSandboxSelection(context: vscode.ExtensionContext, sandboxName?: string) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const envPath = path.join(workspace, 'dw-envs.json');
    const dwPath = path.join(workspace, 'dw.json');

    if (!fs.existsSync(envPath)) writeJson(envPath, { sandboxes: [] });

    const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
    if (!envs) return;
    const existing = sandboxName ? envs.sandboxes.find((sb: SandboxConfig) => sb.name === sandboxName) : undefined;

    // Add existing hostname to global hostnames if missing
    if (existing?.hostname) {
        const hostnames = context.globalState.get<string[]>('dw-hostnames') || [];
        if (!hostnames.includes(existing.hostname)) {
            hostnames.push(existing.hostname);
            await context.globalState.update('dw-hostnames', hostnames);
        }
    }

    const hostnames = context.globalState.get<string[]>('dw-hostnames') || [];
    const hostname = await pickOrEnter('hostname', hostnames, existing?.hostname);
    if (!hostname) return;
    if (!hostnames.includes(hostname)) {
        hostnames.push(hostname);
        await context.globalState.update('dw-hostnames', hostnames);
    }

    const usernames = context.globalState.get<string[]>('dw-usernames') || [];
    const username = await pickOrEnter('username', usernames, existing?.username);
    const password = await vscode.window.showInputBox({ prompt: 'Password', value: existing?.password, password: true });

    const versions = context.globalState.get<string[]>('dw-codeversions') || [];
    const codeVersion = await pickOrEnter('code version', versions, existing?.['code-version']);
    if (!codeVersion) return;
    if (!versions.includes(codeVersion)) {
        versions.push(codeVersion);
        await context.globalState.update('dw-codeversions', versions);
    }

    const name = sandboxName || await vscode.window.showInputBox({ prompt: 'Sandbox name', value: existing?.name });
    if (!name) return;

    const chooseCartridges = await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Select cartridges?' }) === 'Yes';
    const cartsAbs = chooseCartridges ? await getCartridgesFromDirectory(workspace) : [];
    const cartridges = chooseCartridges
        ? await vscode.window.showQuickPick(getCartridgeFolderNames(cartsAbs), { canPickMany: true })
        : [];

    const sandbox: SandboxConfig = { name, hostname, username, password, "code-version": codeVersion, cartridges };

    upsertSandbox(envs, sandbox);

    writeJson(envPath, envs);
    writeJson(dwPath, sandbox);

    vscode.window.showInformationMessage(`Saved sandbox ${name}`);
    vscode.commands.executeCommand('dwEnvSwitcherView.refresh');
    vscode.commands.executeCommand('dw-env-switcher.refreshLogs');
}
