import * as vscode from 'vscode';
import { Activities, ActivityItem } from './manager';

export async function showActivities(view: vscode.TreeView<ActivityItem>, provider: Activities): Promise<void> {
    try {
        await vscode.commands.executeCommand('workbench.view.extension.dwManager');
        await view.reveal(provider.getChildren()[0], { focus: true, select: false });
    } catch {
        const action = await vscode.window.showErrorMessage(
            'Activities is unavailable in this window. Reload Window to load the installed DW Manager views.',
            'Reload Window');
        if (action === 'Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}
