import * as vscode from 'vscode';
import { ConfigManager } from './config/manager';
import { ConfigTreeProvider, EntryItem } from './config/tree';
import { CartridgesTreeDataProvider, CartridgeItem } from './cartridges/tree';
import { LogsTreeDataProvider, LogFileItem } from './logs/tree';
import { exportSetup, importSetup } from './io/exportImport';
import { enableProphetUpload, disableProphetUpload } from './prophet';

export function activate(context: vscode.ExtensionContext) {
    const manager = new ConfigManager();
    const cartridges = new CartridgesTreeDataProvider(context);
    const logs = new LogsTreeDataProvider();
    let logTarget: string | undefined;
    context.subscriptions.push(manager,
        vscode.window.registerTreeDataProvider('dwManagerEnvironmentsView', new ConfigTreeProvider(manager, 'environment')),
        vscode.window.registerTreeDataProvider('dwManagerSitesView', new ConfigTreeProvider(manager, 'site')),
        vscode.window.registerTreeDataProvider('dwManagerCartridgesView', cartridges),
        vscode.window.registerTreeDataProvider('dwManagerLogsView', logs),
        manager.onDidChange(() => {
            const active = manager.store?.readActive();
            const target = JSON.stringify([active?.hostname, active?.username, active?.password]);
            if (target !== logTarget) { logs.disposeAll(); logTarget = target; }
            logs.refresh();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => manager.initialize()),
        { dispose: () => logs.disposeAll() }
    );
    const register = (id: string, callback: (...args: any[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(`dw-manager.${id}`, callback));
    register('selectEnvironment', (item?: EntryItem) => manager.run(() => manager.select('environment', item?.id)));
    register('selectSite', (item?: EntryItem) => manager.run(() => manager.select('site', item?.id)));
    register('createEnvironment', () => manager.run(() => manager.editEnvironment()));
    register('createSite', () => manager.run(() => manager.editSite()));
    register('editEnvironment', (item?: EntryItem) => manager.run(() => manager.editEnvironment(item?.id)));
    register('editSite', (item?: EntryItem) => manager.run(() => manager.editSite(item?.id)));
    register('deleteEnvironment', (item: EntryItem) => manager.run(() => manager.remove(item)));
    register('deleteSite', (item: EntryItem) => manager.run(() => manager.remove(item)));
    register('changeCartridges', (item: EntryItem) => manager.run(() => manager.chooseCartridges(item.id)));
    register('refreshConfiguration', () => manager.refresh());
    register('exportSetup', () => exportSetup(context));
    register('importSetup', () => importSetup(context).then(() => manager.initialize()));
    register('enableProphetUpload', enableProphetUpload);
    register('disableProphetUpload', disableProphetUpload);
    register('refreshCartridges', () => cartridges.refresh());
    register('openCartridge', (item: CartridgeItem) => vscode.commands.executeCommand('vscode.openFolder', item.cartridgeRoot, { forceNewWindow: false }));
    register('revealCartridgeInExplorer', (item: CartridgeItem) => vscode.commands.executeCommand('revealInExplorer', item.cartridgeRoot));
    register('refreshLogs', () => logs.refresh());
    register('tailLog', (item: LogFileItem) => logs.tailLog(item));
    register('stopTailingLog', (item: LogFileItem) => logs.stopTailing(item));
    manager.initialize();
}

export function deactivate() {}
