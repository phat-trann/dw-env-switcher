import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function getCartridgeFolderNames(directories: string[]): string[] {
    return directories.map(dir => path.basename(dir));
}

export function isDemandwareProjectXml(xml: string): boolean {
    // lightweight detection, no XML parser dependency
    return xml.includes('com.demandware.studio.core.beehiveNature');
}

export function safeStatIsDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Returns cartridge root directories discovered by scanning for .project files.
 * Rules:
 *  - If <project>/cartridge/ exists → project folder is a cartridge root (e.g., app_storefront_base)
 *  - If <project>/cartridges/<cart>_cartridge[/cartridge]? exists → each child is a cartridge root
 *  - If project folder ends with *_cartridge → treat project folder as a cartridge root
 *  - Fallback: For DW projects that don't match the above, include project folder
 * Additionally, we merge with classic fallbacks:
 *  - any folder that directly contains a "cartridge" subfolder
 *  - any folder that ends with *_cartridge
 */
export async function discoverCartridgeRoots(workspaceRoot?: string): Promise<string[]> {
    const roots: string[] = [];
    const seen = new Set<string>();

    // Helper to add a path if not seen and (optionally) under a workspace
    const pushRoot = (p: string) => {
        const norm = path.resolve(p);
        if (workspaceRoot && !norm.startsWith(path.resolve(workspaceRoot))) return;
        const key = norm.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            roots.push(norm);
        }
    };

    // 1) .project-driven discovery
    const projectFiles = await vscode.workspace.findFiles('**/.project', '**/{node_modules,.git,.vscode}/**', 20000);
    for (const p of projectFiles) {
        let xml = '';
        try { xml = fs.readFileSync(p.fsPath, 'utf-8'); } catch { /* ignore */ }
        if (!xml || !isDemandwareProjectXml(xml)) continue;

        const projectDir = path.dirname(p.fsPath);

        // A) <project>/cartridge
        const singleCartridgeDir = path.join(projectDir, 'cartridge');
        if (safeStatIsDir(singleCartridgeDir)) {
            pushRoot(projectDir);
            continue;
        }

        // B) <project>/cartridges/<cart>_cartridge[/cartridge]
        const multiRoot = path.join(projectDir, 'cartridges');
        if (safeStatIsDir(multiRoot)) {
            const children = fs.readdirSync(multiRoot, { withFileTypes: true }).filter(d => d.isDirectory());
            for (const d of children) {
                const childPath = path.join(multiRoot, d.name);
                const hasInnerCartridge = safeStatIsDir(path.join(childPath, 'cartridge'));
                const looksLikeCartName = /_cartridge$/i.test(d.name);
                if (hasInnerCartridge || looksLikeCartName) {
                    pushRoot(childPath);
                }
            }
            continue;
        }

        // C) project folder itself ends with *_cartridge
        const base = path.basename(projectDir);
        if (/_cartridge$/i.test(base)) {
            pushRoot(projectDir);
            continue;
        }

        // D) Fallback: it's a DW project; treat the project folder as a root
        pushRoot(projectDir);
    }

    // 2) Classic fallbacks (merge)
    // Parents of "cartridge" folders
    const cartridgeDirs = await vscode.workspace.findFiles('**/cartridge/', '**/{node_modules,.git,.vscode}/**', 10000);
    for (const uri of cartridgeDirs) {
        const parent = path.resolve(path.join(uri.fsPath, '..'));
        pushRoot(parent);
    }

    // Folders ending with *_cartridge
    const starCartridgeMatches = await vscode.workspace.findFiles('**/*_cartridge/**', '**/{node_modules,.git,.vscode}/**', 10000);
    for (const uri of starCartridgeMatches) {
        const segments = uri.fsPath.split(path.sep);
        const idx = segments.findIndex(seg => /_cartridge$/i.test(seg));
        if (idx !== -1) {
            const rootPath = segments.slice(0, idx + 1).join(path.sep);
            pushRoot(rootPath);
        }
    }

    // Sort for stable UX
    roots.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    return roots;
}

/**
 * Used by pickers: returns absolute paths of discovered cartridge roots under the given workspace path.
 */
export async function getCartridgesFromDirectory(workspacePath: string): Promise<string[]> {
    return await discoverCartridgeRoots(workspacePath);
}
