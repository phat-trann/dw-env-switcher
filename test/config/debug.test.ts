import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => ({
    workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] },
    extensions: { getExtension: vi.fn() },
    commands: { executeCommand: vi.fn() },
    debug: { startDebugging: vi.fn() },
    window: { showErrorMessage: vi.fn() }
}));
import * as vscode from 'vscode';
import { startDebugging } from '../../src/config/debug';
beforeEach(() => {
    vi.clearAllMocks(); (vscode.extensions.getExtension as any).mockReturnValue({});
    (vscode.debug.startDebugging as any).mockResolvedValue(true);
});
const manager = (env?: string, site?: string) => {
    const store = { environmentId: env, siteId: site, apply: vi.fn(() => true), config: { environments: [{ id: 'e', name: 'Dev' }], sites: [{ id: 's', name: 'Store' }] } };
    return { store, select: vi.fn(async (kind: string, id?: string) => { if (id) (store as any)[kind + 'Id'] = id; }) };
};
describe('Prophet debugging', () => {
    it('requires Prophet before changing active configuration', async () => {
        (vscode.extensions.getExtension as any).mockReturnValue(undefined);
        (vscode.window.showErrorMessage as any).mockResolvedValue('Open Extension');
        const state = manager('e', 's'); await startDebugging(state as any);
        expect(state.store.apply).not.toHaveBeenCalled();
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('extension.open', 'SqrTT.prophet');
        expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });
    it('applies the selected Site with retained Environment before starting Prophet', async () => {
        const state = manager('e', 'old'); await startDebugging(state as any, { kind: 'site', id: 's' } as any);
        expect(state.select).toHaveBeenCalledWith('site', 's');
        expect(state.store.environmentId).toBe('e');
        expect(state.store.siteId).toBe('s');
        expect(state.store.apply).toHaveBeenCalled();
        expect(state.store.apply.mock.invocationCallOrder[0]).toBeLessThan((vscode.debug.startDebugging as any).mock.invocationCallOrder[0]);
        expect(vscode.debug.startDebugging).toHaveBeenCalledWith(vscode.workspace.workspaceFolders![0], { type: 'prophet', request: 'launch', name: 'Debug: Dev / Store' });
    });
    it('canceled Environment choice stops without selecting a Site or starting debugging', async () => {
        const state = manager(); await startDebugging(state as any);
        expect(state.select).toHaveBeenCalledTimes(1); expect(state.select).toHaveBeenCalledWith('environment');
        expect(state.store.apply).not.toHaveBeenCalled(); expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });
    it('Site action with no Environment prompts for one and cancellation prevents launch', async () => {
        const state = manager(); await startDebugging(state as any, { kind: 'site', id: 's' } as any);
        expect(state.select.mock.calls).toEqual([['site', 's'], ['environment']]);
        expect(state.store.siteId).toBe('s');
        expect(state.store.apply).not.toHaveBeenCalled();
        expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });
    it('canceled Site choice does not launch using stale dw.json', async () => {
        const state = manager('e'); await startDebugging(state as any);
        expect(state.select).toHaveBeenCalledWith('site');
        expect(state.store.apply).not.toHaveBeenCalled(); expect(vscode.debug.startDebugging).not.toHaveBeenCalled();
    });
});
