import * as vscode from 'vscode';

/** Prevent a second uploader and preserve manual-only startup behavior. Never activate Prophet here. */
export async function stopProphetUpload(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const prophet = vscode.extensions.getExtension('SqrTT.prophet');
    if (!folder || !prophet) return;
    await vscode.workspace.getConfiguration(undefined, folder.uri).update('extension.prophet.upload.enabled', false, vscode.ConfigurationTarget.Workspace);
    if (prophet.isActive) {
        const command = 'extension.prophet.command.disable.upload';
        if ((await vscode.commands.getCommands(true)).includes(command)) await vscode.commands.executeCommand(command);
    }
}
