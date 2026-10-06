import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UploadEngine } from '../../src/upload/engine';
import { UploadCanceled, UploadRequestError } from '../../src/upload/client';

let root: string, cartridge: { name: string; root: string }, client: any, status: any, log: any, engine: UploadEngine;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-upload-'));
    cartridge = { name: 'app', root: path.join(root, 'app') };
    fs.mkdirSync(path.join(cartridge.root, 'cartridge', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(cartridge.root, '.project'), '<project/>');
    fs.writeFileSync(path.join(cartridge.root, 'cartridge', 'scripts', 'test.js'), 'code');
    client = { request: vi.fn(async (method: string) => method === 'PROPFIND' ? 207 : method === 'MKCOL' ? 201 : 204), dispose: vi.fn() };
    status = vi.fn(); log = vi.fn(); engine = new UploadEngine([cartridge], client, status, log);
});
afterEach(() => { vi.restoreAllMocks(); engine.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
const unzipper = require('unzipper');
async function zipEntries(stream: any): Promise<string[]> {
    const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(chunk);
    const archive=await unzipper.Open.buffer(Buffer.concat(chunks));return archive.files.map((file:any)=>file.path).sort();
}
function extraCartridges(count:number) {
    return Array.from({length:count},(_,index)=>{
        const item={name:'app'+index,root:path.join(root,'app'+index)};
        fs.mkdirSync(path.join(item.root,'cartridge'),{recursive:true});fs.writeFileSync(path.join(item.root,'cartridge','test.js'),'code');return item;
    });
}
describe('Scoped WebDAV upload engine', () => {
    it('deploys one scoped ZIP then UNZIP and deletes only its temporary ZIP',async()=>{
        fs.writeFileSync(path.join(cartridge.root,'dw.json'),'placeholder');
        fs.mkdirSync(path.join(cartridge.root,'cartridge','node_modules'));fs.writeFileSync(path.join(cartridge.root,'cartridge','node_modules','ignore.js'),'ignore');
        fs.writeFileSync(path.join(cartridge.root,'cartridge','a.zip'),'ignore');
        fs.symlinkSync(root,path.join(cartridge.root,'cartridge','link'));
        let entries:string[]=[];
        client.request.mockImplementation(async(method:string,_segments:string[],body:any)=>{
            if(method==='PUT')entries=await zipEntries(body);
            return method==='PROPFIND'?207:204;
        });
        await engine.uploadAll();
        expect(entries).toEqual(['app/.project','app/cartridge/scripts/test.js']);
        const calls=client.request.mock.calls;expect(calls.map((call:any[])=>call[0])).toEqual(['PROPFIND','PUT','POST','DELETE']);
        const remote=calls[1][1];expect(remote).toEqual([expect.stringMatching(/^dw-manager-app-.*\.zip$/)]);
        expect(calls[2]).toEqual(['POST',remote,Buffer.from('method=UNZIP'),{contentType:'application/x-www-form-urlencoded',timeoutMs:300000}]);
        expect(calls[3]).toEqual(['DELETE',remote]);
        expect(status).toHaveBeenLastCalledWith({state:'watching',completed:1,total:1,cartridgesCompleted:1,cartridgesTotal:1});
        expect(log).toHaveBeenCalledWith('[app] Upload complete.');
    });
    it('archives and watches modules root files without a cartridge subfolder',async()=>{
        const modules={name:'modules',root:path.join(root,'modules'),layout:'modules' as const};fs.mkdirSync(path.join(modules.root,'server'),{recursive:true});
        for(const file of ['server.js','synchronous-promise.js','server/index.js','.project','dw.json','dw.js','dw-manager.json','.env'])fs.writeFileSync(path.join(modules.root,file),'code');
        engine.dispose();engine=new UploadEngine([modules],client,status,log);
        let entries:string[]=[];
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{if(method==='PUT'&&body?.pipe)entries=await zipEntries(body);return method==='PROPFIND'?207:method==='MKCOL'?201:204;});
        await engine.uploadAll();expect(entries).toEqual(['modules/.project','modules/server.js','modules/server/index.js','modules/synchronous-promise.js']);
        await engine.change(modules,path.join(modules.root,'server.js'));
        expect(client.request).toHaveBeenCalledWith('PUT',['modules','server.js'],Buffer.from('code'));
        const count=client.request.mock.calls.length;await engine.change(modules,path.join(modules.root,'dw.json'),true);expect(client.request.mock.calls.length).toBe(count);
        await engine.change(modules,path.join(modules.root,'server','deleted.js'),true);expect(client.request).toHaveBeenCalledWith('DELETE',['modules','server','deleted.js']);
    });
    it('limits concurrent ZIP deployments and shares code-version validation',async()=>{
        const cartridges=extraCartridges(7);engine.dispose();engine=new UploadEngine(cartridges,client,status,log,2);
        let active=0,peak=0,done=false;const release:(()=>void)[]=[];
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{
            if(method!=='PUT')return method==='PROPFIND'?207:204;
            await zipEntries(body);active++;peak=Math.max(peak,active);
            await new Promise<void>(resolve=>release.push(()=>{active--;resolve();}));return 204;
        });
        const batch=engine.uploadAll().finally(()=>{done=true;});await vi.waitFor(()=>expect(active).toBe(2));
        while(!done){release.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setTimeout(resolve,5));}
        await batch;expect(peak).toBe(2);expect(client.request.mock.calls.filter((call:any[])=>call[0]==='PROPFIND')).toHaveLength(1);
        expect(status).toHaveBeenLastCalledWith({state:'watching',completed:7,total:7,cartridgesCompleted:7,cartridgesTotal:7});
    });
    it('applies custom ignores to ZIP contents and watched deletions',async()=>{
        fs.writeFileSync(path.join(cartridge.root,'cartridge','skip.js'),'ignore');
        engine.dispose();engine=new UploadEngine([cartridge],client,status,log,5,['skip\\.js$']);
        let entries:string[]=[];client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{if(method==='PUT')entries=await zipEntries(body);return method==='PROPFIND'?207:204;});
        await engine.uploadAll();expect(entries).not.toContain('app/cartridge/skip.js');
        const before=client.request.mock.calls.length;await engine.change(cartridge,path.join(cartridge.root,'cartridge','skip.js'),true);expect(client.request.mock.calls.length).toBe(before);
    });
    it('holds watch changes until ZIP extraction and cleanup finish',async()=>{
        let extract:(()=>void)|undefined;
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{
            if(method==='PUT'&&body?.pipe)await zipEntries(body);
            if(method==='POST')await new Promise<void>(resolve=>{extract=resolve;});
            return method==='PROPFIND'?207:method==='MKCOL'?201:204;
        });
        const batch=engine.uploadAll();await vi.waitFor(()=>expect(extract).toBeTypeOf('function'));
        const changed=engine.change(cartridge,path.join(cartridge.root,'cartridge','scripts','test.js'));
        await new Promise(resolve=>setTimeout(resolve,10));expect(client.request.mock.calls.filter((call:any[])=>call[0]==='PUT')).toHaveLength(1);
        extract!();await batch;await changed;expect(client.request.mock.calls.filter((call:any[])=>call[0]==='PUT')).toHaveLength(2);
    });
    it('reports the failing ZIP stage/path and cleans its ZIP after denied UNZIP',async()=>{
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{if(method==='PUT')await zipEntries(body);return method==='PROPFIND'?207:method==='POST'?403:204;});
        await expect(engine.uploadAll()).rejects.toThrow(/UNZIP dw-manager-app-.*HTTP 403/);
        expect(client.request.mock.calls.filter((call:any[])=>call[0]==='DELETE')).toHaveLength(1);
        expect(status.mock.calls.some((call:any[])=>call[0].state==='watching')).toBe(false);
    });
    it('cancels active ZIPs and starts no queued cartridges',async()=>{
        const cartridges=extraCartridges(5);engine.dispose();engine=new UploadEngine(cartridges,client,status,log,2);
        const rejectors:((error:unknown)=>void)[]=[];
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{
            if(method!=='PUT')return 207;await zipEntries(body);return new Promise((_resolve,reject)=>rejectors.push(reject));
        });
        client.dispose.mockImplementation(()=>rejectors.splice(0).forEach(reject=>reject(new UploadCanceled())));
        const batch=engine.uploadAll();const rejected=expect(batch).rejects.toBeInstanceOf(UploadCanceled);
        await vi.waitFor(()=>expect(rejectors).toHaveLength(2));engine.dispose();await rejected;
        expect(client.request.mock.calls.filter((call:any[])=>call[0]==='PUT')).toHaveLength(2);
        expect(client.request.mock.calls.some((call:any[])=>call[0]==='POST')).toBe(false);
    });
    it('reopens the ZIP stream on a transient PUT failure and completes without canceling the batch',async()=>{
        const timer=setTimeout;vi.spyOn(global,'setTimeout').mockImplementation(((fn:any,ms:any,...args:any[])=>timer(fn,ms===4000?0:ms,...args)) as any);
        let attempts=0;const entries:string[][]=[];
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{
            if(method==='PUT') {entries.push(await zipEntries(body));if(++attempts===1)throw new UploadRequestError('PUT',['temp.zip'],'ECONNRESET');}
            return method==='PROPFIND'?207:204;
        });
        await engine.uploadAll();expect(attempts).toBe(2);expect(entries[0]).toEqual(entries[1]);
        expect(status.mock.calls.at(-1)[0].state).toBe('watching');expect(log).toHaveBeenCalledWith(expect.stringContaining('Retry 1/3'));
    });
    it('cleans an owned ZIP after cancellation using the cleanup transport',async()=>{
        const cleanup=vi.fn(async()=>204);client.cleanupZip=cleanup;
        let rejectPut:((error:unknown)=>void)|undefined;
        client.request.mockImplementation(async(method:string,_path:string[],body:any)=>{if(method==='PUT'){await zipEntries(body);return new Promise((_resolve,reject)=>{rejectPut=reject;});}return 207;});
        client.dispose.mockImplementation(()=>rejectPut?.(new UploadCanceled()));
        const pending=engine.uploadAll();const rejected=expect(pending).rejects.toBeInstanceOf(UploadCanceled);
        await vi.waitFor(()=>expect(rejectPut).toBeTypeOf('function'));engine.dispose();await rejected;
        expect(cleanup).toHaveBeenCalledWith([expect.stringMatching(/^dw-manager-app-.*\.zip$/)]);
        expect(log.mock.calls.some((call:any[])=>call[0].includes('temporary ZIP may remain'))).toBe(false);
    });
    it('does not send an empty ignored cartridge',async()=>{
        engine.dispose();engine=new UploadEngine([cartridge],client,status,log,5,['.*']);
        await engine.uploadAll();expect(client.request.mock.calls).toEqual([['PROPFIND',[]]]);
        expect(status.mock.calls.at(-1)[0].cartridgesCompleted).toBe(1);
    });
    it('does no HTTP requests when constructed for watch-only', () => { expect(client.request).not.toHaveBeenCalled(); });
    it('syncs a changed binary file without rewriting other files', async () => {
        const filename = path.join(cartridge.root, 'cartridge', 'image.png'); const bytes = Buffer.from([0, 255, 128]); fs.writeFileSync(filename, bytes);
        await engine.change(cartridge, filename);
        expect(client.request.mock.calls.filter((call: any[]) => call[0] === 'PUT')).toEqual([['PUT', ['app', 'cartridge', 'image.png'], bytes]]);
    });
    it('deletes only a changed file inside the selected cartridge', async () => {
        await engine.change(cartridge, path.join(cartridge.root, 'cartridge', 'gone.js'), true);
        expect(client.request).toHaveBeenCalledWith('DELETE', ['app', 'cartridge', 'gone.js']);
        expect(log).toHaveBeenCalledWith('[D] app/cartridge/gone.js');
    });
    it('rejects another cartridge and ignores path traversal and symlinks', async () => {
        await expect(engine.change({ name: 'other', root: cartridge.root }, path.join(cartridge.root, 'cartridge', 'x'))).rejects.toThrow('outside');
        await engine.change(cartridge, path.join(root, 'outside.js'));
        fs.symlinkSync(root, path.join(cartridge.root, 'cartridge', 'link'));
        await engine.change(cartridge, path.join(cartridge.root, 'cartridge', 'link', 'outside.js'));
        expect(client.request).not.toHaveBeenCalled();
    });
    it('does not create a missing code version or write after validation failure', async () => {
        client.request.mockResolvedValue(404);
        await expect(engine.uploadAll()).rejects.toThrow('HTTP 404');
        expect(client.request.mock.calls).toEqual([['PROPFIND', []]]);
    });
    it('stops at a failed PUT without reporting completion', async () => {
        client.request.mockImplementation(async (method: string) => method === 'PUT' ? 401 : method === 'PROPFIND' ? 207 : 201);
        await expect(engine.uploadAll()).rejects.toThrow('HTTP 401');
        expect(status.mock.calls.some((call: any[]) => call[0].state === 'watching')).toBe(false);
    });
    it('uploads independent watched files concurrently while keeping aggregate progress', async () => {
        const first=path.join(cartridge.root,'cartridge','scripts','test.js'),second=path.join(cartridge.root,'cartridge','scripts','second.js');fs.writeFileSync(second,'code');
        const release=new Map<string,()=>void>();
        client.request.mockImplementation(async(method:string,segments:string[])=>{if(method!=='PUT')return method==='PROPFIND'?207:201;await new Promise<void>(resolve=>release.set(segments.at(-1)!,resolve));return 204;});
        const one=engine.change(cartridge,first),two=engine.change(cartridge,second);
        await vi.waitFor(()=>expect(release.size).toBe(2));
        release.get('test.js')!();await one;expect(status.mock.calls.at(-1)[0]).toEqual({state:'uploading',completed:1,total:2});
        release.get('second.js')!();await two;expect(status).toHaveBeenLastCalledWith({state:'watching',completed:2,total:2});
    });
    it('creates directories for new nested files in order', async () => {
        await engine.change(cartridge, path.join(cartridge.root, 'cartridge', 'scripts', 'test.js'));
        expect(client.request.mock.calls.filter((call: any[]) => call[0] === 'MKCOL').map((call: any[]) => call[1])).toEqual([['app'], ['app', 'cartridge'], ['app', 'cartridge', 'scripts']]);
    });
});
