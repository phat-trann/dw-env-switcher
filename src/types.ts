import type { UploadSettings } from './upload/config';
import type { RepoTools } from './repos/config';

export interface Environment {
    id: string;
    name: string;
    hostname: string;
    username: string;
    password: string;
    version: string;
}

export interface Site {
    id: string;
    name: string;
    cartridgesPath: string;
    repoTools?: RepoTools;
}

export interface ManagerConfig {
    schemaVersion: 2;
    upload?: UploadSettings;
    repoTools?: RepoTools;
    environments: Environment[];
    sites: Site[];
}

export interface ActiveConfig {
    environmentId?: string;
    siteId?: string;
    hostname?: string;
    username?: string;
    password?: string;
    version?: string;
    cartridgesPath?: string;
    [key: string]: unknown;
}
