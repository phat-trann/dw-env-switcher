import { UploadCanceled, UploadRequestError } from './client';
export class UploadHttpError extends Error {
    constructor(message: string, readonly statusCode: number) { super(message); }
}
const NETWORK_RETRY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE']);
function transient(error: unknown): boolean {
    return error instanceof UploadRequestError && NETWORK_RETRY_CODES.has(error.code) ||
        error instanceof UploadHttpError && [429, 500, 502, 503, 504].includes(error.statusCode);
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new UploadCanceled());
    return new Promise((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(new UploadCanceled()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
        signal.addEventListener('abort', cancel, { once: true });
    });
}
/** Same three-retry count and 4/6/8s backoff as Prophet; permission/TLS errors fail immediately. */
export async function retryUploadOperation(action: () => Promise<void>, signal: AbortSignal, notify: (retry: number, error: Error) => void): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        if (signal.aborted) throw new UploadCanceled();
        try { await action(); return; }
        catch (error) {
            if (signal.aborted) throw new UploadCanceled();
            if (attempt >= 3 || !transient(error)) throw error;
            notify(attempt + 1, error as Error);
            await delay(2000 * (attempt + 2), signal);
        }
    }
}
