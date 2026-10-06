import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
const mock = vi.hoisted(() => ({ options: null as any, request: null as any, respond: true, body: null as any }));
vi.mock('https', () => ({ Agent: class { options:any; constructor(options:any){this.options=options;} destroy(){} }, request: (options: any, callback: any) => {
    mock.options = options;
    const request: any = new EventEmitter();
    request.setTimeout = vi.fn();
    request.destroy = () => request.emit('error', new Error('stopped'));
    const chunks: Buffer[] = [];
    request.write = (chunk: Buffer) => { chunks.push(chunk); return true; };
    request.end = (body: Buffer) => { mock.body = chunks.length ? Buffer.concat(chunks) : body; if (mock.respond) queueMicrotask(() => {
        const response: any = new EventEmitter(); response.statusCode = 201; response.resume = vi.fn();
        callback(response); queueMicrotask(() => response.emit('end'));
    }); };
    mock.request = request; return request;
} }));
import { UploadClient, UploadCanceled, UploadRequestError } from '../../src/upload/client';
const target = { hostname: 'test.invalid', username: 'user', password: 'placeholder', version: 'v1' };
beforeEach(() => { mock.options = null; mock.request = null; mock.respond = true; mock.body = null; });
describe('Upload HTTPS transport', () => {
    it('uses the captured target, encoded path segments and binary content', async () => {
        const client = new UploadClient(target); const bytes = Buffer.from([0, 255]);
        expect(await client.request('PUT', ['app', 'cartridge', 'a b#.png'], bytes)).toBe(201);
        expect(mock.options.hostname).toBe('test.invalid');
        expect(mock.options.agent.options).toEqual({keepAlive:true,maxSockets:5,maxFreeSockets:5});
        expect(mock.options.path).toBe('/on/demandware.servlet/webdav/Sites/Cartridges/v1/app/cartridge/a%20b%23.png');
        expect(mock.options.headers.Authorization).toBe(`Basic ${Buffer.from('user:placeholder').toString('base64')}`);
        expect(mock.body).toEqual(bytes); client.dispose();
    });
    it('uses the configured connection limit', async () => {
        const client = new UploadClient(target, 8);
        await client.request('PUT', ['app', 'cartridge', 'x']);
        expect(mock.options.agent.options).toEqual({keepAlive:true,maxSockets:8,maxFreeSockets:8}); client.dispose();
    });
    it('streams ZIP bytes with length/type and uses form encoding for UNZIP', async () => {
        const client = new UploadClient(target); const bytes=Buffer.from([0,255,128]);
        await client.request('PUT',['temp.zip'],Readable.from([bytes]),{contentType:'application/zip',contentLength:3,timeoutMs:300000});
        expect(mock.body).toEqual(bytes);expect(mock.options.headers['Content-Length']).toBe(3);
        expect(mock.options.headers['Content-Type']).toBe('application/zip');expect(mock.request.setTimeout).toHaveBeenCalledWith(300000,expect.any(Function));
        await client.request('POST',['temp.zip'],Buffer.from('method=UNZIP'),{contentType:'application/x-www-form-urlencoded'});
        expect(mock.options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');expect(mock.body.toString()).toBe('method=UNZIP');client.dispose();
    });
    it('rejects invalid hosts and code versions before any request', () => {
        expect(() => new UploadClient({ ...target, hostname: 'https://test.invalid/path' })).toThrow('valid code version');
        expect(() => new UploadClient({ ...target, version: '../other' })).toThrow('valid code version');
        expect(mock.request).toBeNull();
    });
    it('preserves safe network code/method/path without raw error text', async () => {
        mock.respond=false;const client=new UploadClient(target);
        const pending=client.request('PUT',['temp.zip']);
        const rejected=expect(pending).rejects.toMatchObject({code:'ECONNRESET',message:'PUT temp.zip failed (ECONNRESET).'});
        mock.request.emit('error',Object.assign(new Error('secret credentials / raw request'),{code:'ECONNRESET'}));await rejected;client.dispose();
    });
    it('preserves timeout instead of replacing it with a generic connection error', async () => {
        mock.respond=false;const client=new UploadClient(target);
        const pending=client.request('POST',['temp.zip']);const rejected=expect(pending).rejects.toMatchObject({code:'ETIMEDOUT'});
        mock.request.destroy=(error:any)=>mock.request.emit('error',error);
        mock.request.setTimeout.mock.calls[0][1]();await rejected;client.dispose();
    });
    it('cleans only a temporary ZIP on its captured target after dispose', async () => {
        const active={...target};const client=new UploadClient(active);client.dispose();active.hostname='other.invalid';
        expect(await client.cleanupZip(['dw-manager-app-8fadf766-39a3-41d5-bcfc-fc19775dddc5.zip'])).toBe(201);
        expect(mock.options.hostname).toBe('test.invalid');expect(mock.options.method).toBe('DELETE');
        expect(mock.request.setTimeout).toHaveBeenCalledWith(10000,expect.any(Function));
        await expect(client.cleanupZip(['app','cartridge'])).rejects.toThrow('Invalid temporary ZIP');
    });
    it('rejects traversal in remote paths', async () => {
        const client = new UploadClient(target);
        await expect(client.request('DELETE', ['app', '..'])).rejects.toThrow('Invalid upload path');
        expect(mock.request).toBeNull(); client.dispose();
    });
    it('abort rejects the active request and prevents later requests', async () => {
        mock.respond = false; const client = new UploadClient(target);
        const pending = client.request('PUT', ['app', 'cartridge', 'x']); client.dispose();
        await expect(pending).rejects.toBeInstanceOf(UploadCanceled);
        await expect(client.request('PUT', ['app', 'cartridge', 'x'])).rejects.toBeInstanceOf(UploadCanceled);
    });
});
