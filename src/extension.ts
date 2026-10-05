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
    vscode.window.registerTreeDataProvider('dwManagerView', sandboxProvider);

    // Cartridges panel
    const cartridgesProvider = new CartridgesTreeDataProvider(context);
    vscode.window.registerTreeDataProvider('dwManagerCartridgesView', cartridgesProvider);

    // Logs panel — live-tails sandbox log files over WebDAV
    const logsProvider = new LogsTreeDataProvider();
    vscode.window.registerTreeDataProvider('dwManagerLogsView', logsProvider);

    context.subscriptions.push(
        { dispose: () => logsProvider.disposeAll() },
        vscode.commands.registerCommand('dw-manager.selectSandbox', () => simpleSandboxSelection(context)),
        vscode.commands.registerCommand('dw-manager.selectSandboxWithDetails', (sandboxName) => detailedSandboxSelection(context, sandboxName)),
        vscode.commands.registerCommand('dw-manager.deleteSavedUsername', () => deleteSavedUsername(context)),
        vscode.commands.registerCommand('dw-manager.deleteSavedSandbox', () => deleteSavedSandbox(context)),
        vscode.commands.registerCommand('dw-manager.exportSetup', () => exportSetup(context)),
        vscode.commands.registerCommand('dw-manager.importSetup', () => importSetup(context)),
        vscode.commands.registerCommand('dw-manager.switchCodeVersion', () => switchCurrentSandboxCodeVersion(context)),
        vscode.commands.registerCommand('dw-manager.deleteSandboxFromView', (item: SandboxItem) => deleteSandboxFromView(context, item)),
        vscode.commands.registerCommand('dwManagerView.refresh', () => sandboxProvider.refresh()),
        vscode.commands.registerCommand('dw-manager.addNewSandbox', () => detailedSandboxSelection(context)),
        vscode.commands.registerCommand('dw-manager.changeCartridges', (item: SandboxItem) => changeCartridges(context, item)),
        vscode.commands.registerCommand('dw-manager.changeUser', (item: SandboxItem) => changeUser(context, item)),
        vscode.commands.registerCommand('dw-manager.editSandboxFromView', (item: SandboxItem) => editSandboxFromView(item)),
        vscode.commands.registerCommand('dw-manager.changeSavedPassword', () => changeSavedPassword(context)),
        vscode.commands.registerCommand('dw-manager.activateSandbox', (sandbox) => activateSandbox(sandbox)),
        vscode.commands.registerCommand('dw-manager.enableProphetUpload', () => enableProphetUpload()),
        vscode.commands.registerCommand('dw-manager.disableProphetUpload', () => disableProphetUpload()),
        vscode.commands.registerCommand('dw-manager.refreshCartridges', () => cartridgesProvider.refresh()),
        vscode.commands.registerCommand('dw-manager.openCartridge', (item: CartridgeItem) => {
            vscode.commands.executeCommand('vscode.openFolder', item.cartridgeRoot, { forceNewWindow: false });
        }),
        vscode.commands.registerCommand('dw-manager.revealCartridgeInExplorer', async (item: CartridgeItem) => {
            await vscode.commands.executeCommand('revealInExplorer', item.cartridgeRoot);
        }),
        vscode.commands.registerCommand('dw-manager.refreshLogs', () => logsProvider.refresh()),
        vscode.commands.registerCommand('dw-manager.tailLog', (item: LogFileItem) => logsProvider.tailLog(item)),
        vscode.commands.registerCommand('dw-manager.stopTailingLog', (item: LogFileItem) => logsProvider.stopTailing(item))
    );
}

export function deactivate() {}
