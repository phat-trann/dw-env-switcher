import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// tryReadJson itself never touches vscode, but the module also exports
// readJsonOrWarn which does — mock it so the module can load under vitest.
vi.mock('vscode', () => ({
    window: { showErrorMessage: vi.fn() }
}));

import { tryReadJson } from '../../src/utils/jsonFile';

const tmpFiles: string[] = [];

function writeTempFile(content: string): string {
    const file = path.join(os.tmpdir(), `dw-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, content);
    tmpFiles.push(file);
    return file;
}

afterEach(() => {
    while (tmpFiles.length) {
        const file = tmpFiles.pop()!;
        try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
});

describe('tryReadJson', () => {
    it('parses valid JSON', () => {
        const file = writeTempFile(JSON.stringify({ sandboxes: [] }));
        const result = tryReadJson<{ sandboxes: unknown[] }>(file);
        expect(result.error).toBeUndefined();
        expect(result.data).toEqual({ sandboxes: [] });
    });

    it('returns an error instead of throwing when the file has invalid JSON', () => {
        const file = writeTempFile('{ this is not valid json');
        const result = tryReadJson(file);
        expect(result.data).toBeUndefined();
        expect(result.error).toBeInstanceOf(Error);
    });

    it('returns an error instead of throwing when the file does not exist', () => {
        const result = tryReadJson(path.join(os.tmpdir(), 'dw-manager-does-not-exist.json'));
        expect(result.data).toBeUndefined();
        expect(result.error).toBeInstanceOf(Error);
    });
});
