import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { ConfigManager } from './manager';
import { EntryItem } from './tree';
import { activityTarget, ActivityTarget, connectionFingerprint } from '../activity/target';
export interface DebugLifecycle { beforeLaunch(target: ActivityTarget, fingerprint: string, runId: string): Promise<boolean>; launchFinished(started: boolean): void; }

export async function startDebugging(manager: ConfigManager, item?: EntryItem, lifecycle?: DebugLifecycle): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace || !manager.store) { vscode.window.showErrorMessage('Open a workspace with valid DW Manager configuration first.'); return; }
    if (!vscode.extensions.getExtension('SqrTT.prophet')) {
        const choice = await vscode.window.showErrorMessage('Prophet Debugger is required to start SFCC debugging.', 'Open Extension');
        if (choice === 'Open Extension') await vscode.commands.executeCommand('extension.open', 'SqrTT.prophet');
        return;
    }
    if (item) { await manager.select(item.kind, item.id); if ((item.kind === 'site' ? manager.store.siteId : manager.store.environmentId) !== item.id) return; }
    if (!manager.store.environmentId) await manager.select('environment');
    if (!manager.store.environmentId) return;
    if (!manager.store.siteId) await manager.select('site');
    const store = manager.store;
    if (!store.environmentId || !store.siteId) return;
    if (!store.apply()) return;
    const environment = store.config.environments.find(entry => entry.id === store.environmentId)!;
    const site = store.config.sites.find(entry => entry.id === store.siteId)!;
    const active = store.readActive?.();
    const target = active ? activityTarget(store.config, active) : undefined;
    const fingerprint = active ? connectionFingerprint(active) : undefined;
    const runId = randomUUID();
    if (lifecycle && (!target || !fingerprint || !await lifecycle.beforeLaunch(target, fingerprint, runId))) return;
    let started = false;
    try {
        started = await vscode.debug.startDebugging(workspace, { type: 'prophet', request: 'launch', name: `Debug: ${environment.name} / ${site.name}`,
            ...(target ? { __dwManagerTarget: target, __dwManagerFingerprint: fingerprint, __dwManagerRunId: runId } : {}) });
    } finally { lifecycle?.launchFinished(started); }
    if (!started) vscode.window.showErrorMessage('Cannot start Prophet debugging. Check debugger configuration.');
}
