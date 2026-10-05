import * as vscode from 'vscode';

export async function pickOrEnter(label: string, previous: string[] = [], currentValue?: string): Promise<string | undefined> {
    const options = ['➕ Enter New', ...previous];
    const selected = await vscode.window.showQuickPick(options, { placeHolder: currentValue ? `Current: ${currentValue}` : undefined });
    if (!selected) return;

    if (selected === '➕ Enter New') {
        return await vscode.window.showInputBox({ prompt: `Enter ${label}`, value: currentValue });
    }

    return selected;
}
