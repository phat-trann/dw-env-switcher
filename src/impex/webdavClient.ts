import * as https from 'https';

export interface ImpexEntry { name: string; isDirectory: boolean; }
const ROOT = '/on/demandware.servlet/webdav/Sites/Impex/';

function decodeXml(value: string): string {
    return value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi, (_, numeric: string, named: string) =>
        numeric ? String.fromCodePoint(numeric.startsWith('x') ? parseInt(numeric.slice(1), 16) : Number(numeric)) :
            ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named]);
}

export function encodeImpexPath(relativePath: string): string {
    const segments = relativePath.split('/');
    if (relativePath.startsWith('/') || segments.some(segment => segment === '.' || segment === '..' || segment.includes('\\'))) {
        throw new Error('Invalid Impex path.');
    }
    return segments.map(segment => encodeURIComponent(segment)).join('/');
}

/** Parse Depth: 1 responses; omit the collection itself and entries outside it. */
export function parseDirectoryEntries(xml: string, currentRelativePath = ''): ImpexEntry[] {
    const current = currentRelativePath.replace(/\/?$/, '/').replace(/^\/$/, '');
    const entries = new Map<string, ImpexEntry>();
    const responses = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
    let match: RegExpExecArray | null;
    while ((match = responses.exec(xml))) {
        const block = match[1];
        const href = /<(?:[\w-]+:)?href\b[^>]*>([^<]*)<\/(?:[\w-]+:)?href>/i.exec(block);
        if (!href) continue;
        let relative: string;
        try {
            const pathname = new URL(decodeXml(href[1].trim()), 'https://impex.invalid').pathname;
            if (!pathname.startsWith(ROOT)) continue;
            relative = decodeURIComponent(pathname.slice(ROOT.length));
            encodeImpexPath(relative);
        } catch { continue; }
        if (!relative.startsWith(current)) continue;
        const name = relative.slice(current.length).replace(/\/$/, '');
        if (!name || name.includes('/')) continue;
        // Only successful properties describe the resource type.
        const propstats = [...block.matchAll(/<(?:[\w-]+:)?propstat\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/gi)];
        const properties = propstats.length ? propstats.filter(part => /HTTP\/[^ ]+ 2\d\d\b/i.test(part[1])).map(part => part[1]).join('') : block;
        if (propstats.length && !properties) continue;
        const isDirectory = /<(?:[\w-]+:)?collection\b/i.test(properties);
        entries.set(name, { name: name + (isDirectory ? '/' : ''), isDirectory });
    }
    return [...entries.values()].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
}

async function request(hostname: string, username: string, password: string, relativePath: string, method: 'GET' | 'PROPFIND'): Promise<Buffer> {
    const target = new URL(`https://${hostname}${ROOT}${encodeImpexPath(relativePath)}`);
    return new Promise((resolve, reject) => {
        const req = https.request(target, { method, headers: {
            Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
            ...(method === 'PROPFIND' ? { Depth: '1' } : {})
        } }, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => {
                const status = res.statusCode ?? 0;
                if (status < 200 || status >= 300) reject(new Error(`Impex request failed (HTTP ${status}).`));
                else resolve(Buffer.concat(chunks));
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('Impex request timed out.')));
        req.on('error', reject); req.end();
    });
}

export async function listImpexEntries(hostname: string, username: string, password: string, relativePath: string): Promise<ImpexEntry[]> {
    return parseDirectoryEntries((await request(hostname, username, password, relativePath, 'PROPFIND')).toString('utf8'), relativePath);
}
export async function fetchImpexFileBuffer(hostname: string, username: string, password: string, relativePath: string): Promise<Buffer> {
    return request(hostname, username, password, relativePath, 'GET');
}
