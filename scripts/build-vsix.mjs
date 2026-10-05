import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const outputDir = path.join(root, 'dist');
const outputPath = path.join(outputDir, `${manifest.name}-${manifest.version}.vsix`);

let vsceManifestPath;
try {
    vsceManifestPath = require.resolve('@vscode/vsce/package.json');
} catch {
    console.error('Packaging dependencies are missing. Run npm install first.');
    process.exit(1);
}
const vsceManifest = JSON.parse(readFileSync(vsceManifestPath, 'utf8'));
const vsceBin = path.resolve(path.dirname(vsceManifestPath), vsceManifest.bin.vsce);
mkdirSync(outputDir, { recursive: true });

// VSCE runs vscode:prepublish to type-check and bundle before packaging.
// Runtime dependencies are bundled; vscode is supplied by the extension host.
const result = spawnSync(process.execPath, [
    vsceBin, 'package', '--no-dependencies', '--out', outputPath
], { cwd: root, stdio: 'inherit' });
if (result.error) {
    console.error(`VSIX build failed: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
