export interface SandboxConfig {
    name: string;
    hostname: string;
    "code-version": string;
    username?: string;
    password?: string;
    cartridges?: string[];
}

export interface EnvsFile {
    sandboxes: SandboxConfig[];
}
