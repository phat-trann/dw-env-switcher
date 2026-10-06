import { createHash } from 'crypto';
import { ActiveConfig, ManagerConfig } from '../types';
export interface ActivityTarget { siteId: string; environmentId: string; siteName: string; environmentName: string; hostname: string; }
export function connectionFingerprint(active: ActiveConfig): string {
    return createHash('sha256').update(JSON.stringify([active.hostname, active.username, active.password, active.version])).digest('hex');
}
export function uploadFingerprint(active: ActiveConfig): string {
    return createHash('sha256').update(JSON.stringify([connectionFingerprint(active), active.environmentId, active.siteId, active.cartridgesPath])).digest('hex');
}
export function activityTarget(config: ManagerConfig, active?: ActiveConfig): ActivityTarget | undefined {
    const site = config.sites.find(entry => entry.id === active?.siteId);
    const env = config.environments.find(entry => entry.id === active?.environmentId);
    if (!active?.hostname || !active.username || !active.password || !site || !env) return;
    return { siteId: site.id, environmentId: env.id, siteName: site.name, environmentName: env.name, hostname: active.hostname };
}
