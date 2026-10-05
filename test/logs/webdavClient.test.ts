import { describe, it, expect } from 'vitest';
import { parseLogFileNames } from '../../src/logs/webdavClient';

describe('parseLogFileNames', () => {
    it('extracts .log file names from an Apache-style directory listing', () => {
        const html = `
            <html><body>
            <a href="error-blade-01-20260710.log">error-blade-01-20260710.log</a>
            <a href="warn-blade-01-20260710.log">warn-blade-01-20260710.log</a>
            <a href="../">Parent Directory</a>
            </body></html>
        `;

        expect(parseLogFileNames(html)).toEqual([
            'warn-blade-01-20260710.log',
            'error-blade-01-20260710.log'
        ]);
    });

    it('ignores non-.log links such as parent directory or subfolders', () => {
        const html = `
            <a href="../">Parent Directory</a>
            <a href="subfolder/">subfolder/</a>
            <a href="debug-20260710.log">debug-20260710.log</a>
        `;

        expect(parseLogFileNames(html)).toEqual(['debug-20260710.log']);
    });

    it('deduplicates repeated links', () => {
        const html = `
            <a href="info-20260710.log">info-20260710.log</a>
            <a href="info-20260710.log">info-20260710.log</a>
        `;

        expect(parseLogFileNames(html)).toEqual(['info-20260710.log']);
    });

    it('decodes URL-encoded file names', () => {
        const html = `<a href="custom%20error-20260710.log">custom error-20260710.log</a>`;

        expect(parseLogFileNames(html)).toEqual(['custom error-20260710.log']);
    });

    it('returns an empty array when there are no log links', () => {
        expect(parseLogFileNames('<a href="../">Parent Directory</a>')).toEqual([]);
    });
});
