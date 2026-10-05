import { randomUUID } from 'crypto';
import { ActiveConfig, Environment, ManagerConfig, Site } from '../types';

export function emptyConfig(): ManagerConfig {
    return { schemaVersion: 2, environments: [], sites: [] };
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateConfig(value: unknown): asserts value is ManagerConfig {
    if (!object(value) || value.schemaVersion !== 2 || !Array.isArray(value.environments) || !Array.isArray(value.sites)) {
        throw new Error('Expected schemaVersion 2 with environments and sites arrays.');
    }
    const ids = new Set<string>();
    for (const [records, fields] of [
        [value.environments, ['id', 'name', 'hostname', 'username', 'password', 'version']],
        [value.sites, ['id', 'name', 'cartridgesPath']]
    ] as [unknown[], string[]][]) {
        for (const record of records) {
            if (!object(record) || fields.some(key => typeof record[key] !== 'string') || !record.id || !record.name) {
                throw new Error('Invalid Environment or Site fields.');
            }
            if (ids.has(record.id as string)) throw new Error('Environment/Site IDs must be unique.');
            ids.add(record.id as string);
        }
    }
}

export function composeActive(config: ManagerConfig, environmentId?: string, siteId?: string, previous: ActiveConfig = {}): ActiveConfig | undefined {
    const env = config.environments.find(entry => entry.id === environmentId);
    const site = config.sites.find(entry => entry.id === siteId);
    if (!env || !site) return undefined;
    // Preserve unrelated tool-specific options, but remove obsolete managed fields.
    const { name, 'code-version': oldVersion, cartridges, ...extra } = previous;
    return { ...extra, name: site.name, environmentId: env.id, siteId: site.id,
        hostname: env.hostname, username: env.username, password: env.password,
        version: env.version, cartridgesPath: site.cartridgesPath };
}

/** dw.json is authoritative on open/external edits, only when BOTH IDs exist. */
export function reflectActive(config: ManagerConfig, active: ActiveConfig): boolean {
    if (typeof active.environmentId !== 'string' || !active.environmentId || typeof active.siteId !== 'string' || !active.siteId) return false;
    if (['hostname', 'username', 'password', 'version', 'cartridgesPath'].some(key => typeof active[key] !== 'string')) return false;
    let changed = false;
    const fields = ['hostname', 'username', 'password', 'version'] as const;
    let env = config.environments.find(entry => entry.id === active.environmentId);
    if (!env) {
        if (config.sites.some(site => site.id === active.environmentId)) return false;
        env = { id: active.environmentId, name: `Environment ${active.environmentId}`, hostname: '', username: '', password: '', version: '' };
    }
    // Validate cross-section identity before changing either section.
    let site = config.sites.find(entry => entry.id === active.siteId);
    if ((!site && config.environments.some(entry => entry.id === active.siteId)) || active.siteId === active.environmentId) return false;
    if (!config.environments.includes(env)) { config.environments.push(env); changed = true; }
    for (const key of fields) {
        if (env[key] !== active[key]) { env[key] = active[key] as string; changed = true; }
    }
    if (!site) {
        site = { id: active.siteId, name: `Site ${active.siteId}`, cartridgesPath: '' };
        config.sites.push(site); changed = true;
    }
    if (site.cartridgesPath !== active.cartridgesPath) { site.cartridgesPath = active.cartridgesPath as string; changed = true; }
    return changed;
}

export interface MigrationResult { config: ManagerConfig; active?: ActiveConfig; }

/** Convert both the real legacy schema and older extension-generated schemas. */
export function migrateLegacy(value: unknown, active?: ActiveConfig, makeId: () => string = randomUUID): MigrationResult {
    if (!object(value) || !Array.isArray(value.sandboxes)) throw new Error('Invalid legacy dw-envs.json.');
    const config = emptyConfig();
    const pairs: { legacy: Record<string, unknown>; environment: Environment; site: Site }[] = [];
    for (const legacy of value.sandboxes) {
        if (!object(legacy) || typeof legacy.name !== 'string' || typeof legacy.hostname !== 'string') throw new Error('Invalid legacy entry.');
        const version = legacy.version ?? legacy['code-version'];
        if (typeof version !== 'string') throw new Error('Legacy entry requires version or code-version.');
        const username = typeof legacy.username === 'string' ? legacy.username : '';
        const password = typeof legacy.password === 'string' ? legacy.password : '';
        let environment = config.environments.find(entry => entry.hostname === legacy.hostname && entry.username === username && entry.password === password && entry.version === version);
        if (!environment) {
            environment = { id: makeId(), name: legacy.name, hostname: legacy.hostname, username, password, version };
            config.environments.push(environment);
        }
        const cartridgesPath = typeof legacy.cartridgesPath === 'string' ? legacy.cartridgesPath :
            Array.isArray(legacy.cartridges) ? legacy.cartridges.join(':') : '';
        // Sites keep legacy names even when two sites share a cartridge path.
        const site: Site = { id: makeId(), name: legacy.name, cartridgesPath };
        config.sites.push(site);
        pairs.push({ legacy, environment, site });
    }
    validateConfig(config);
    const candidates = active ? pairs.filter(pair => pair.legacy.name === active.name && pair.environment.hostname === active.hostname) : [];
    const pair = candidates.length === 1 ? candidates[0] : undefined;
    if (!pair || !active || active.environmentId || active.siteId) return { config };
    const converted: ActiveConfig = { ...active, environmentId: pair.environment.id, siteId: pair.site.id,
        version: typeof active.version === 'string' ? active.version : active['code-version'] as string,
        cartridgesPath: typeof active.cartridgesPath === 'string' ? active.cartridgesPath :
            Array.isArray(active.cartridges) ? active.cartridges.join(':') : pair.site.cartridgesPath };
    reflectActive(config, converted);
    return { config, active: composeActive(config, pair.environment.id, pair.site.id, converted) };
}
