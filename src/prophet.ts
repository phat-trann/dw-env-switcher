import * as vscode from 'vscode';

async function setProphetUploadEnabled(enabled: boolean) {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
        vscode.window.showErrorMessage('No workspace is open.');
        return;
    }
    // Flip Prophet’s uploader flag at workspace scope
    const config = vscode.workspace.getConfiguration(undefined, wsFolder.uri);
    await config.update('extension.prophet.upload.enabled', enabled, vscode.ConfigurationTarget.Workspace);

    vscode.window.showInformationMessage(
        `Prophet upload ${enabled ? 'ENABLED' : 'DISABLED'} for this workspace.`
    );
}

export async function enableProphetUpload() {
    await setProphetUploadEnabled(true);
}

export async function disableProphetUpload() {
    await setProphetUploadEnabled(false);
}
