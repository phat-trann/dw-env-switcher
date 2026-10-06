import { DEFAULT_UPLOAD_CONCURRENCY, resolveUploadConcurrency } from './config';
import { UploadCanceled } from './client';

interface Job { key: string; action: () => Promise<void>; resolve(): void; reject(error: unknown): void; }
/** Files can run together; overlapping paths retain enqueue order, including subtree deletes. */
export class UploadQueue {
    private pending: Job[] = [];
    private active = new Set<Job>();
    private stopped = false;
    private idleWaiters: (() => void)[] = [];
    constructor(private limit = DEFAULT_UPLOAD_CONCURRENCY) { resolveUploadConcurrency({ concurrency: limit }); }
    private overlaps(a: string, b: string): boolean { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
    run(key: string, action: () => Promise<void>): Promise<void> {
        if (this.stopped) return Promise.reject(new UploadCanceled());
        return new Promise((resolve, reject) => { this.pending.push({ key, action, resolve, reject }); this.pump(); });
    }
    private pump(): void {
        while (!this.stopped && this.active.size < this.limit) {
            const index = this.pending.findIndex((job, index) =>
                ![...this.active].some(active => this.overlaps(job.key, active.key)) &&
                !this.pending.slice(0, index).some(earlier => this.overlaps(job.key, earlier.key)));
            if (index < 0) break;
            const [job] = this.pending.splice(index, 1); this.active.add(job);
            void Promise.resolve().then(job.action).then(job.resolve, job.reject).finally(() => {
                this.active.delete(job); this.pump(); this.notifyIdle();
            });
        }
        this.notifyIdle();
    }
    private notifyIdle(): void {
        if (!this.pending.length && !this.active.size) { this.idleWaiters.splice(0).forEach(resolve => resolve()); }
    }
    idle(): Promise<void> {
        return this.pending.length || this.active.size ? new Promise(resolve => this.idleWaiters.push(resolve)) : Promise.resolve();
    }
    dispose(): void { this.stopped = true; this.pending.splice(0).forEach(job => job.reject(new UploadCanceled())); this.notifyIdle(); }
}
