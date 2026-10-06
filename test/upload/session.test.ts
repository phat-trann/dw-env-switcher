import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const mock = vi.hoisted(() => ({ watchers: [] as any[], changes: [] as any[], disposes: vi.fn(), change: vi.fn(), request: vi.fn(), uploadAll: vi.fn(), engineDispose: vi.fn() }));
vi.mock('vscode', () => ({
    RelativePattern: class { constructor(public base: string, public pattern: string) {} },
    workspace: { findFiles: vi.fn(async()=>[]), createFileSystemWatcher: (pattern: any) => { mock.watchers.push(pattern); return {dispose:mock.disposes,onDidChange:(cb:any)=>{mock.changes.push(cb);return{dispose(){}};},onDidCreate:()=>({dispose(){}}),onDidDelete:()=>({dispose(){}})}; } }
}));
vi.mock('../../src/cartridges/discovery', async importOriginal => ({ ...await importOriginal<any>(), discoverCartridgeRoots: vi.fn(async () => []) }));
vi.mock('../../src/upload/client', () => ({ UploadClient: class {}, UploadCanceled: class extends Error {} }));
vi.mock('../../src/upload/engine', async importOriginal => {
    const original = await importOriginal<any>();
    return { ...original, UploadEngine: class { change = mock.change; uploadAll = mock.uploadAll; dispose = mock.engineDispose; } };
});
import * as vscode from 'vscode';
import { discoverCartridgeRoots } from '../../src/cartridges/discovery';
import { UploadSession, resolveUploadCartridges, uploadCartridgeNames } from '../../src/upload/session';
let root: string;
function cartridge(repo: string, name: string) { const cart = path.join(root, repo, 'cartridges', name);fs.mkdirSync(path.join(cart,'cartridge'),{recursive:true});return cart; }
beforeEach(() => { vi.clearAllMocks();mock.watchers.length=0;mock.changes.length=0;root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-upload-scope-')); });
afterEach(() => { vi.useRealTimers();fs.rmSync(root,{recursive:true,force:true}); });
describe('Upload scope and watcher session', () => {
    it('appends modules exactly once without changing explicit ordering or empty scopes',()=>{
        expect(uploadCartridgeNames('app:other')).toEqual(['app','other','modules']);
        expect(uploadCartridgeNames('app:modules:other:modules')).toEqual(['app','modules','other']);
        expect(uploadCartridgeNames('')).toEqual([]);
    });
    it('resolves a .project-backed modules root without a cartridge subfolder',async()=>{
        const modules=path.join(root,'sfra','cartridges','modules');fs.mkdirSync(modules,{recursive:true});
        fs.writeFileSync(path.join(modules,'.project'),'com.demandware.studio.core.beehiveNature');
        fs.writeFileSync(path.join(modules,'server.js'),'code');
        expect(await resolveUploadCartridges(root,['modules'])).toEqual([{name:'modules',root:fs.realpathSync(modules),layout:'modules'}]);
        fs.writeFileSync(path.join(modules,'.project'),'unrelated project');
        const missing=vi.fn();expect(await resolveUploadCartridges(root,['modules'],missing)).toEqual([]);expect(missing).toHaveBeenCalledWith('modules');
    });
    it('watches root-level modules scripts while excluding root credentials',async()=>{
        vi.useFakeTimers();mock.change.mockResolvedValue(undefined);
        const base=path.join(root,'modules');fs.mkdirSync(base);const modules=fs.realpathSync(base);
        const session=new UploadSession({},[{name:'modules',root:fs.realpathSync(modules),layout:'modules'}],vi.fn(),vi.fn());
        mock.changes[0]({scheme:'file',fsPath:path.join(modules,'server.js')});
        mock.changes[0]({scheme:'file',fsPath:path.join(modules,'dw.json')});
        await vi.advanceTimersByTimeAsync(300);expect(mock.change).toHaveBeenCalledOnce();expect(mock.change.mock.calls[0][1]).toBe(path.join(modules,'server.js'));session.dispose();
    });
    it('resolves only named Site cartridges from the Company layout', async () => {
        const app=cartridge('repo','app');cartridge('repo','other');
        expect(await resolveUploadCartridges(root,['app'])).toEqual([{name:'app',root:fs.realpathSync(app)}]);
    });
    it('warns and skips missing names while preserving valid cartridge order',async()=>{
        const app=cartridge('repo','app');const other=cartridge('repo','other');const missing=vi.fn();
        expect(await resolveUploadCartridges(root,['app','absent','other'],missing)).toEqual([{name:'app',root:fs.realpathSync(app)},{name:'other',root:fs.realpathSync(other)}]);
        expect(missing).toHaveBeenCalledWith('absent');
    });
    it('keeps the first discovered root, warns for duplicates and deduplicates requested names', async () => {
        const first=cartridge('repo1','app'),second=cartridge('repo2','app');
        vi.mocked(discoverCartridgeRoots).mockResolvedValueOnce([second,first]);
        const missing=vi.fn(),duplicate=vi.fn();
        expect(await resolveUploadCartridges(root,['app','app','missing'],missing,duplicate)).toEqual([{name:'app',root:fs.realpathSync(second)}]);
        expect(duplicate).toHaveBeenCalledOnce();expect(duplicate).toHaveBeenCalledWith({name:'app',kept:fs.realpathSync(second),skipped:[fs.realpathSync(first)]});
        expect(missing).toHaveBeenCalledWith('missing');
    });
    it('uses Prophet .project discovery order ahead of supplemental roots',async()=>{
        const first=cartridge('modern','app'),second=cartridge('legacy','app');
        for(const cart of [first,second])fs.writeFileSync(path.join(cart,'.project'),'com.demandware.studio.core.beehiveNature');
        vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([{fsPath:path.join(first,'.project')},{fsPath:path.join(second,'.project')}] as any);
        vi.mocked(discoverCartridgeRoots).mockResolvedValueOnce([second,first]);
        const duplicate=vi.fn();const carts=await resolveUploadCartridges(root,['app'],vi.fn(),duplicate);
        const query=vi.mocked(vscode.workspace.findFiles).mock.calls[0];
        expect(query).toHaveLength(2);
        expect(query[0]).toMatchObject({base:root,pattern:'**/.project'});
        expect(query[1]).toMatchObject({base:root,pattern:'**/{node_modules,.git}/**'});
        expect(carts[0].root).toBe(fs.realpathSync(first));expect(duplicate).toHaveBeenCalledWith({name:'app',kept:fs.realpathSync(first),skipped:[fs.realpathSync(second)]});
    });
    it('keeps SFRA modules when Prophet discovers it before legacy modules',async()=>{
        const first=path.join(root,'storefront-reference-architecture','cartridges','modules');
        const second=path.join(root,'samsoniteapac','modules');
        for(const cart of [first,second]){fs.mkdirSync(cart,{recursive:true});fs.writeFileSync(path.join(cart,'.project'),'com.demandware.studio.core.beehiveNature');}
        vi.mocked(vscode.workspace.findFiles).mockImplementationOnce(async include=>{
            // The previous global query reproduces the reversed choice.
            const ordered=typeof include==='string'?[second,first]:[first,second];
            return ordered.map(cart=>({fsPath:path.join(cart,'.project')})) as any;
        });
        vi.mocked(discoverCartridgeRoots).mockResolvedValueOnce([second,first]);
        const duplicate=vi.fn();const carts=await resolveUploadCartridges(root,['modules'],vi.fn(),duplicate);
        expect(carts).toEqual([{name:'modules',root:fs.realpathSync(first),layout:'modules'}]);
        expect(duplicate).toHaveBeenCalledWith({name:'modules',kept:fs.realpathSync(first),skipped:[fs.realpathSync(second)]});
    });
    it('does not accept a symlink cartridge root', async () => {
        const app=cartridge('repo','app');fs.symlinkSync(app,path.join(root,'repo','cartridges','linked'));
        const missing=vi.fn();expect(await resolveUploadCartridges(root,['linked'],missing)).toEqual([]);expect(missing).toHaveBeenCalledWith('linked');
    });
    it('starts only selected watchers without performing an initial upload', () => {
        const app=cartridge('repo','app');const session=new UploadSession({},[{name:'app',root:app}],vi.fn(),vi.fn());
        expect(mock.watchers.map(watcher=>watcher.base)).toEqual([app]);expect(mock.uploadAll).not.toHaveBeenCalled();session.dispose();
    });
    it('coalesces file changes and stops pending uploads when disabled', async () => {
        vi.useFakeTimers();mock.change.mockResolvedValue(undefined);
        const app=cartridge('repo','app');const session=new UploadSession({},[{name:'app',root:app}],vi.fn(),vi.fn());
        expect(mock.uploadAll).not.toHaveBeenCalled();expect(mock.watchers).toHaveLength(1);
        const uri={scheme:'file',fsPath:path.join(app,'cartridge','test.js')};mock.changes[0](uri);mock.changes[0](uri);
        await vi.advanceTimersByTimeAsync(300);expect(mock.change).toHaveBeenCalledOnce();
        mock.changes[0](uri);session.dispose();await vi.advanceTimersByTimeAsync(300);expect(mock.change).toHaveBeenCalledOnce();expect(mock.engineDispose).toHaveBeenCalled();
    });
    it('uses custom 200ms debounce and skips ignored directory descendants', async () => {
        vi.useFakeTimers();mock.change.mockResolvedValue(undefined);
        const app=cartridge('repo','app');const session=new UploadSession({},[{name:'app',root:app}],vi.fn(),vi.fn(),undefined,5,{watchDebounceMs:200,ignore:['generated/']});
        mock.changes[0]({scheme:'file',fsPath:path.join(app,'cartridge','generated','test.js')});
        mock.changes[0]({scheme:'file',fsPath:path.join(app,'cartridge','test.js')});
        await vi.advanceTimersByTimeAsync(199);expect(mock.change).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);expect(mock.change).toHaveBeenCalledOnce();session.dispose();
    });
    it('stops watcher and reports a failed request', async () => {
        vi.useFakeTimers();mock.change.mockRejectedValueOnce(new Error('HTTP 401'));
        const app=cartridge('repo','app'),failed=vi.fn();const session=new UploadSession({},[{name:'app',root:app}],vi.fn(),failed);
        mock.changes[0]({scheme:'file',fsPath:path.join(app,'cartridge','test.js')});await vi.advanceTimersByTimeAsync(300);
        expect(failed).toHaveBeenCalledWith('HTTP 401');expect(mock.disposes).toHaveBeenCalled();session.dispose();
    });
});
