import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SandboxConfig, EnvsFile } from '../types';
import { pickOrEnter } from '../utils/pick';
import { readJsonOrWarn, writeJson } from '../utils/jsonFile';
import { getCartridgeFolderNames, getCartridgesFromDirectory } from '../cartridges/discovery';
import { SandboxItem } from './tree';
import {
    findSandboxByName,
    removeSandboxByName,
    updatePasswordForUsername,
    updateActiveConfigPasswordIfMatch,
    findMatchingSandboxForActiveConfig
} from './logic';

export async function deleteSavedUsername(context: vscode.ExtensionContext) {
    const usernames = context.globalState.get<string[]>('dw-usernames') || [];
    const username = await vscode.window.showQuickPick(usernames);
    if (!username) return;
    await context.globalState.update('dw-usernames', usernames.filter(u => u !== username));
    await context.globalState.update(`dw-password-${username}`, undefined);
}

export async function deleteSavedSandbox(context: vscode.ExtensionContext) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const envPath = path.join(workspace, 'dw-envs.json');
    if (!fs.existsSync(envPath)) return;

    const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
    if (!envs) return;
    const sandbox = await vscode.window.showQuickPick(envs.sandboxes.map((sb: SandboxConfig) => sb.name));
    if (!sandbox) return;

    removeSandboxByName(envs, sandbox);
    writeJson(envPath, envs);
    vscode.commands.executeCommand('dwEnvSwitcherView.refresh');
}

export async function deleteSandboxFromView(context: vscode.ExtensionContext, item: SandboxItem) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const envPath = path.join(workspace, 'dw-envs.json');
    if (!fs.existsSync(envPath)) return;

    const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
    if (!envs) return;
    removeSandboxByName(envs, item.sandbox.name);
    writeJson(envPath, envs);
    vscode.commands.executeCommand('dwEnvSwitcherView.refresh');
}

export async function changeCartridges(context: vscode.ExtensionContext, item: SandboxItem) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const envPath = path.join(workspace, 'dw-envs.json');
    const dwPath = path.join(workspace, 'dw.json');
    if (!fs.existsSync(envPath)) return;

    const available = await getCartridgesFromDirectory(workspace);
    const selected = await vscode.window.showQuickPick(getCartridgeFolderNames(available), { canPickMany: true });

    const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
    if (!envs) return;
    const sandbox = findSandboxByName(envs, item.sandbox.name);
    if (sandbox) {
        sandbox.cartridges = selected;
        writeJson(envPath, envs);
        writeJson(dwPath, sandbox);
        vscode.window.showInformationMessage(`Updated cartridges for ${sandbox.name}`);
        vscode.commands.executeCommand('dwEnvSwitcherView.refresh');
    }
}

export async function switchCurrentSandboxCodeVersion(context: vscode.ExtensionContext) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const dwPath = path.join(workspace, 'dw.json');
    const envPath = path.join(workspace, 'dw-envs.json');

    if (!fs.existsSync(dwPath)) return;

    const config = readJsonOrWarn<SandboxConfig>(dwPath, 'dw.json');
    if (!config) return;
    const current = config['code-version'];
    const versions = context.globalState.get<string[]>('dw-codeversions') || [];

    const selected = await vscode.window.showQuickPick(['➕ Enter New', ...versions], { placeHolder: `Current: ${current}` });
    if (!selected) return;

    const newVersion = selected === '➕ Enter New' ? await vscode.window.showInputBox({ prompt: 'Enter new code version' }) : selected;
    if (!newVersion) return;

    if (!versions.includes(newVersion)) {
        versions.push(newVersion);
        await context.globalState.update('dw-codeversions', versions);
    }

    config['code-version'] = newVersion;
    writeJson(dwPath, config);

    if (fs.existsSync(envPath)) {
        const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
        if (envs) {
            const match = findMatchingSandboxForActiveConfig(envs, config.hostname, config.username);
            if (match) {
                match['code-version'] = newVersion;
                writeJson(envPath, envs);
            }
        }
    }

    vscode.window.showInformationMessage(`Code version set to ${newVersion}`);
}

export async function changeUser(context: vscode.ExtensionContext, item: SandboxItem) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const envPath = path.join(workspace, 'dw-envs.json');
    const dwPath = path.join(workspace, 'dw.json');
    if (!fs.existsSync(envPath)) return;

    const usernames = context.globalState.get<string[]>('dw-usernames') || [];
    const username = await pickOrEnter('username', usernames, item.sandbox.username);
    if (!username) return;
    if (!usernames.includes(username)) {
        usernames.push(username);
        await context.globalState.update('dw-usernames', usernames);
    }
    const password = await vscode.window.showInputBox({ prompt: 'Enter new password', password: true });

    const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
    if (!envs) return;
    const sandbox = findSandboxByName(envs, item.sandbox.name);
    if (sandbox) {
        sandbox.username = username;
        sandbox.password = password;
        writeJson(envPath, envs);
        writeJson(dwPath, sandbox);
        vscode.window.showInformationMessage(`Updated user for ${sandbox.name}`);
        vscode.commands.executeCommand('dwEnvSwitcherView.refresh');
        vscode.commands.executeCommand('dw-env-switcher.refreshLogs');
    }
}

export async function changeSavedPassword(context: vscode.ExtensionContext) {
    const usernames = context.globalState.get<string[]>('dw-usernames') || [];
    if (usernames.length === 0) {
        vscode.window.showInformationMessage('No saved usernames found.');
        return;
    }

    const username = await vscode.window.showQuickPick(usernames, { placeHolder: 'Select username to update password' });
    if (!username) return;

    const newPassword = await vscode.window.showInputBox({ prompt: `Enter new password for ${username}`, password: true });
    if (!newPassword) return;

    // Update global password
    await context.globalState.update(`dw-password-${username}`, newPassword);

    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) {
        vscode.window.showInformationMessage('Password updated in global state only.');
        return;
    }

    const envPath = path.join(workspace, 'dw-envs.json');
    const dwPath = path.join(workspace, 'dw.json');

    // Update dw-envs.json
    if (fs.existsSync(envPath)) {
        const envs = readJsonOrWarn<EnvsFile>(envPath, 'dw-envs.json');
        if (envs && updatePasswordForUsername(envs, username, newPassword)) {
            writeJson(envPath, envs);
        }
    }

    // Update dw.json if active username matches
    if (fs.existsSync(dwPath)) {
        const current = readJsonOrWarn<SandboxConfig>(dwPath, 'dw.json');
        if (current && updateActiveConfigPasswordIfMatch(current, username, newPassword)) {
            writeJson(dwPath, current);
        }
    }

    vscode.window.showInformationMessage(`Password updated for user "${username}".`);
    vscode.commands.executeCommand('dw-env-switcher.refreshLogs');
}

export async function activateSandbox(sandbox: SandboxConfig) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) return;

    const dwPath = path.join(workspace, 'dw.json');

    writeJson(dwPath, sandbox);

    vscode.window.showInformationMessage(`Activated sandbox: ${sandbox.name}`);

    vscode.commands.executeCommand('dwEnvSwitcherView.refresh');
    vscode.commands.executeCommand('dw-env-switcher.refreshLogs');
}

export function editSandboxFromView(item: SandboxItem) {
    vscode.commands.executeCommand('dw-env-switcher.selectSandboxWithDetails', item.sandbox.name);
}
