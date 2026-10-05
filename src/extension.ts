import * as vscode from 'vscode';
import { SandboxTreeDataProvider, SandboxItem } from './sandboxes/tree';
import { CartridgesTreeDataProvider, CartridgeItem } from './cartridges/tree';
import { LogsTreeDataProvider, LogFileItem } from './logs/tree';
import { simpleSandboxSelection, detailedSandboxSelection } from './sandboxes/selection';
import {
    deleteSavedUsername,
    deleteSavedSandbox,
    deleteSandboxFromView,
    changeCartridges,
    switchCurrentSandboxCodeVersion,
    changeUser,
    changeSavedPassword,
    editSandboxFromView,
    activateSandbox
} from './sandboxes/actions';
import { exportSetup, importSetup } from './io/exportImport';
import { enableProphetUpload, disableProphetUpload } from './prophet';

export {
    pickOrEnter
} from './utils/pick';
export {
    simpleSandboxSelection,
    detailedSandboxSelection
} from './sandboxes/selection';
export {
    SandboxTreeDataProvider,
    SandboxItem,
    SandboxDetailItem
} from './sandboxes/tree';
export {
    deleteSavedUsername,
    deleteSavedSandbox,
    deleteSandboxFromView,
    changeCartridges,
    switchCurrentSandboxCodeVersion,
    changeUser,
    changeSavedPassword,
    editSandboxFromView
} from './sandboxes/actions';
export { exportSetup, importSetup } from './io/exportImport';

export function activate(context: vscode.ExtensionContext) {
    // Sandboxes panel
    const sandboxProvider = new SandboxTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('dwEnvSwitcherView', sandboxProvider);

    // Cartridges panel
    const cartridgesProvider = new CartridgesTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('dwCartridgesView', cartridgesProvider);

    // Logs panel — live-tails sandbox log files over WebDAV
    const logsProvider = new LogsTreeDataProvider();
    vscode.window.registerTreeDataProvider('dwLogsView', logsProvider);

    context.subscriptions.push(
        { dispose: () => logsProvider.disposeAll() },
        vscode.commands.registerCommand('dw-env-switcher.selectSandbox', () => simpleSandboxSelection(context)),
        vscode.commands.registerCommand('dw-env-switcher.selectSandboxWithDetails', (sandboxName) => detailedSandboxSelection(context, sandboxName)),
        vscode.commands.registerCommand('dw-env-switcher.deleteSavedUsername', () => deleteSavedUsername(context)),
        vscode.commands.registerCommand('dw-env-switcher.deleteSavedSandbox', () => deleteSavedSandbox(context)),
        vscode.commands.registerCommand('dw-env-switcher.exportSetup', () => exportSetup(context)),
        vscode.commands.registerCommand('dw-env-switcher.importSetup', () => importSetup(context)),
        vscode.commands.registerCommand('dw-env-switcher.switchCodeVersion', () => switchCurrentSandboxCodeVersion(context)),
        vscode.commands.registerCommand('dw-env-switcher.deleteSandboxFromView', (item: SandboxItem) => deleteSandboxFromView(context, item)),
        vscode.commands.registerCommand('dwEnvSwitcherView.refresh', () => sandboxProvider.refresh()),
        vscode.commands.registerCommand('dw-env-switcher.addNewSandbox', () => detailedSandboxSelection(context)),
        vscode.commands.registerCommand('dw-env-switcher.changeCartridges', (item: SandboxItem) => changeCartridges(context, item)),
        vscode.commands.registerCommand('dw-env-switcher.changeUser', (item: SandboxItem) => changeUser(context, item)),
        vscode.commands.registerCommand('dw-env-switcher.editSandboxFromView', (item: SandboxItem) => editSandboxFromView(item)),
        vscode.commands.registerCommand('dw-env-switcher.changeSavedPassword', () => changeSavedPassword(context)),
        vscode.commands.registerCommand('dw-env-switcher.activateSandbox', (sandbox) => activateSandbox(sandbox)),
        vscode.commands.registerCommand('dw-env-switcher.enableProphetUpload', () => enableProphetUpload()),
        vscode.commands.registerCommand('dw-env-switcher.disableProphetUpload', () => disableProphetUpload()),
        vscode.commands.registerCommand('dw-env-switcher.refreshCartridges', () => cartridgesProvider.refresh()),
        vscode.commands.registerCommand('dw-env-switcher.openCartridge', (item: CartridgeItem) => {
            vscode.commands.executeCommand('vscode.openFolder', item.cartridgeRoot, { forceNewWindow: false });
        }),
        vscode.commands.registerCommand('dw-env-switcher.revealCartridgeInExplorer', async (item: CartridgeItem) => {
            await vscode.commands.executeCommand('revealInExplorer', item.cartridgeRoot);
        }),
        vscode.commands.registerCommand('dw-env-switcher.refreshLogs', () => logsProvider.refresh()),
        vscode.commands.registerCommand('dw-env-switcher.tailLog', (item: LogFileItem) => logsProvider.tailLog(item)),
        vscode.commands.registerCommand('dw-env-switcher.stopTailingLog', (item: LogFileItem) => logsProvider.stopTailing(item))
    );
}

export function deactivate() {}
