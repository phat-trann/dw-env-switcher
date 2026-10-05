import { EnvsFile, SandboxConfig } from '../types';

/**
 * Pure data-transformation helpers pulled out of the command handlers so they
 * can be unit tested without mocking fs/vscode.
 */

export function findSandboxByName(envs: EnvsFile, name: string): SandboxConfig | undefined {
    return envs.sandboxes.find(sb => sb.name === name);
}

export function upsertSandbox(envs: EnvsFile, sandbox: SandboxConfig): EnvsFile {
    envs.sandboxes = envs.sandboxes.filter(sb => sb.name !== sandbox.name);
    envs.sandboxes.push(sandbox);
    return envs;
}

export function removeSandboxByName(envs: EnvsFile, name: string): EnvsFile {
    envs.sandboxes = envs.sandboxes.filter(sb => sb.name !== name);
    return envs;
}

/** Updates the password of every saved sandbox for a given username. Returns whether anything changed. */
export function updatePasswordForUsername(envs: EnvsFile, username: string, newPassword: string): boolean {
    let changed = false;
    for (const sandbox of envs.sandboxes) {
        if (sandbox.username === username) {
            sandbox.password = newPassword;
            changed = true;
        }
    }
    return changed;
}

/** Updates the active dw.json config's password in place if its username matches. Returns whether it changed. */
export function updateActiveConfigPasswordIfMatch(config: SandboxConfig, username: string, newPassword: string): boolean {
    if (config.username === username) {
        config.password = newPassword;
        return true;
    }
    return false;
}

/** Finds the saved sandbox that corresponds to the currently active dw.json config. */
export function findMatchingSandboxForActiveConfig(envs: EnvsFile, hostname: string, username?: string): SandboxConfig | undefined {
    return envs.sandboxes.find(sb => sb.hostname === hostname && sb.username === username);
}
