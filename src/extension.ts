import * as vscode from 'vscode';
import { REPO_ACTIONS, runRepoAction, RepoAction } from './repos/actions';
import { ConfigManager } from './config/manager';
import { ConfigTreeProvider, EntryItem } from './config/tree';
import { CartridgeItem } from './cartridges/tree';
import { discoverCartridgeRoots } from './cartridges/discovery';
import { ImpexTreeDataProvider } from './impex/tree';
import { startDebugging } from './config/debug';
import { LogsTreeDataProvider, LogFileItem } from './logs/tree';
import { exportSetup, importSetup } from './io/exportImport';
import { Activities, ActivityItem } from './activity/manager';
import { showActivities } from './activity/view';

let activeActivities: Activities | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const manager = new ConfigManager();
    const activities = new Activities(context, manager);
    activeActivities = activities;
    manager.beforeActiveChange = () => activities.beforeActiveChange();
    const impex = new ImpexTreeDataProvider(() => manager.store?.readActive());
    const logs = new LogsTreeDataProvider();
    let logTarget: string | undefined;
    const activitiesView = vscode.window.createTreeView('dwManagerActivitiesView', { treeDataProvider: activities });
    context.subscriptions.push(manager, impex, activities, activitiesView,
        vscode.window.registerTreeDataProvider('dwManagerEnvironmentsView', new ConfigTreeProvider(manager, 'environment')),
        vscode.window.registerTreeDataProvider('dwManagerSitesView', new ConfigTreeProvider(manager, 'site')),
        vscode.window.registerTreeDataProvider('dwManagerImpexView', impex),
        vscode.window.registerTreeDataProvider('dwManagerLogsView', logs),
        manager.onDidChange(() => {
            const active = manager.store?.readActive();
            const target = JSON.stringify([active?.hostname, active?.username, active?.password]);
            if (target !== logTarget) { logs.disposeAll(); logTarget = target; }
            logs.refresh(); impex.refresh(); void activities.refresh();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(async () => { await activities.pauseUpload(); manager.initialize(); }),
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
    register('importSetup', () => importSetup(context, () => activities.beforeActiveChange()).then(() => manager.initialize()));
    register('showUploadOutput', () => activities.showUploadOutput());
    register('enableProphetUpload', (item?: EntryItem) => activities.enableUpload(item?.id));
    register('enableUploadAll', (item?: EntryItem) => activities.enableUpload(item?.id, undefined, { uploadAll: true }));
    register('enableSelectedUpload', (item?: EntryItem) => activities.enableUpload(item?.id, undefined, { chooseCartridges: true }));
    register('enableSelectedUploadAll', (item?: EntryItem) => activities.enableUpload(item?.id, undefined, { chooseCartridges: true, uploadAll: true }));
    register('disableProphetUpload', () => activities.pauseUpload());
    register('startDebugging', (item?: EntryItem) => manager.run(() => startDebugging(manager, item, { beforeLaunch: (target, fingerprint, runId) => activities.beforeDebug(target, fingerprint, runId), launchFinished: ok => activities.debugLaunchFinished(ok) })));
    register('refreshImpex', () => impex.refresh());
    register('openImpexFile', item => impex.openFile(item));
    const chooseCartridge = async (item?: CartridgeItem) => {
        if (item) return item.cartridgeRoot;
        const roots = await discoverCartridgeRoots();
        const choice = await vscode.window.showQuickPick(roots.map(root => ({ label: root.split(/[\\/]/).pop()!, description: root, root })), { placeHolder: 'Choose a local cartridge' });
        return choice ? vscode.Uri.file(choice.root) : undefined;
    };
    register('refreshCartridges', async () => { const roots = await discoverCartridgeRoots(); vscode.window.showInformationMessage(`Found ${roots.length} local cartridges. Use Change Site Cartridges to choose them.`); });
    register('openCartridge', async (item?: CartridgeItem) => { const root = await chooseCartridge(item); if (root) await vscode.commands.executeCommand('vscode.openFolder', root, { forceNewWindow: false }); });
    register('revealCartridgeInExplorer', async (item?: CartridgeItem) => { const root = await chooseCartridge(item); if (root) await vscode.commands.executeCommand('revealInExplorer', root); });
    register('refreshLogs', () => logs.refresh());
    register('tailLog', (item: LogFileItem) => logs.tailLog(item));
    register('stopTailingLog', (item: LogFileItem) => logs.stopTailing(item));
    for (const action of Object.keys(REPO_ACTIONS) as RepoAction[]) {
        register(`repos.${action}`, (item?: EntryItem) => runRepoAction(context, action, item?.id));
    }
    register('activities.show', () => showActivities(activitiesView, activities));
    register('activities.start', (item?: ActivityItem) => activities.start(item));
    register('activities.stop', (item: ActivityItem) => activities.stop(item));
    register('activities.refresh', () => activities.refresh());
    register('activities.clearFinished', () => activities.clearFinished());
    try { await activities.resetUploadOnStartup(); }
    catch { vscode.window.showErrorMessage('Cannot disable Prophet upload on startup. Disable upload in Prophet before changing targets.'); }
    manager.initialize();
}

export async function deactivate() { await activeActivities?.pauseUpload(); activeActivities = undefined; }
