import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ActiveConfig, Environment, ManagerConfig, Site } from '../types';
import { composeActive, emptyConfig, migrateLegacy, reflectActive, validateConfig } from './model';

export const CONFIG_FILE = 'dw-manager.json';

/** No vscode dependency: filesystem/selection behavior can be tested in isolation. */
export class ConfigStore {
    config: ManagerConfig = emptyConfig();
    environmentId?: string;
    siteId?: string;
    readonly configPath: string;
    readonly activePath: string;

    constructor(readonly root: string) {
        this.configPath = path.join(root, CONFIG_FILE);
        this.activePath = path.join(root, 'dw.json');
    }

    private read(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    private write(file: string, data: unknown) {
        // Same-directory rename prevents watchers from seeing a partial JSON document.
        const temp = `${file}.${randomUUID()}.tmp`;
        try { fs.writeFileSync(temp, JSON.stringify(data, null, 4) + '\n'); fs.renameSync(temp, file); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }

    readActive(): ActiveConfig | undefined {
        if (!fs.existsSync(this.activePath)) return undefined;
        const value = this.read(this.activePath);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dw.json object.');
        return value as ActiveConfig;
    }

    load(): void {
        const active = this.readActive();
        if (fs.existsSync(this.configPath)) {
            const value = this.read(this.configPath); validateConfig(value); this.config = value;
        } else {
            const legacyPath = path.join(this.root, 'dw-envs.json');
            if (fs.existsSync(legacyPath)) {
                const migrated = migrateLegacy(this.read(legacyPath), active);
                this.config = migrated.config;
                this.save(); // Keep the original legacy file intact.
                if (migrated.active) this.write(this.activePath, migrated.active);
            } else {
                this.config = emptyConfig();
            }
        }
        this.reflect();
    }

    reflect(): void {
        const active = this.readActive();
        this.environmentId = undefined; this.siteId = undefined;
        if (!active) return;
        if (reflectActive(this.config, active)) this.save();
        if (this.config.environments.some(entry => entry.id === active.environmentId)) this.environmentId = active.environmentId;
        if (this.config.sites.some(entry => entry.id === active.siteId)) this.siteId = active.siteId;
    }

    save(): void { validateConfig(this.config); this.write(this.configPath, this.config); }

    select(kind: 'environment' | 'site', id: string): boolean {
        const entries = kind === 'environment' ? this.config.environments : this.config.sites;
        if (!entries.some(entry => entry.id === id)) throw new Error('Selected entry no longer exists.');
        if (kind === 'environment') this.environmentId = id; else this.siteId = id;
        return this.apply();
    }

    apply(): boolean {
        const composed = composeActive(this.config, this.environmentId, this.siteId, this.readActive());
        if (!composed) return false;
        this.write(this.activePath, composed); return true;
    }

    upsert(kind: 'environment', entry: Environment): void;
    upsert(kind: 'site', entry: Site): void;
    upsert(kind: 'environment' | 'site', entry: Environment | Site): void {
        if (kind === 'environment') {
            this.config.environments = [...this.config.environments.filter(value => value.id !== entry.id), entry as Environment];
        } else {
            this.config.sites = [...this.config.sites.filter(value => value.id !== entry.id), entry as Site];
        }
        this.save();
        if ((kind === 'environment' ? this.environmentId : this.siteId) === entry.id) this.apply();
    }

    remove(kind: 'environment' | 'site', id: string): void {
        if (kind === 'environment') this.config.environments = this.config.environments.filter(entry => entry.id !== id);
        else this.config.sites = this.config.sites.filter(entry => entry.id !== id);
        if (kind === 'environment' && this.environmentId === id) this.environmentId = undefined;
        if (kind === 'site' && this.siteId === id) this.siteId = undefined;
        // Prevent reopening from recreating an intentionally deleted active entry.
        const active = this.readActive();
        const key = kind === 'environment' ? 'environmentId' : 'siteId';
        if (active?.[key] === id) { delete active[key]; this.write(this.activePath, active); }
        this.save();
    }
}
