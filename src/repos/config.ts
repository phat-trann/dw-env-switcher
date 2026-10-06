import * as fs from 'fs';
import * as path from 'path';
import { Site } from '../types';

export interface RepoTools {
    rootDir?: string;
    nodeVersion?: string;
    priorityBranches?: string[];
    gitJobs?: number;
    repoJobs?: number;
    reinstallDays?: number;
    skipRepos?: Record<string, { skipInstall?: boolean; skipCompile?: boolean }>;
}
export const DEFAULT_REPO_TOOLS: Required<RepoTools> = {
    rootDir: '.', nodeVersion: '8.17.0', priorityBranches: ['staging-new', 'v3.3.0', 'release/v3.3.0', 'master'],
    gitJobs: 8, repoJobs: 4, reinstallDays: 30,
    skipRepos: Object.fromEntries(['lib_productlist', 'link_afterpay', 'plugin_facebooktracking', 'plugin_passwordlesslogin',
        'plugin_ordermonitoring', 'plugin_pinteresttracking', 'plugin_pushnotifications'].map(name => [name, { skipInstall: true, skipCompile: true }]))
};
export function validateRepoTools(value: unknown): asserts value is RepoTools {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('repoTools must be an object.');
    const settings = value as RepoTools;
    if (settings.rootDir !== undefined && (typeof settings.rootDir !== 'string' || !settings.rootDir.trim())) throw new Error('Invalid rootDir.');
    if (settings.nodeVersion !== undefined && (typeof settings.nodeVersion !== 'string' || !/^v?\d+(?:\.\d+){0,2}$/.test(settings.nodeVersion))) throw new Error('Use a numeric Node version.');
    for (const key of ['gitJobs', 'repoJobs', 'reinstallDays'] as const) {
        if (settings[key] !== undefined && (!Number.isSafeInteger(settings[key]) || settings[key]! < 1)) throw new Error(`Invalid ${key}.`);
    }
    if (settings.priorityBranches !== undefined && (!Array.isArray(settings.priorityBranches) || !settings.priorityBranches.length || settings.priorityBranches.some(branch => typeof branch !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(branch) || branch.startsWith('-')))) throw new Error('Invalid priorityBranches.');
    if (settings.skipRepos !== undefined) {
        if (!settings.skipRepos || typeof settings.skipRepos !== 'object' || Array.isArray(settings.skipRepos)) throw new Error('Invalid skipRepos.');
        for (const policy of Object.values(settings.skipRepos)) {
            if (!policy || typeof policy !== 'object' || Array.isArray(policy) || ['skipInstall', 'skipCompile'].some(key => (policy as any)[key] !== undefined && typeof (policy as any)[key] !== 'boolean')) throw new Error('Invalid skip policy.');
        }
    }
}
export function resolveRepoTools(workspace: string, common: RepoTools = {}, overrides: RepoTools = {}): Required<RepoTools> {
    validateRepoTools(common); validateRepoTools(overrides);
    const settings = { ...DEFAULT_REPO_TOOLS, ...common, ...overrides };
    return { ...settings, rootDir: fs.realpathSync(path.resolve(workspace, settings.rootDir)) };
}
export function discoverSiteRepos(root: string, site: Site): string[] {
    const cartridges = site.cartridgesPath.split(':').filter(Boolean);
    if (cartridges.some(name => !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..')) throw new Error('Invalid cartridgesPath.');
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
        .filter(entry => fs.existsSync(path.join(root, entry.name, '.git')) && cartridges.some(name => {
            try { return fs.statSync(path.join(root, entry.name, 'cartridges', name)).isDirectory(); } catch { return false; }
        })).map(entry => entry.name).sort();
}
