import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ executeCommand: vi.fn(), showErrorMessage: vi.fn() }));
vi.mock('vscode', () => ({ commands: { executeCommand: mock.executeCommand }, window: { showErrorMessage: mock.showErrorMessage } }));
import { showActivities } from '../../src/activity/view';
beforeEach(() => { vi.resetAllMocks(); });
describe('Show Activities', () => {
    it('reveals the upload root without a generated focus command', async () => {
        const root = {}, reveal = vi.fn();
        await showActivities({ reveal } as any, { getChildren: () => [root] } as any);
        expect(reveal).toHaveBeenCalledWith(root, { focus: true, select: false });
        expect(mock.executeCommand.mock.calls).toEqual([['workbench.view.extension.dwManager']]);
    });
    it('offers reload when the workbench cannot resolve the contributed view', async () => {
        const reveal = vi.fn().mockRejectedValue(new Error('No view is registered'));
        mock.showErrorMessage.mockResolvedValue('Reload Window');
        await showActivities({ reveal } as any, { getChildren: () => [{}] } as any);
        expect(mock.executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
    });
    it('does not reload without an explicit choice', async () => {
        await showActivities({ reveal: vi.fn().mockRejectedValue(new Error('stale')) } as any, { getChildren: () => [{}] } as any);
        expect(mock.executeCommand).not.toHaveBeenCalledWith('workbench.action.reloadWindow');
    });
});
