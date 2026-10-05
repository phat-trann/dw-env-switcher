import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
    workspace: {
        findFiles: vi.fn()
    }
}));

import * as vscode from 'vscode';
import { discoverCartridgeRoots, isDemandwareProjectXml, getCartridgeFolderNames } from '../../src/cartridges/discovery';

const DW_XML = '<?xml version="1.0"?><projectDescription><natures><nature>com.demandware.studio.core.beehiveNature</nature></natures></projectDescription>';
const NON_DW_XML = '<?xml version="1.0"?><projectDescription><natures><nature>org.eclipse.jdt.core.javanature</nature></natures></projectDescription>';

describe('isDemandwareProjectXml', () => {
    it('detects the demandware nature marker', () => {
        expect(isDemandwareProjectXml(DW_XML)).toBe(true);
    });

    it('rejects unrelated .project files', () => {
        expect(isDemandwareProjectXml(NON_DW_XML)).toBe(false);
    });
});

describe('getCartridgeFolderNames', () => {
    it('returns the basename of each directory', () => {
        expect(getCartridgeFolderNames(['/a/b/app_storefront_base', '/a/b/plugin_cartridge']))
            .toEqual(['app_storefront_base', 'plugin_cartridge']);
    });
});

describe('discoverCartridgeRoots', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-manager-discovery-'));

        // Case A: <project>/cartridge -> project folder itself is the root
        fs.mkdirSync(path.join(root, 'projectA', 'cartridge'), { recursive: true });
        fs.writeFileSync(path.join(root, 'projectA', '.project'), DW_XML);

        // Case B: <project>/cartridges/<name>_cartridge -> each qualifying child is a root
        fs.mkdirSync(path.join(root, 'projectB', 'cartridges', 'app_storefront_base_cartridge'), { recursive: true });
        fs.mkdirSync(path.join(root, 'projectB', 'cartridges', 'unrelated_dir'), { recursive: true });
        fs.writeFileSync(path.join(root, 'projectB', '.project'), DW_XML);

        // Case C: project folder itself ends with *_cartridge
        fs.mkdirSync(path.join(root, 'projectC_cartridge'), { recursive: true });
        fs.writeFileSync(path.join(root, 'projectC_cartridge', '.project'), DW_XML);

        // Case D: fallback -> plain DW project folder with none of the above structures
        fs.mkdirSync(path.join(root, 'projectD'), { recursive: true });
        fs.writeFileSync(path.join(root, 'projectD', '.project'), DW_XML);

        // Ignored: .project present but not a Demandware nature
        fs.mkdirSync(path.join(root, 'nonDwProject'), { recursive: true });
        fs.writeFileSync(path.join(root, 'nonDwProject', '.project'), NON_DW_XML);

        // Classic fallback: a bare "cartridge" folder with no .project anywhere in the tree
        fs.mkdirSync(path.join(root, 'projectE', 'cartridge'), { recursive: true });

        // Classic fallback: a folder ending in *_cartridge with no .project
        fs.mkdirSync(path.join(root, 'projectF_cartridge'), { recursive: true });
        fs.writeFileSync(path.join(root, 'projectF_cartridge', 'somefile.txt'), 'x');

        const findFiles = vscode.workspace.findFiles as unknown as ReturnType<typeof vi.fn>;
        findFiles.mockImplementation(async (pattern: string) => {
            if (pattern === '**/.project') {
                return [
                    path.join(root, 'projectA', '.project'),
                    path.join(root, 'projectB', '.project'),
                    path.join(root, 'projectC_cartridge', '.project'),
                    path.join(root, 'projectD', '.project'),
                    path.join(root, 'nonDwProject', '.project')
                ].map(fsPath => ({ fsPath }));
            }
            if (pattern === '**/cartridge/') {
                return [{ fsPath: path.join(root, 'projectE', 'cartridge') }];
            }
            if (pattern === '**/*_cartridge/**') {
                return [{ fsPath: path.join(root, 'projectF_cartridge', 'somefile.txt') }];
            }
            return [];
        });
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('discovers one root per rule, ignores non-Demandware projects, and merges classic fallbacks', async () => {
        const roots = await discoverCartridgeRoots(root);
        const basenames = roots.map(r => path.basename(r)).sort();

        expect(basenames).toEqual([
            'app_storefront_base_cartridge',
            'projectA',
            'projectC_cartridge',
            'projectD',
            'projectE',
            'projectF_cartridge'
        ]);

        // The non-qualifying sibling under projectB/cartridges must not show up as its own root.
        expect(basenames).not.toContain('unrelated_dir');
        // The non-Demandware .project must be ignored entirely.
        expect(basenames).not.toContain('nonDwProject');
    });
});
