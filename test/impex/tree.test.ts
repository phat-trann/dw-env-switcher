import { describe, it, expect, vi, beforeEach } from 'vitest';
const api = vi.hoisted(() => ({ listImpexEntries: vi.fn(), fetchImpexFileBuffer: vi.fn() }));
vi.mock('../../src/impex/webdavClient', () => api);
vi.mock('vscode', () => ({
    TreeItem: class { constructor(public label: string, public collapsibleState: number) {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    ThemeIcon: class { constructor(public id: string) {} },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    workspace: { openTextDocument: vi.fn(), fs: { writeFile: vi.fn() } },
    window: { showErrorMessage: vi.fn(), showInformationMessage: vi.fn(), showSaveDialog: vi.fn(), showTextDocument: vi.fn() }
}));
import * as vscode from 'vscode';
import { ImpexTreeDataProvider, ImpexItem } from '../../src/impex/tree';
beforeEach(() => vi.clearAllMocks());
const config = () => ({ hostname: 'example.invalid', username: 'user', password: 'placeholder' });
describe('Impex UI lifecycle', () => {
    it('drops listing results when active configuration changes in flight', async () => {
        let complete!: (entries: any[]) => void;
        api.listImpexEntries.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const provider = new ImpexTreeDataProvider(config); const pending = provider.getChildren();
        provider.refresh(); complete([{ name: 'a.xml', isDirectory: false }]);
        expect(await pending).toEqual([]);
    });
    it('does not use old Environment tree items against new credentials', async () => {
        const active = config(); const provider = new ImpexTreeDataProvider(() => active);
        api.listImpexEntries.mockResolvedValue([{ name: 'src/', isDirectory: true }, { name: 'a.xml', isDirectory: false }]);
        const items = await provider.getChildren(); active.hostname = 'other.invalid'; provider.refresh();
        await provider.openFile(items[1]); expect(api.fetchImpexFileBuffer).not.toHaveBeenCalled();
        api.listImpexEntries.mockClear(); expect(await provider.getChildren(items[0])).toEqual([]);
        expect(api.listImpexEntries).not.toHaveBeenCalled();
    });
    it('opens text snapshots and downloads binary bytes without uploading', async () => {
        const provider = new ImpexTreeDataProvider(config);
        api.listImpexEntries.mockResolvedValue([{ name: 'a.xml', isDirectory: false }, { name: 'a.zip', isDirectory: false }]);
        const items = await provider.getChildren(); api.fetchImpexFileBuffer.mockResolvedValueOnce(Buffer.from('<site/>'));
        await provider.openFile(items[0]); expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith({ content: '<site/>', language: 'xml' });
        const destination = { fsPath: '/chosen/a.zip' }; (vscode.window.showSaveDialog as any).mockResolvedValue(destination);
        const bytes = Buffer.from([0, 255]); api.fetchImpexFileBuffer.mockResolvedValueOnce(bytes);
        await provider.openFile(items[1]); expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(destination, bytes);
        expect((items[0] as any).password).toBeUndefined(); expect(items[0].target).not.toContain('placeholder');
    });
    it('canceled binary destination does not fetch or write the file', async () => {
        const provider = new ImpexTreeDataProvider(config);
        api.listImpexEntries.mockResolvedValue([{ name: 'a.zip', isDirectory: false }]);
        (vscode.window.showSaveDialog as any).mockResolvedValue(undefined);
        await provider.openFile((await provider.getChildren())[0]);
        expect(api.fetchImpexFileBuffer).not.toHaveBeenCalled(); expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    });
});
