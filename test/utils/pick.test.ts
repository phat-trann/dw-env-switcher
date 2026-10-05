import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
    window: {
        showQuickPick: vi.fn(),
        showInputBox: vi.fn()
    }
}));

import * as vscode from 'vscode';
import { pickOrEnter } from '../../src/utils/pick';

const showQuickPick = () => vscode.window.showQuickPick as unknown as ReturnType<typeof vi.fn>;
const showInputBox = () => vscode.window.showInputBox as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    showQuickPick().mockReset();
    showInputBox().mockReset();
});

describe('pickOrEnter', () => {
    it('returns the picked previous value without prompting for input', async () => {
        showQuickPick().mockResolvedValue('dev01.example.com');

        const result = await pickOrEnter('hostname', ['dev01.example.com', 'staging.example.com']);

        expect(result).toBe('dev01.example.com');
        expect(showInputBox()).not.toHaveBeenCalled();
    });

    it('prompts for free text when "Enter New" is chosen', async () => {
        showQuickPick().mockResolvedValue('➕ Enter New');
        showInputBox().mockResolvedValue('newhost.example.com');

        const result = await pickOrEnter('hostname', ['dev01.example.com']);

        expect(result).toBe('newhost.example.com');
        expect(showInputBox()).toHaveBeenCalledWith({ prompt: 'Enter hostname', value: undefined });
    });

    it('returns undefined when the quick pick is dismissed', async () => {
        showQuickPick().mockResolvedValue(undefined);

        const result = await pickOrEnter('hostname', ['dev01.example.com']);

        expect(result).toBeUndefined();
        expect(showInputBox()).not.toHaveBeenCalled();
    });

    it('offers the current value as the input box default when entering new', async () => {
        showQuickPick().mockResolvedValue('➕ Enter New');
        showInputBox().mockResolvedValue('updated.example.com');

        await pickOrEnter('hostname', [], 'current.example.com');

        expect(showInputBox()).toHaveBeenCalledWith({ prompt: 'Enter hostname', value: 'current.example.com' });
    });
});
