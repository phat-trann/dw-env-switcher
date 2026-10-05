# DW Manager implementation context for AI assistants

This document describes the implemented behavior of DW Manager. Read it before changing the extension, then verify the relevant source files. `package.json` defines the public UI contract; this document is an implementation map, not a replacement for code or tests.

## Purpose and boundaries

This is a TypeScript desktop VS Code extension for Salesforce B2C Commerce Cloud. It manages local sandbox configuration, discovers local cartridges, toggles Prophet's workspace upload setting, and tails sandbox logs over HTTPS WebDAV. It does not upload cartridges itself, create remote code versions, or switch the remote instance's active code version. Changing `code-version` changes local JSON configuration.

- Entrypoint: `src/extension.ts`, compiled/bundled to `out/extension.js`.
- Package identity: `dw-manager`, display name `DW Manager`, extension ID `Ferb.dw-manager`. The previous package name was renamed; VS Code globalState is scoped to extension identity, so use export/import when transferring its histories. Workspace JSON filenames and globalState key names stay compatible.
- Manifest: `package.json`; contains command titles/IDs, activation events, tree menus, three views, publisher/version, and scripts.
- Activity Bar container: `dwManager`.
- Views: `dwManagerView` (Sandboxes), `dwManagerCartridgesView` (Cartridges), `dwManagerLogsView` (Logs).
- Sandbox config and export/import use `workspaceFolders[0]`; this is not a per-folder multi-root implementation.
- Node `fs`/`path` and HTTPS are used directly. The extension is not implemented for browser/web extension hosts or generic virtual filesystems.

## Source map

| File | Responsibility |
| --- | --- |
| `src/extension.ts` | Registers providers/commands and log-session disposal; re-exports selected helpers for compatibility. |
| `src/types.ts` | `SandboxConfig` and `EnvsFile`; persistence schema. |
| `src/sandboxes/selection.ts` | Simple and detailed selection; user prompts and file/global-state writes. |
| `src/sandboxes/actions.ts` | Activation, editing, deletion, credentials/cartridges/code-version changes. |
| `src/sandboxes/logic.ts` | Pure data transformations separated from UI and filesystem operations. |
| `src/sandboxes/tree.ts` | Sandbox tree and active indicator. |
| `src/cartridges/discovery.ts` | Workspace cartridge detection and basename conversion. |
| `src/cartridges/tree.ts` | Cartridge file tree and filesystem watchers. |
| `src/logs/webdavClient.ts` | Basic-auth HTTPS requests, log listing parser, byte-range fetches. |
| `src/logs/tailSession.ts` | Polling timer, byte offsets, Output Channel lifecycle. |
| `src/logs/tree.ts` | Reads active credentials, creates/reveals/stops sessions, exposes log items. |
| `src/io/exportImport.ts` | ZIP creation/extraction using archiver and unzipper. |
| `src/prophet.ts` | Workspace setting `extension.prophet.upload.enabled`. |
| `src/utils/jsonFile.ts` | Read/parse result, VS Code error display, synchronous JSON writes. |
| `src/utils/pick.ts` | QuickPick history plus “Enter New” input flow. |
| `scripts/build-vsix.mjs` | Resolves local VSCE and writes a versioned VSIX to `dist/`. |

## Persistence contract

`SandboxConfig` contains required `name`, `hostname`, and `code-version`, plus optional `username`, `password`, and `cartridges: string[]`. `EnvsFile` wraps a `sandboxes` array. Do not silently rename `code-version` to `version` or replace `cartridges` with the colon-separated `cartridgesPath` schema used by other tooling.

- `<first-workspace>/dw-envs.json`: named saved sandboxes.
- `<first-workspace>/dw.json`: active sandbox object, not an array or wrapper.
- `context.globalState`: global history/credential keys. Relevant keys are `dw-username`, `dw-password`, `dw-hostnames`, `dw-usernames`, `dw-codeversions`, and `dw-password-<username>`.
- Detailed selection remembers hostname and code-version history, but does not add its selected username to `dw-usernames`. `changeUser` does add usernames.
- Simple selection reads fallback credentials from `dw-username`/`dw-password`. Password rotation writes `dw-password-<username>` but does not update that fallback `dw-password` key.
- Credentials are plaintext in local JSON and exported archives. `globalState` is used; `context.secrets`/SecretStorage is not implemented. Masked input boxes do not change storage semantics.
- Reads use `readJsonOrWarn` where implemented; writes use synchronous `writeJson` with four-space formatting. Read types are assertions, not runtime schema validation. Writes are not atomic.

Never copy real sandbox credentials into documentation, test fixtures, console output, or VSIX packages. Use synthetic examples.

## Command and data flows

### Activation and sandbox tree

`activate(context)` creates all three providers and registers commands. Tree root items come from `dw-envs.json`. The active check is **name equality** with `dw.json.name`; it is not a hostname/username comparison. Expanding an item displays hostname, username, code version, and cartridge names; passwords are not rendered.

Clicking a sandbox invokes internal `dw-manager.activateSandbox`: writes the saved object directly to `dw.json`, then refreshes sandbox and log views. It does not prompt for missing credentials. The command is registered in code but is not a contributed Command Palette entry.

### Selection

`simpleSandboxSelection`:

1. Requires the first workspace folder. If `dw-envs.json` is absent, delegates to detailed selection.
2. Picks a saved sandbox by name.
3. Uses sandbox credentials, then global fallback credentials; prompts if either is absent and saves the fallback pair.
4. Optionally picks discovered cartridge basenames.
5. Writes `dw.json` and refreshes Logs. Changes to cartridge selection here are not persisted back to `dw-envs.json`; it also does not explicitly refresh Sandboxes.

`detailedSandboxSelection`:

1. Creates `dw-envs.json` with an empty array if absent.
2. Optionally finds an existing entry by the name argument.
3. Prompts for hostname, user, password, code version, sandbox name, and optional cartridges.
4. `upsertSandbox` removes existing entries with the same name, then appends the new object.
5. Writes both files, activating the new/edited sandbox, and refreshes Sandboxes and Logs.

Cancellation checks are not consistent for all inputs. In particular, username/password/cartridge picker cancellation can produce omitted values. Selecting “No” for cartridges in the detailed flow uses an empty array, including when editing an existing sandbox.

### Actions

- Delete saved sandbox: removes matching name only from `dw-envs.json`; active `dw.json` stays present.
- Change cartridges/user: finds the clicked saved entry by name, changes it, writes both files, and thus activates that entry. Cartridge changes refresh Sandboxes but not Logs; user changes refresh both.
- Change Code Version: operates on **active `dw.json`**, even if invoked from another sandbox's item menu. Updates the first saved entry with matching hostname and username. It updates code-version history and does not explicitly refresh either tree afterward.
- Change Saved Password: selects from `dw-usernames`, updates `dw-password-<username>`, every saved entry using that username, and active config when the username matches. Refreshes Logs.
- Delete Saved Username: removes the username history entry and per-user password key. It does not remove JSON credentials or the global fallback pair.
- Edit Sandbox: invokes the detailed flow with the clicked name.
- Prophet toggles: ignore the clicked sandbox argument and set the upload flag for the current workspace.

Pure helpers in `sandboxes/logic.ts` mutate their supplied objects. Name matching is used for upsert/deletion; hostname plus username matching is used for code-version updates. Preserve these distinctions unless intentionally changing behavior.

## Cartridge discovery and tree

`discoverCartridgeRoots(workspaceRoot?)` scans VS Code's workspace with `findFiles`. Excludes `node_modules`, `.git`, and `.vscode` during discovery; caps `.project` searches at 20,000 results and fallback searches at 10,000.

For `.project` files containing the Demandware nature:

1. If the project contains `cartridge/`, add the project directory.
2. Otherwise, if it contains `cartridges/`, add each child that contains `cartridge/` or ends with `_cartridge`, then continue to the next project.
3. Otherwise add a project ending with `_cartridge`, or use the Demandware project directory as fallback.

Merge fallback matches for parents of `cartridge/` directories and ancestors ending in `_cartridge`. Deduplicate using lowercased absolute paths and sort roots by basename. Optional root filtering currently uses a string `startsWith` check, not a path-boundary/realpath check.

The tree scans the whole workspace; sandbox pickers call discovery with the first folder path and save basenames. Duplicate basenames from different roots are not disambiguated. VS Code `findFiles` is file-oriented; the `**/cartridge/` directory fallback should be verified before relying on it independently of `.project` detection.

Tree children use synchronous filesystem reads, directories first then alphabetical ordering. Files execute `vscode.open`. **Open Cartridge** executes `vscode.openFolder` with `forceNewWindow: false`; it opens a workspace, not an additional workspace folder. **Reveal Cartridge** executes `revealInExplorer`.

Watchers cover `**/cartridge/**`, `**/*_cartridge/**`, and `**/.project`; their events refresh the provider. They do not cover every arbitrary folder layout or watch `dw.json`/`dw-envs.json`.

## Logs and lifecycle

`LogsTreeDataProvider` reads active credentials from `dw.json`; missing hostname/user/password yields no items. It requests the HTML directory listing at `https://<host>/on/demandware.servlet/webdav/Sites/Logs/` using Basic auth over HTTPS.

`parseLogFileNames` extracts double-quoted `href` values ending in `.log`, URL-decodes, deduplicates, and sorts descending. It is a small anchor parser, not a general WebDAV PROPFIND/XML client. It does not normalize absolute/nested hrefs to basenames. Requests have no explicit timeout.

Sessions are stored in a `Map` keyed **only by filename**, not sandbox hostname. Clicking an existing filename reveals its channel. Refreshing the tree does not stop/retarget old sessions. Explicit stop disposes the timer/channel and deletes the map entry. Extension disposal calls `disposeAll`.

`LogTailSession`:

- Dedicated channel `SFCC Log: <filename>`; first poll loads the full file.
- Polls every 4,000 ms with `setInterval`; polls are not serialized.
- Uses UTF-8 byte lengths for offsets.
- `206`: append new content and increment offset.
- `200`: handle full response; show full content on first fetch or a detected shorter/rotated file, otherwise append bytes after the old offset.
- `416`: assume no new content and leave the offset alone. Truncation returning 416 is not recovered by this branch.
- Error: append a message and stop polling. The tree map entry remains; the initial `start()` also schedules a timer after its first awaited poll, even if that poll stopped on error. This is an existing lifecycle limitation, not desired retry behavior.

If fixing tail behavior, add coverage for offsets, truncation, error cleanup, overlapping polls, and sandbox switches; existing tests mainly cover log-name parsing.

## Export/import

Export requires both workspace JSON files. Prompts for a folder and creates `sandbox_config.zip` with `dw.json`, `dw-envs.json`, and `globalState.json`. The exported state includes only `dw-username`, `dw-password`, `dw-hostnames`, `dw-usernames`, and `dw-codeversions`; per-user password keys are not exported separately. `archive.finalize()` is not awaited, and completion/error handling is minimal.

Import extracts beside the selected ZIP, then copies available JSON files into the first workspace folder, restores every key supplied by `globalState.json`, and refreshes Sandboxes and Logs. Copies overwrite destination files. There is no application-level whitelist of archive entries, schema validation, cleanup of extracted files, or complete stream error handling.

## Build, tests, and packaging

```sh
nvm use
npm install
npm run compile
npm test
npm run build:vsix
```

Use `.nvmrc` for development. Local VSCE 4 requires Node >=22. TypeScript is strict, targets ES2019, and compiles CommonJS from `src/` to `out/`. The F5 launch configuration reads `out/**/*.js` and opens an Extension Development Host. VS Code executes `out/extension.js` via `package.json.main`; it does not execute TypeScript from `src/` directly. Generated `out/` files must not be hand-edited. Generated `out/` files are excluded from Git and regenerated by compile/bundle; do not add build artifacts to the source repository.

- `compile`: TypeScript compile/type check.
- `watch`: TypeScript watch mode.
- `bundle`: esbuild bundles `src/extension.ts` into `out/extension.js` for Node. `vscode` is external because the host supplies it. `@aws-sdk/client-s3` is external because unzipper references it in its unused optional S3 helper; ZIP import uses local streams, not S3.
- `vscode:prepublish`: compile then bundle; invoked by VSCE for packaging.
- `build`: alias for `build:vsix`; compiles, bundles, and packages in one command.
- `build:vsix`: local VSCE `package --no-dependencies`; output derives from current package name/version in `dist/`. Dependencies used at runtime (`archiver`, `unzipper`) are bundled.
- `.vscodeignore`: allowlist of manifest, runtime bundle, README, LICENSE, and two icons. Credentials/config fixtures, source, tests, AI context, development scripts, node_modules, and older VSIX artifacts must stay out of the package.

Tests use Vitest with Node and local VS Code mocks, not a real extension host. Existing coverage: sandbox pure transforms, cartridge discovery, JSON read/write helpers, picker flows, and log-list HTML parsing. F5/manual testing is still needed for real UI, credentials, remote WebDAV access, and Prophet integration.

Before finishing a runtime or packaging change, run relevant tests and compile. For packaging changes also build the VSIX, inspect its archive contents, and verify its bundle loads without project node_modules. Keep README aligned with actual command titles and behavior. Update this document when persistence rules, command effects, or lifecycle behavior change.

## Version policy

Follow `AGENTS.md`: bump `package.json.version` once per completed project update. Use PATCH for compatible fixes/internal/docs/tooling changes, MINOR for compatible new features, and MAJOR for breaking behavior/command IDs/data formats. Synchronize local lockfile root metadata and versioned README examples. Repeated builds/checks of the same update do not require additional bumps.
