import { describe, it, expect } from 'vitest';
import {
    findSandboxByName,
    upsertSandbox,
    removeSandboxByName,
    updatePasswordForUsername,
    updateActiveConfigPasswordIfMatch,
    findMatchingSandboxForActiveConfig
} from '../../src/sandboxes/logic';
import { EnvsFile } from '../../src/types';

function makeEnvs(): EnvsFile {
    return {
        sandboxes: [
            { name: 'dev01', hostname: 'dev01.example.com', username: 'alice', password: 'old-pw', 'code-version': 'v1' },
            { name: 'staging', hostname: 'staging.example.com', username: 'bob', password: 'bob-pw', 'code-version': 'v2' }
        ]
    };
}

describe('findSandboxByName', () => {
    it('finds an existing sandbox by name', () => {
        expect(findSandboxByName(makeEnvs(), 'dev01')?.hostname).toBe('dev01.example.com');
    });

    it('returns undefined when not found', () => {
        expect(findSandboxByName(makeEnvs(), 'missing')).toBeUndefined();
    });
});

describe('upsertSandbox', () => {
    it('adds a new sandbox', () => {
        const envs = makeEnvs();
        upsertSandbox(envs, { name: 'new', hostname: 'new.example.com', 'code-version': 'v1' });
        expect(envs.sandboxes.map(s => s.name)).toEqual(['dev01', 'staging', 'new']);
    });

    it('replaces an existing sandbox with the same name instead of duplicating it', () => {
        const envs = makeEnvs();
        upsertSandbox(envs, { name: 'dev01', hostname: 'dev01-new.example.com', 'code-version': 'v3' });
        expect(envs.sandboxes).toHaveLength(2);
        expect(findSandboxByName(envs, 'dev01')?.hostname).toBe('dev01-new.example.com');
    });
});

describe('removeSandboxByName', () => {
    it('removes only the matching sandbox', () => {
        const envs = makeEnvs();
        removeSandboxByName(envs, 'dev01');
        expect(envs.sandboxes.map(s => s.name)).toEqual(['staging']);
    });

    it('is a no-op when the name does not exist', () => {
        const envs = makeEnvs();
        removeSandboxByName(envs, 'missing');
        expect(envs.sandboxes).toHaveLength(2);
    });
});

describe('updatePasswordForUsername', () => {
    it('updates the password on every sandbox owned by that username and reports a change', () => {
        const envs = makeEnvs();
        const changed = updatePasswordForUsername(envs, 'alice', 'new-pw');
        expect(changed).toBe(true);
        expect(findSandboxByName(envs, 'dev01')?.password).toBe('new-pw');
        expect(findSandboxByName(envs, 'staging')?.password).toBe('bob-pw');
    });

    it('reports no change when the username has no saved sandboxes', () => {
        const envs = makeEnvs();
        const changed = updatePasswordForUsername(envs, 'nobody', 'new-pw');
        expect(changed).toBe(false);
        expect(findSandboxByName(envs, 'dev01')?.password).toBe('old-pw');
    });
});

describe('updateActiveConfigPasswordIfMatch', () => {
    it('updates the password when the username matches', () => {
        const config = { name: 'dev01', hostname: 'dev01.example.com', username: 'alice', password: 'old-pw', 'code-version': 'v1' };
        const changed = updateActiveConfigPasswordIfMatch(config, 'alice', 'new-pw');
        expect(changed).toBe(true);
        expect(config.password).toBe('new-pw');
    });

    it('leaves the config untouched when the username does not match', () => {
        const config = { name: 'dev01', hostname: 'dev01.example.com', username: 'alice', password: 'old-pw', 'code-version': 'v1' };
        const changed = updateActiveConfigPasswordIfMatch(config, 'bob', 'new-pw');
        expect(changed).toBe(false);
        expect(config.password).toBe('old-pw');
    });
});

describe('findMatchingSandboxForActiveConfig', () => {
    it('matches on both hostname and username', () => {
        const envs = makeEnvs();
        expect(findMatchingSandboxForActiveConfig(envs, 'dev01.example.com', 'alice')?.name).toBe('dev01');
    });

    it('does not match when the username differs for the same hostname', () => {
        const envs = makeEnvs();
        expect(findMatchingSandboxForActiveConfig(envs, 'dev01.example.com', 'eve')).toBeUndefined();
    });
});
