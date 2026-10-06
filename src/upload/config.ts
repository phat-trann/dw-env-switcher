/** Shared by all Sites; captured when an upload session starts. */
export interface UploadSettings { concurrency?: number; watchDebounceMs?: number; ignore?: string[]; }
export const DEFAULT_UPLOAD_CONCURRENCY = 5;
export const DEFAULT_UPLOAD_IGNORE = ['node_modules/', '\\.zip$'];
export function compileUploadIgnore(ignore: string[] = DEFAULT_UPLOAD_IGNORE): RegExp[] {
    return ignore.map(pattern => new RegExp(pattern, 'i'));
}
/** Test ancestors too, so ignoring a directory also excludes its descendants/deletion. */
export function ignoredUploadPath(relative: string, patterns: RegExp[]): boolean {
    const parts = relative.replace(/\\/g, '/').split('/');
    return parts.some((_part, index) => patterns.some(pattern => pattern.test(parts.slice(0, index + 1).join('/')) || pattern.test(parts.slice(0, index + 1).join('/') + '/')));
}
export function resolveUploadSettings(settings: UploadSettings = {}): Required<UploadSettings> {
    validateUploadSettings(settings);
    return { concurrency: settings.concurrency ?? 5, watchDebounceMs: settings.watchDebounceMs ?? 300, ignore: [...(settings.ignore ?? DEFAULT_UPLOAD_IGNORE)] };
}
export function validateUploadSettings(value: unknown): asserts value is UploadSettings {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('upload must be an object.');
    const { watchDebounceMs, ignore } = value as UploadSettings;
    if (watchDebounceMs !== undefined && (!Number.isSafeInteger(watchDebounceMs) || watchDebounceMs < 0 || watchDebounceMs > 2147483647)) throw new Error('upload.watchDebounceMs must be an integer between 0 and 2147483647.');
    if (ignore !== undefined) {
        if (!Array.isArray(ignore) || ignore.some(pattern => typeof pattern !== 'string' || !pattern)) throw new Error('upload.ignore must be an array of nonempty regex strings.');
        try { compileUploadIgnore(ignore); } catch { throw new Error('upload.ignore contains an invalid regex.'); }
    }
    const concurrency = (value as UploadSettings).concurrency;
    if (concurrency !== undefined && (!Number.isSafeInteger(concurrency) || concurrency < 1)) {
        throw new Error('upload.concurrency must be a positive safe integer.');
    }
}
export function resolveUploadConcurrency(settings?: UploadSettings): number {
    if (settings !== undefined) validateUploadSettings(settings);
    return settings?.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY;
}
