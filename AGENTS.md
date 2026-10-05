# DW Manager project instructions

Read `AI_CONTEXT.md` for the implementation map and `README.md` for user-facing behavior before making changes.

## Versioning

For every completed project update, update `package.json.version` once for the coherent set of changes, using semantic versioning:

- PATCH: backward-compatible bug fixes, internal refactors, documentation, configuration, and build/tooling changes.
- MINOR: new features that preserve existing behavior, command IDs, and data compatibility.
- MAJOR: incompatible behavior, public command IDs/APIs, or persisted configuration formats.

Choose the bump based on the most significant change in the update. A build or verification run without a project change does not bump the version. If a change set already has its version bump, rebuilding or retrying checks does not bump it again.

Keep lockfile root version metadata aligned when a local lockfile exists. Keep README versioned installation examples aligned. Preserve unrelated user changes. Do not create a commit or Git tag merely to bump the version.

## Generated files and validation

Edit `src/`, never generated `out/` files. Keep `out/`, `dist/`, and VSIX artifacts excluded from Git; the extension runtime is regenerated from source.

`npm run build` invokes `npm run build:vsix`: VSCE runs TypeScript compile and esbuild bundle before creating `dist/dw-manager-<version>.vsix`. Building does not publish the extension.

Run relevant tests for logic changes. Build and inspect the VSIX for packaging changes. Keep README and AI_CONTEXT aligned with implemented behavior.
