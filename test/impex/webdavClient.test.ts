import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('https', () => ({ request }));
import { parseDirectoryEntries, encodeImpexPath, listImpexEntries, fetchImpexFileBuffer } from '../../src/impex/webdavClient';
const root = '/on/demandware.servlet/webdav/Sites/Impex/';
const response = (href: string, directory = false, status = 200) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${directory ? '<d:collection/>' : ''}</d:resourcetype></d:prop><d:status>HTTP/1.1 ${status} OK</d:status></d:propstat></d:response>`;
beforeEach(() => request.mockReset());
describe('Impex WebDAV', () => {
    it('omits self, outsiders, grandchildren, failed properties and duplicates while sorting directories first', () => {
        const xml = response(root + 'src/', true) + response(root + 'src/z.xml') + response(root + 'src/a/', true) + response(root + 'src/z.xml') + response(root + 'other.xml') + response(root + 'src/a/deep.xml') + response(root + 'src/fail.xml', false, 403);
        expect(parseDirectoryEntries(xml, 'src/')).toEqual([{ name: 'a/', isDirectory: true }, { name: 'z.xml', isDirectory: false }]);
    });
    it('handles absolute hrefs, percent encoding, XML entities and alternate/no namespace', () => {
        const xml = response('https://example.invalid' + root + 'src/a%20%26%20b.xml') + response(root + 'src/c&amp;d.xml').replace(/d:/g, '') + response(root + 'src/no.xml').replace(/d:/g, 'DAV:');
        expect(parseDirectoryEntries(xml, 'src/').map(entry => entry.name)).toEqual(['a & b.xml', 'c&d.xml', 'no.xml']);
    });
    it('encodes each path segment and rejects traversal', () => {
        expect(encodeImpexPath('src/a #?.xml')).toBe('src/a%20%23%3F.xml');
        for (const input of ['/src/', 'src/../secret', 'src/./a', 'src/\\bad']) expect(() => encodeImpexPath(input)).toThrow();
        expect(parseDirectoryEntries(response(root + 'src/%2E%2E/secret'), 'src/')).toEqual([]);
    });
    const mockResponse = (status: number, body: Buffer) => {
        const req = new EventEmitter() as any; req.setTimeout = vi.fn(); req.end = vi.fn(); req.destroy = vi.fn();
        request.mockImplementation((_url, _options, callback) => {
            const res = new EventEmitter() as any; res.statusCode = status;
            // https.request also permits the optional response callback to be omitted.
            const handler = typeof _options === 'function' ? _options : callback;
            if (typeof handler === 'function') queueMicrotask(() => { handler(res); res.emit('data', body); res.emit('end'); });
            return req;
        });
        return req;
    };
    it('uses PROPFIND Depth 1 with encoded URL, Basic auth and timeout', async () => {
        const req = mockResponse(207, Buffer.from(response(root + 'src%20space/a.xml')));
        expect(await listImpexEntries('example.invalid', 'user', 'placeholder', 'src space/')).toEqual([{ name: 'a.xml', isDirectory: false }]);
        expect(request.mock.calls[0][0].pathname).toBe(root + 'src%20space/');
        expect(request.mock.calls[0][1]).toMatchObject({ method: 'PROPFIND', headers: { Depth: '1', Authorization: 'Basic ' + Buffer.from('user:placeholder').toString('base64') } });
        expect(req.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function));
    });
    it('keeps binary bytes unchanged and rejects HTTP errors', async () => {
        const bytes = Buffer.from([0, 255, 128]); mockResponse(200, bytes);
        expect(await fetchImpexFileBuffer('example.invalid', 'user', 'placeholder', 'src/a.zip')).toEqual(bytes);
        expect(request.mock.calls[0][1].method).toBe('GET');
        mockResponse(401, Buffer.from('private server response'));
        await expect(fetchImpexFileBuffer('example.invalid', 'user', 'placeholder', 'src/a.zip')).rejects.toThrow('HTTP 401');
    });
});
