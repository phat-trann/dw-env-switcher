import { describe, it, expect, vi } from 'vitest';
import { UploadQueue } from '../../src/upload/queue';
import { UploadCanceled } from '../../src/upload/client';

describe('Concurrent upload path ordering', () => {
    it('serializes a subtree delete behind existing files and later files behind that delete', async () => {
        const queue = new UploadQueue(5), order: string[] = [];
        let finishFirst!: () => void, finishDelete!: () => void;
        const first = queue.run('app/cartridge/x/a.js', async () => { order.push('first'); await new Promise<void>(resolve => finishFirst = resolve); });
        const deletion = queue.run('app/cartridge/x', async () => { order.push('delete'); await new Promise<void>(resolve => finishDelete = resolve); });
        const later = queue.run('app/cartridge/x/b.js', async () => { order.push('later'); });
        const other = queue.run('other/cartridge/a.js', async () => { order.push('other'); });
        await other; expect(order).toEqual(['first', 'other']);
        finishFirst(); await first; await vi.waitFor(() => expect(order).toContain('delete')); expect(order).not.toContain('later');
        finishDelete(); await Promise.all([deletion, later]); expect(order).toEqual(['first', 'other', 'delete', 'later']);
        await queue.idle(); queue.dispose();
    });
    it('preserves order for two writes to the same file', async () => {
        const queue = new UploadQueue(), order: number[] = []; let finish!: () => void;
        const first = queue.run('app/a.js', async () => { order.push(1); await new Promise<void>(resolve => finish = resolve); });
        const second = queue.run('app/a.js', async () => { order.push(2); });
        await Promise.resolve(); expect(order).toEqual([1]); finish(); await Promise.all([first, second]); expect(order).toEqual([1, 2]); queue.dispose();
    });
    it('rejects queued work on Stop without starting its action', async () => {
        const queue = new UploadQueue(1); let finish!: () => void; const action = vi.fn();
        const first = queue.run('app/a.js', async () => { await new Promise<void>(resolve => finish = resolve); });
        const second = queue.run('app/b.js', action); const rejected = expect(second).rejects.toBeInstanceOf(UploadCanceled);
        await Promise.resolve(); queue.dispose(); await rejected; expect(action).not.toHaveBeenCalled();
        finish(); await first; await queue.idle();
    });
});
