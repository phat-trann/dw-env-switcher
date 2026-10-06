import { DEFAULT_UPLOAD_CONCURRENCY, resolveUploadConcurrency } from './config';
import * as https from 'https';
import { Readable } from 'stream';
import { ClientRequest } from 'http';
import { ActiveConfig } from '../types';

export class UploadCanceled extends Error { constructor() { super('Upload canceled'); } }
export class UploadRequestError extends Error {
    constructor(method: string, segments: string[], readonly code: string) {
        super(`${method} ${segments.join('/') || '[code version]'} failed (${code}).`);
    }
}
const SAFE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE', 'EPROTO', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'LOCAL_READ_FAILED']);
export interface DavRequestOptions { contentType?: string; contentLength?: number; timeoutMs?: number; }
export interface DavTransport { cleanupZip?(segments: string[]): Promise<number>; request(method: string, segments: string[], body?: Buffer | Readable, options?: DavRequestOptions): Promise<number>; dispose(): void; }

export class UploadClient implements DavTransport {
    private agent: https.Agent;
    private requests = new Set<ClientRequest>();
    private stopped = false;
    private hostname: string;
    private version: string;
    private authorization: string;
    private target: ActiveConfig;
    constructor(active: ActiveConfig, concurrency = DEFAULT_UPLOAD_CONCURRENCY) {
        resolveUploadConcurrency({ concurrency });
        if (!active.hostname || !/^[a-z0-9.-]+$/i.test(active.hostname) || !active.username || !active.password ||
            !active.version || !/^[a-z0-9_.-]+$/i.test(active.version) || ['.', '..'].includes(active.version)) {
            throw new Error('Upload requires a hostname, credentials and a valid code version.');
        }
        this.agent = new https.Agent({ keepAlive: true, maxSockets: concurrency, maxFreeSockets: concurrency });
        this.target = { ...active };
        this.hostname = active.hostname;
        this.version = active.version;
        this.authorization = `Basic ${Buffer.from(`${active.username}:${active.password}`).toString('base64')}`;
    }
    request(method: string, segments: string[], body?: Buffer | Readable, options: DavRequestOptions = {}): Promise<number> {
        if (this.stopped) return Promise.reject(new UploadCanceled());
        if (segments.some(part => !part || part === '.' || part === '..' || /[/\\\0]/.test(part))) return Promise.reject(new Error('Invalid upload path.'));
        const failed = (error?: unknown) => {
            const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
            return this.stopped ? new UploadCanceled() : new UploadRequestError(method, segments, typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code : 'CONNECTION_FAILED');
        };
        return new Promise((resolve, reject) => {
            const request = https.request({ hostname: this.hostname, method, agent: this.agent,
                path: `/on/demandware.servlet/webdav/Sites/Cartridges/${[this.version, ...segments].map(encodeURIComponent).join('/')}`,
                headers: { Authorization: this.authorization, Depth: '0', 'Content-Type': options.contentType ?? 'application/octet-stream', ...(options.contentLength !== undefined ? { 'Content-Length': options.contentLength } : Buffer.isBuffer(body) ? { 'Content-Length': body.length } : {}) }
            }, response => {
                response.resume();
                response.on('end', () => { this.requests.delete(request); resolve(response.statusCode ?? 0); });
                response.on('aborted', () => { this.requests.delete(request); reject(failed({ code: 'ECONNRESET' })); });
                response.on('error', error => { this.requests.delete(request); reject(failed(error)); });
            });
            this.requests.add(request);
            request.setTimeout(options.timeoutMs ?? 60000, () => request.destroy(Object.assign(new Error('Upload timed out.'), { code: 'ETIMEDOUT' })));
            request.on('error', error => { this.requests.delete(request); reject(failed(error)); });
            if (body instanceof Readable) {
                request.once('close', () => body.destroy());
                body.once('error', () => request.destroy(Object.assign(new Error('Cannot read upload archive.'), { code: 'LOCAL_READ_FAILED' })));
                body.pipe(request);
            } else request.end(body);
        });
    }
    async cleanupZip(segments: string[]): Promise<number> {
        if (segments.length !== 1 || !/^dw-manager-[a-z0-9_.-]+-[0-9a-f-]{36}\.zip$/i.test(segments[0])) throw new Error('Invalid temporary ZIP cleanup path.');
        // The main agent has already been aborted on Stop/failure. This client stays bound to its old target.
        const cleanup = new UploadClient(this.target, 1);
        try { return await cleanup.request('DELETE', segments, undefined, { timeoutMs: 10000 }); }
        finally { cleanup.dispose(); }
    }
    dispose(): void { this.stopped = true; for (const request of this.requests) request.destroy(); this.requests.clear(); this.agent.destroy(); }
}
