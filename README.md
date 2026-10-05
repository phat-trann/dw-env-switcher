# DW Manager

Manage Salesforce B2C Commerce Cloud **Environments** and **Sites** independently in VS Code. Select one of each to generate `dw.json`, browse local cartridges, and tail remote logs.

**Maintainer:** Ferb

**Based on:** Ivaylo Trepetanov's DW Environment Switcher

**License:** MIT; see [LICENSE](LICENSE).

## Environment + Site workflow

DW Manager has four Activity Bar views: **Environments**, **Sites**, **Cartridges**, and **Logs**. Configuration uses the first workspace folder in a multi-root workspace.

1. In **Environments**, click **Create Environment** and enter a name, hostname, username, password, and version. Its UUID is generated once when saved.
2. In **Sites**, click **Create Site** and enter a name and colon-separated `cartridgesPath`. Its UUID is also generated once when saved.
3. Click an Environment and a Site, in either order. The selected entries get a green check.
4. Only after both entries are selected does the extension write `dw.json`.
5. Change either selection to combine it with the other currently selected entry. You can reuse the same Environment across several Sites, or the same Site across several Environments.

Creating an entry only saves it; click it or use **Select Environment** / **Select Site** to select it. Editing or renaming keeps its original ID. Editing a selected entry updates `dw.json`; editing another entry only updates the saved config. Delete and edit actions are available on the relevant tree item. Site items also offer **Change Site Cartridges**.

`cartridgesPath` order is preserved. Enter/edit it directly to control execution order. The cartridge picker keeps the order of existing selections and appends newly discovered cartridges.

Deleting a selected entry removes its ID from `dw.json`, keeps the existing connection/path data, and requires a valid replacement selection before rewriting the combined configuration.

## Configuration: dw-manager.json

Workspace configuration is now **`dw-manager.json`**, containing two independent sections:

```json
{
  "schemaVersion": 2,
  "environments": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Development",
      "hostname": "example.sandbox.example.com",
      "username": "developer@example.com",
      "password": "replace-with-your-password",
      "version": "version1"
    }
  ],
  "sites": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Store AU",
      "cartridgesPath": "app_custom_au:app_custom_core:app_storefront_base"
    }
  ]
}
```

IDs must be unique across both sections. Display names may repeat; selection and editing use IDs, never names. The extension uses **`version`** and **`cartridgesPath`**, matching the workspace tooling's format.

Selecting these two entries produces:

```json
{
  "name": "Store AU",
  "environmentId": "11111111-1111-4111-8111-111111111111",
  "siteId": "22222222-2222-4222-8222-222222222222",
  "hostname": "example.sandbox.example.com",
  "username": "developer@example.com",
  "password": "replace-with-your-password",
  "version": "version1",
  "cartridgesPath": "app_custom_au:app_custom_core:app_storefront_base"
}
```

The active `name` is the Site name. Unrelated `dw.json` options are preserved when switching. Obsolete `code-version` and `cartridges` fields are removed when generating the new format.

### Reopening VS Code and editing files

On activation, DW Manager reads `dw.json`. When it contains **both** IDs and all five configuration fields, it reflects hostname/username/password/version into the matching Environment and `cartridgesPath` into the matching Site. The tree restores both selected indicators. If an ID is absent from the saved config, the entry is restored using that exact ID and a generated display name.

`dw.json` is authoritative when opening the workspace or when files are edited externally. For example, editing its `version` and reopening VS Code updates the Environment referenced by `environmentId`. Missing/incomplete ID pairs do not reflect values into records by name. A valid remaining ID can still be shown as selected.

Watchers reload external edits to `dw.json` and `dw-manager.json`. If JSON is malformed, the extension reports an error instead of replacing it with an empty configuration. Renaming an entry in `dw-manager.json` keeps its identity; manually changing its IDs creates a different identity.

### Migration from dw-envs.json

If `dw-manager.json` does not exist but `dw-envs.json` does, the extension creates the new file automatically:

- Each legacy sandbox becomes a Site with its own UUID and existing name/path.
- Identical hostname/username/password/version tuples share one Environment. Different versions or credentials remain separate.
- Both legacy `version` / `cartridgesPath` and older extension `code-version` / `cartridges` formats are accepted.
- If the legacy active `dw.json` matches exactly one entry by name and hostname, its selected pair is migrated and written with both IDs. Otherwise choose the two entries manually.
- The old `dw-envs.json` is retained and is no longer the active config source after migration. Future reloads use `dw-manager.json`, preserving its UUIDs.

Credentials are plaintext in local configuration and exported ZIPs. This implementation does not use `SecretStorage`; keep credential-containing files private.

## Cartridges, logs, and Prophet

**Cartridges** discovers Demandware `.project` layouts and cartridge folder fallbacks across the workspace. Expand roots and click files to open them. **Open Cartridge** opens the cartridge as the current workspace; **Reveal Cartridge in Explorer** reveals its root. Filesystem watchers refresh common cartridge layouts. Site pickers discover under the first workspace folder and store cartridge names, not absolute paths.

**Logs** uses the active `dw.json` hostname and credentials to access `https://<hostname>/on/demandware.servlet/webdav/Sites/Logs/`. Click a `.log` file to tail it in an Output Channel. The first request fetches the whole file; subsequent requests poll every **4 seconds**, using byte ranges. **Stop Tailing** disposes the session. Changing active credentials stops old sessions; choose the log again for the new Environment. Updating only the Site does not retarget log sessions.

**DW Manager: Enable Upload (Prophet)** and **Disable Upload (Prophet)** set `extension.prophet.upload.enabled` at workspace scope. This extension does not implement a cartridge uploader or change the remote instance's active code version.

VS Code **1.80.0+** is declared in the manifest. Sandbox credentials with WebDAV access are needed for logs; Prophet Debugger is needed for Prophet features. End users do not need a separately installed Node.js runtime.

## Export and import

**Export DW Manager Setup** creates `dw-manager-setup.zip` containing `dw-manager.json` and, if present, `dw.json`. It waits for archive completion before reporting success.

**Import DW Manager Setup** reads configuration entries directly from the ZIP, validates the schema and IDs, and overwrites the workspace configurations. It does not extract arbitrary archive paths. Legacy archives containing `dw-envs.json` are also converted. The two views and active selection reload after importing. Exported archives contain plaintext credentials.

## Commands

| Area | Commands |
| --- | --- |
| Environments | Create Environment; Select Environment; Edit Environment; Delete Environment |
| Sites | Create Site; Select Site; Edit Site; Delete Site; Change Site Cartridges |
| Configuration | Refresh Configuration; Export DW Manager Setup; Import DW Manager Setup |
| Cartridges | Refresh Cartridges; Open Cartridge; Reveal Cartridge in Explorer |
| Logs | Refresh Logs; Tail Log; Stop Tailing |
| Prophet | DW Manager: Enable Upload (Prophet); DW Manager: Disable Upload (Prophet) |

Item-specific actions are available from tree menus. The package ID is **`Ferb.dw-manager`**. Commands use `dw-manager.*`. Version 2 removes the old combined Sandbox commands and changes its persisted configuration schema.

## Source, build, and install

Use the Node version in `.nvmrc`; local VSCE requires Node **22+**.

```sh
nvm use
npm install
npm test
npm run build
```

Dependencies only need reinstalling when needed. Subsequent builds require just **`npm run build`**; `npm run build:vsix` is equivalent. It automatically compiles TypeScript, bundles dependencies with esbuild, and writes `dist/dw-manager-<version>.vsix`.

Edit `src/`; `out/` is generated and ignored by Git. VS Code loads `out/extension.js` via `package.json.main`. `npm run compile` produces development JavaScript under `out/`; `npm run watch` recompiles it; **F5** starts the configured Extension Development Host. Packaging bundles dependencies into `out/extension.js` and includes only the runtime, manifest, README, license, and icons.

Install via **Extensions → … → Install from VSIX…**, or:

```sh
code --install-extension dist/dw-manager-2.0.0.vsix
```

A build packages locally and does not publish. See the [VS Code packaging documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Versioning and implementation guide

Follow [AGENTS.md](AGENTS.md): bump PATCH for compatible fixes/docs/tooling, MINOR for compatible new features, and MAJOR for breaking behavior/IDs/data formats. Rebuilding unchanged source does not bump its version.

Read [AI_CONTEXT.md](AI_CONTEXT.md) for the implementation map, synchronization rules, migration details, and remaining limitations.
