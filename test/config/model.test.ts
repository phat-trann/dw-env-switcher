import { describe, it, expect } from 'vitest';
import { composeActive, emptyConfig, migrateLegacy, reflectActive, validateConfig } from '../../src/config/model';
import { ManagerConfig } from '../../src/types';

const fixture = (): ManagerConfig => ({ schemaVersion: 2,
    environments: [{ id: 'env1', name: 'Dev', hostname: 'dev.example.invalid', username: 'user', password: 'placeholder', version: 'v1' }],
    sites: [{ id: 'site1', name: 'Store', cartridgesPath: 'app_custom:app_base' }] });

describe('Environment + Site model', () => {
    it('requires both valid IDs before composing dw.json', () => {
        expect(composeActive(fixture(), 'env1')).toBeUndefined();
        expect(composeActive(fixture(), undefined, 'site1')).toBeUndefined();
        expect(composeActive(fixture(), 'env1', 'missing')).toBeUndefined();
    });
    it('composes real version/cartridgesPath fields and preserves tool options', () => {
        const active = composeActive(fixture(), 'env1', 'site1', { name: 'old', 'code-version': 'old', cartridges: ['old'], customSetting: true });
        expect(active).toEqual({ name: 'Store', environmentId: 'env1', siteId: 'site1', hostname: 'dev.example.invalid', username: 'user', password: 'placeholder', version: 'v1', cartridgesPath: 'app_custom:app_base', customSetting: true });
    });
    it('reflects by IDs even when names are duplicated; leaves unrelated records alone', () => {
        const config = fixture();
        config.environments.push({ ...config.environments[0], id: 'env2' });
        const active = { ...composeActive(config, 'env2', 'site1')!, version: 'v2', password: 'rotated', cartridgesPath: 'new:old' };
        expect(reflectActive(config, active)).toBe(true);
        expect(config.environments[0].version).toBe('v1');
        expect(config.environments[1].version).toBe('v2');
        expect(config.sites[0].cartridgesPath).toBe('new:old');
        expect(reflectActive(config, active)).toBe(false);
    });
    it('does not reflect incomplete IDs or incomplete active fields', () => {
        const config = fixture(); const original = JSON.stringify(config);
        expect(reflectActive(config, { ...composeActive(config, 'env1', 'site1')!, siteId: undefined })).toBe(false);
        expect(reflectActive(config, { environmentId: 'env1', siteId: 'site1', hostname: 'new' })).toBe(false);
        expect(JSON.stringify(config)).toBe(original);
    });
    it('restores missing entries using the exact IDs from dw.json', () => {
        const config = emptyConfig();
        expect(reflectActive(config, composeActive(fixture(), 'env1', 'site1')!)).toBe(true);
        expect(config.environments[0].id).toBe('env1'); expect(config.sites[0].id).toBe('site1');
        validateConfig(config);
    });
    it('rejects duplicate IDs across both sections and prevents reflection collisions', () => {
        const config = fixture(); config.sites[0].id = 'env1';
        expect(() => validateConfig(config)).toThrow(/unique/);
        const clean = fixture(); const original = JSON.stringify(clean);
        expect(reflectActive(clean, { ...composeActive(clean, 'env1', 'site1')!, environmentId: 'site1' })).toBe(false);
        expect(JSON.stringify(clean)).toBe(original);
    });
    it('migrates the supplied legacy field layout, deduplicates Environment values, preserves Site names/order and assigns active IDs', () => {
        const one = { name: 'Store A', hostname: 'dev.example.invalid', username: 'user', password: 'placeholder', version: 'v1', cartridgesPath: 'custom:base' };
        const legacy = { sandboxes: [one, { ...one, name: 'Store B', cartridgesPath: 'b:base' }] };
        let n = 0; const result = migrateLegacy(legacy, { ...one, version: 'manual' }, () => `id${++n}`);
        // Reflection from the active legacy file is applied after migration.
        expect(result.config.environments).toHaveLength(1); expect(result.config.sites).toHaveLength(2);
        expect(result.config.environments[0].version).toBe('manual');
        expect(result.active?.environmentId).toBe('id1'); expect(result.active?.siteId).toBe('id2');
        expect(result.config.sites[1].cartridgesPath).toBe('b:base');
        expect(legacy.sandboxes[0]).toEqual(one);
    });
    it('migrates the older code-version/cartridges-array schema as well', () => {
        const legacy = { sandboxes: [{ name: 'Old', hostname: 'host.invalid', 'code-version': 'v1', cartridges: ['custom', 'base'] }] };
        const result = migrateLegacy(legacy);
        expect(result.config.environments[0].version).toBe('v1'); expect(result.config.sites[0].cartridgesPath).toBe('custom:base');
    });
    it('fails malformed configurations rather than writing partial schema data', () => {
        expect(() => validateConfig({ schemaVersion: 2, environments: [{}], sites: [] })).toThrow();
        expect(() => migrateLegacy({ sandboxes: [{ name: 'Bad', hostname: 'host.invalid' }] })).toThrow();
    });
});
