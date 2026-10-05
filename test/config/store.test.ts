import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../src/config/store';
import { Environment, Site } from '../../src/types';

let root: string;
const env: Environment = { id: 'env1', name: 'Dev', hostname: 'dev.invalid', username: 'user', password: 'placeholder', version: 'v1' };
const site: Site = { id: 'site1', name: 'Store', cartridgesPath: 'custom:base' };
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(root, name), JSON.stringify(data));
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
function store() { const s = new ConfigStore(root); s.load(); s.upsert('environment', env); s.upsert('site', site); return s; }
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-manager-store-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ConfigStore selection and startup', () => {
    it.each(['environment', 'site'] as const)('does not write until both selections exist, choosing %s first', kind => {
        const s = store(); expect(s.select(kind, kind === 'environment' ? env.id : site.id)).toBe(false);
        expect(fs.existsSync(s.activePath)).toBe(false);
        expect(s.select(kind === 'environment' ? 'site' : 'environment', kind === 'environment' ? site.id : env.id)).toBe(true);
        expect(read('dw.json')).toMatchObject({ environmentId: 'env1', siteId: 'site1', version: 'v1', cartridgesPath: 'custom:base' });
    });
    it('switches one part while preserving the other and keeps IDs during rename/edit', () => {
        const s = store(); s.select('environment', env.id); s.select('site', site.id);
        s.upsert('site', { ...site, id: 'site2', name: 'Other', cartridgesPath: 'other:base' });
        s.select('site', 'site2'); expect(read('dw.json').environmentId).toBe('env1');
        s.upsert('environment', { ...env, name: 'Renamed', version: 'v2' });
        expect(read('dw.json')).toMatchObject({ environmentId: 'env1', siteId: 'site2', version: 'v2', cartridgesPath: 'other:base' });
    });
    it('reopens and reflects dw.json edits into the two matching records', () => {
        const s = store(); s.select('site', site.id); s.select('environment', env.id);
        const active = read('dw.json'); active.password = 'manual'; active.version = 'v2'; active.cartridgesPath = 'manual:base'; write('dw.json', active);
        const reopened = new ConfigStore(root); reopened.load();
        expect(reopened.environmentId).toBe('env1'); expect(reopened.siteId).toBe('site1');
        expect(read('dw-manager.json').environments[0].password).toBe('manual');
        expect(read('dw-manager.json').sites[0].cartridgesPath).toBe('manual:base');
    });
    it('keeps a manually configured dw.json unchanged until both parts are chosen', () => {
        write('dw.json', { hostname: 'manual.invalid', version: 'manual', cartridgesPath: 'manual', custom: true });
        const s = store(); const original = fs.readFileSync(s.activePath, 'utf8');
        s.select('environment', 'env1'); expect(fs.readFileSync(s.activePath, 'utf8')).toBe(original);
        s.select('site', 'site1'); expect(read('dw.json').custom).toBe(true);
    });
    it('deleting an active record removes its ID and does not resurrect it on open', () => {
        const s = store(); s.select('environment', env.id); s.select('site', site.id); s.remove('environment', env.id);
        const reopened = new ConfigStore(root); reopened.load();
        expect(reopened.config.environments).toHaveLength(0); expect(reopened.environmentId).toBeUndefined();
        expect(reopened.siteId).toBe('site1'); expect(read('dw.json').environmentId).toBeUndefined();
    });
    it('migrates legacy config once, preserves the original and stable IDs on reload', () => {
        const legacy = { sandboxes: [{ name: site.name, hostname: env.hostname, username: env.username, password: env.password, version: env.version, cartridgesPath: site.cartridgesPath }] };
        write('dw-envs.json', legacy); write('dw.json', legacy.sandboxes[0]);
        const s = new ConfigStore(root); s.load(); const ids = [s.environmentId, s.siteId];
        expect(read('dw-envs.json')).toEqual(legacy); s.load(); expect([s.environmentId, s.siteId]).toEqual(ids);
    });
    it('does not overwrite malformed JSON during startup', () => {
        fs.writeFileSync(path.join(root, 'dw-manager.json'), '{broken');
        expect(() => new ConfigStore(root).load()).toThrow();
        expect(fs.readFileSync(path.join(root, 'dw-manager.json'), 'utf8')).toBe('{broken');
    });
});
