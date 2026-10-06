import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn(), create: vi.fn() }));
vi.mock('vscode', () => ({ window: { createOutputChannel: mock.create } }));
import { UploadOutput } from '../../src/upload/output';
beforeEach(() => { vi.clearAllMocks(); mock.create.mockReturnValue({ appendLine: mock.appendLine, show: mock.show, dispose: mock.dispose }); });
describe('Uploader Output channel', () => {
    it('creates one reusable named channel and keeps editor focus', () => {
        const output = new UploadOutput(); output.write('Watching files'); output.show(); output.write('[U] app/cartridge/test.js');
        expect(mock.create).toHaveBeenCalledOnce(); expect(mock.create).toHaveBeenCalledWith('DW Manager Uploader');
        expect(mock.show).toHaveBeenCalledWith(true); output.dispose(); expect(mock.dispose).toHaveBeenCalledOnce();
    });
    it('redacts credentials and authorization even in unexpected error text', () => {
        const output = new UploadOutput(); output.setTarget({ username: 'example-user', password: 'example-secret' });
        output.error(`example-user example-secret ${Buffer.from('example-user:example-secret').toString('base64')}\nInjected line`);
        const line = mock.appendLine.mock.calls[0][0];
        expect(line).not.toContain('example-user'); expect(line).not.toContain('example-secret');
        expect(line).not.toContain(Buffer.from('example-user:example-secret').toString('base64'));
        expect(line).not.toContain('\n'); expect(line).toContain('[ERROR]'); output.dispose();
    });
    it('does not create output just for activation/disposal', () => {
        const output = new UploadOutput(); output.dispose(); expect(mock.create).not.toHaveBeenCalled();
    });
});
