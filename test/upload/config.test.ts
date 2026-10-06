import { describe, expect, it } from 'vitest';
import { resolveUploadConcurrency, resolveUploadSettings } from '../../src/upload/config';
import { validateConfig, composeActive } from '../../src/config/model';
describe('shared upload config', () => {
    it('defaults omitted settings and accepts custom limits', () => {
        expect(resolveUploadConcurrency()).toBe(5);
        expect(resolveUploadConcurrency({})).toBe(5);
        expect(resolveUploadConcurrency({concurrency:8})).toBe(8);
    });
    it.each([0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'5',null])('rejects invalid concurrency %s', value => {
        expect(() => validateConfig({schemaVersion:2,environments:[],sites:[],upload:{concurrency:value}})).toThrow('positive safe integer');
    });
    it.each([null,[],5])('rejects malformed upload settings %s', upload => {
        expect(() => validateConfig({schemaVersion:2,environments:[],sites:[],upload})).toThrow('upload must be an object');
    });
    it('defaults timing/ignore and rejects malformed regex/timers', () => {
        expect(resolveUploadSettings().watchDebounceMs).toBe(300);
        expect(resolveUploadSettings({watchDebounceMs:200,ignore:[]}).ignore).toEqual([]);
        for (const settings of [{watchDebounceMs:-1},{watchDebounceMs:1.5},{watchDebounceMs:2147483648},{ignore:['[']},{ignore:[3]}]) {
            expect(()=>resolveUploadSettings(settings as any)).toThrow();
        }
    });
    it('accepts compatible config without copying upload into dw.json', () => {
        const config = {schemaVersion:2 as const,upload:{concurrency:8},environments:[{id:'e',name:'Dev',hostname:'dev.invalid',username:'user',password:'placeholder',version:'v1'}],sites:[{id:'s',name:'Store',cartridgesPath:'app'}]};
        validateConfig(config);expect(composeActive(config,'e','s')).not.toHaveProperty('upload');
    });
});
