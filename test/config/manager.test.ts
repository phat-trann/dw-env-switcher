import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const { callbacks } = vi.hoisted(() => ({ callbacks: [] as (() => void)[] }));
vi.mock('vscode', () => ({
    EventEmitter: class {
        event = (_listener: () => void) => ({ dispose() {} });
        fire() {} dispose() {}
    },
    RelativePattern: class { constructor(public root: string, public pattern: string) {} },
    workspace: {
        workspaceFolders: [] as { uri: { fsPath: string } }[],
        createFileSystemWatcher: vi.fn(() => {
            const register = (listener: () => void) => { callbacks.push(listener); return { dispose() {} }; };
            return { onDidCreate: register, onDidChange: register, onDidDelete: register, dispose() {} };
        })
    },
    window: { showInputBox: vi.fn(), showQuickPick: vi.fn(), showWarningMessage: vi.fn(), showErrorMessage: vi.fn(), showInformationMessage: vi.fn() }
}));
import * as vscode from 'vscode';
import { ConfigManager } from '../../src/config/manager';
let root: string; let manager: ConfigManager;
beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); callbacks.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-manager-ui-'));
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: root } }];
    manager = new ConfigManager(); manager.initialize();
});
afterEach(() => { manager.dispose(); vi.useRealTimers(); fs.rmSync(root, { recursive: true, force: true }); });
const input = () => vscode.window.showInputBox as ReturnType<typeof vi.fn>;
const createEnv = async () => {
    for (const text of ['Dev', 'dev.invalid', 'user', 'placeholder', 'v1']) input().mockResolvedValueOnce(text);
    await manager.run(() => manager.editEnvironment());
};
const createSite = async () => {
    input().mockResolvedValueOnce('Store').mockResolvedValueOnce('custom:base');
    await manager.run(() => manager.editSite());
};

describe('Configuration UI and watcher integration', () => {
    it('creates unique UUIDs, preserves pending selection across own-file watcher events, then writes the selected pair', async () => {
        await createEnv(); const id = manager.store!.config.environments[0].id;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        await manager.run(() => manager.select('environment', id));
        await createSite(); callbacks[0](); vi.advanceTimersByTime(200);
        expect(manager.store!.environmentId).toBe(id);
        const siteId = manager.store!.config.sites[0].id; expect(siteId).not.toBe(id);
        expect(fs.existsSync(path.join(root, 'dw.json'))).toBe(false);
        await manager.run(() => manager.select('site', siteId));
        expect(JSON.parse(fs.readFileSync(path.join(root, 'dw.json'), 'utf8'))).toMatchObject({ environmentId: id, siteId });
    });
    it('canceled prompts and deletion confirmation do not change config', async () => {
        input().mockResolvedValueOnce('Dev').mockResolvedValueOnce(undefined);
        await manager.run(() => manager.editEnvironment()); expect(manager.store!.config.environments).toHaveLength(0);
        await createEnv(); const id = manager.store!.config.environments[0].id;
        (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
        await manager.run(() => manager.remove({ kind: 'environment', id }));
        expect(manager.store!.config.environments).toHaveLength(1);
    });
    it('external dw.json edits update the matching Environment and Site and retain selected IDs', async () => {
        await createEnv(); await createSite(); const envId = manager.store!.config.environments[0].id; const siteId = manager.store!.config.sites[0].id;
        await manager.run(() => manager.select('environment', envId)); await manager.run(() => manager.select('site', siteId));
        const activePath = path.join(root, 'dw.json'); const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
        active.version = 'external'; active.cartridgesPath = 'external:base'; fs.writeFileSync(activePath, JSON.stringify(active));
        callbacks[0](); vi.advanceTimersByTime(200);
        expect(manager.store!.config.environments[0].version).toBe('external');
        expect(manager.store!.config.sites[0].cartridgesPath).toBe('external:base');
        expect(manager.store!.environmentId).toBe(envId); expect(manager.store!.siteId).toBe(siteId);
    });
    it('external invalid JSON disables writes rather than overwriting the file with stale data', async () => {
        await createEnv(); fs.writeFileSync(path.join(root, 'dw-manager.json'), '{invalid');
        callbacks[0](); vi.advanceTimersByTime(200); expect(manager.store).toBeUndefined();
        await manager.run(() => manager.editSite());
        expect(fs.readFileSync(path.join(root, 'dw-manager.json'), 'utf8')).toBe('{invalid');
        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
});
