import * as https from 'https';
import type { IncomingHttpHeaders } from 'http';
import { URL } from 'url';

export interface WebdavResponse {
    status: number;
    body: string;
    headers: IncomingHttpHeaders;
}

function basicAuthHeader(username: string, password: string): string {
    return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

export function webdavGet(url: string, username: string, password: string, extraHeaders: Record<string, string> = {}): Promise<WebdavResponse> {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const req = https.request({
            hostname: target.hostname,
            port: target.port || 443,
            path: target.pathname + target.search,
            method: 'GET',
            headers: {
                Authorization: basicAuthHeader(username, password),
                ...extraHeaders
            }
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve({
                status: res.statusCode || 0,
                body: Buffer.concat(chunks).toString('utf-8'),
                headers: res.headers
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Pure HTML-anchor scraper for the SFCC WebDAV directory listing — no vscode
 * or network dependency, so it can be unit tested directly.
 */
export function parseLogFileNames(directoryHtml: string): string[] {
    const names = new Set<string>();
    const linkPattern = /href="([^"?]+\.log)"/gi;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(directoryHtml))) {
        names.add(decodeURIComponent(match[1]));
    }
    return Array.from(names).sort().reverse();
}

function logsBaseUrl(hostname: string): string {
    return `https://${hostname}/on/demandware.servlet/webdav/Sites/Logs/`;
}

export async function listLogFiles(hostname: string, username: string, password: string): Promise<string[]> {
    const result = await webdavGet(logsBaseUrl(hostname), username, password);
    if (result.status < 200 || result.status >= 300) {
        throw new Error(`Failed to list logs (HTTP ${result.status})`);
    }
    return parseLogFileNames(result.body);
}

export interface LogTailResult {
    status: number;
    body: string;
}

/**
 * Fetches the tail of a log file starting at `fromByte`. Servers that honor
 * Range requests return 206 with just the new bytes; servers that don't
 * return 200 with the whole file — callers must handle both.
 */
export async function fetchLogTail(hostname: string, username: string, password: string, fileName: string, fromByte: number): Promise<LogTailResult> {
    const url = logsBaseUrl(hostname) + encodeURIComponent(fileName);
    const headers: Record<string, string> = fromByte > 0 ? { Range: `bytes=${fromByte}-` } : {};
    const result = await webdavGet(url, username, password, headers);

    if (result.status === 416) {
        return { status: 416, body: '' };
    }
    if (result.status !== 200 && result.status !== 206) {
        throw new Error(`Failed to fetch log "${fileName}" (HTTP ${result.status})`);
    }

    return { status: result.status, body: result.body };
}
