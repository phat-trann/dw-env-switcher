# DW Manager

Manage Salesforce B2C Commerce Cloud sandbox configurations in Visual Studio Code. The extension writes `dw.json` for the selected sandbox, browses local cartridges, and tails remote logs over WebDAV.

**Maintainer:** Ferb

**Based on:** Ivaylo Trepetanov's DW Environment Switcher

**License:** MIT; see [LICENSE](LICENSE).

## Features

- Save named sandboxes in `dw-envs.json` and activate one by writing `dw.json`.
- Change a sandbox's hostname, credentials, code version, and cartridge selection.
- Browse discovered cartridges and open their files from an expandable tree.
- List sandbox `.log` files and stream their contents into Output Channels.
- Enable or disable Prophet Debugger upload for the workspace.
- Export and import workspace configuration and saved VS Code state as a ZIP.

## Requirements

- VS Code **1.80.0 or later**, as declared in the extension manifest.
- An open local workspace folder. Sandbox configuration uses the **first workspace folder** in a multi-root workspace.
- Sandbox credentials with access to `Sites/Logs/` for the Logs view.
- Prophet Debugger if you want Prophet upload/debugging integration. Sandbox management, cartridge browsing, and log viewing are separate features.

Node.js is needed to build from source; it does not need to be installed separately to use the packaged extension in VS Code.

## Install from VSIX

Build the extension as described below, then open the Extensions view, select **… → Install from VSIX…**, and choose the generated file. You can also use the VS Code CLI:

```sh
code --install-extension dist/dw-manager-1.0.1.vsix
```

The output filename follows the `name` and `version` in `package.json`.

## Manage sandboxes

1. Open the DW Manager icon in the Activity Bar.
2. In **Sandboxes**, click **Add New Sandbox**, or run that command from the Command Palette.
3. Enter or select a hostname, username, password, code version, and sandbox name. Optionally select cartridges.
4. The extension saves the entry in `dw-envs.json` and activates it in `dw.json`.
5. Click a sandbox to activate its saved configuration. The green check marks the active entry; other entries use a red inactive icon.
6. Use the item's **Sandbox Actions** menu to edit it, change cartridges/user/code version, toggle Prophet upload, or delete it.

`Select Sandbox` lets you choose a saved entry and optionally choose cartridges for the current `dw.json`. `Select Sandbox (Detailed)` opens the configuration flow; **Edit Sandbox** uses that same flow with the existing entry.

**Change Code Version** edits the currently active `dw.json` and updates a saved entry with matching hostname and username. **Change Saved Password** updates saved entries and the active config with the selected username. Removing a saved sandbox does not delete the active `dw.json`.

Changing a saved sandbox's cartridges or user also writes that sandbox into `dw.json`, making it the active configuration.

### Configuration format

`dw-envs.json` contains a `sandboxes` array:

```json
{
  "sandboxes": [
    {
      "name": "Development",
      "hostname": "example.sandbox.example.com",
      "code-version": "version1",
      "username": "developer@example.com",
      "password": "replace-with-your-password",
      "cartridges": ["app_storefront_base", "app_custom"]
    }
  ]
}
```

`dw.json` contains the selected sandbox object itself. The code uses **`code-version`** and a **`cartridges` array**; it does not use `version` or `cartridgesPath`.

Credentials are stored in these JSON files and, for some commands, in VS Code `globalState`. The current implementation does **not** use VS Code `SecretStorage` or encrypt exported ZIP files. Passwords entered through a masked input are still written to the configuration files. Keep files and exported archives containing real credentials private.

## Browse cartridges

The **Cartridges** view scans workspace `.project` files with the Demandware nature `com.demandware.studio.core.beehiveNature`. It recognizes projects containing `cartridge/`, children under `cartridges/` that contain `cartridge/` or end in `_cartridge`, and project directories ending in `_cartridge`. It also merges fallback matches for cartridge folder layouts.

Expand cartridge roots to browse directories and files; click a file to open it. **Open Cartridge** opens that cartridge as the workspace in the current window. **Reveal Cartridge in Explorer** reveals its root. Refresh is available in the title bar; filesystem watchers also refresh on matching cartridge and `.project` changes.

The tree discovers across the workspace. Sandbox cartridge selection filters discoveries to the first workspace folder and saves folder names, rather than absolute paths.

## Tail sandbox logs

The **Logs** view uses credentials from the active `dw.json` to request:

```text
https://<hostname>/on/demandware.servlet/webdav/Sites/Logs/
```

Click a file to start a dedicated `SFCC Log: <filename>` Output Channel. The first request retrieves the whole log; subsequent requests poll every **4 seconds** and request bytes after the last known offset. **Stop Tailing** stops and disposes the session; clicking an already running file reveals its existing channel.

The list refreshes when requested by sandbox actions or the refresh button. A refresh does not retarget sessions that are already tailing: stop the old session before starting the same filename on another sandbox.

## Prophet upload

**DW Manager: Enable Upload (Prophet)** and **DW Manager: Disable Upload (Prophet)** set `extension.prophet.upload.enabled` at workspace scope. They control Prophet's setting; this extension does not implement a cartridge uploader.

## Export and import

**Export Sandbox Setup** requires both `dw.json` and `dw-envs.json`. Choose an output folder; it creates `sandbox_config.zip` containing those files and `globalState.json` with the exported credential/history keys.

**Import Sandbox Setup** extracts the ZIP beside the chosen archive, copies available configuration files into the first workspace folder, restores keys from `globalState.json`, and refreshes the Sandboxes and Logs views. Existing destination configurations are overwritten. Exported archives contain credentials in plaintext.

## Commands

These titles match `package.json`:

| Area | Command Palette titles |
| --- | --- |
| Sandbox selection | Select Sandbox; Select Sandbox (Detailed); Add New Sandbox |
| Sandbox editing | Edit Sandbox; Change Cartridges; Change Code Version; Change User |
| Saved entries | Delete Saved Sandbox; Delete Sandbox From View; Delete Saved Username; Change Saved Password |
| Backup | Export Sandbox Setup; Import Sandbox Setup |
| Prophet | DW Manager: Enable Upload (Prophet); DW Manager: Disable Upload (Prophet) |
| Views | Refresh Sandbox View; Refresh Cartridges; Refresh Logs |
| Cartridges | Open Cartridge; Reveal Cartridge in Explorer |
| Logs | Tail Log; Stop Tailing |

Commands that act on a sandbox, cartridge, or log item should be used from that item's tree menu because they require the selected item argument.

## Extension identity

The package name is `dw-manager`, the extension ID is `Ferb.dw-manager`, and its display name is **DW Manager**. Commands use `dw-manager.*` (plus the sandbox refresh command `dwManagerView.refresh`); tree views use the `dwManager` identifiers defined in `package.json`.

Workspace configuration still uses `dw.json` and `dw-envs.json`. VS Code keeps `globalState` separately for each extension ID, so histories from an installation with the previous name can be transferred using Export/Import Sandbox Setup. Custom keybindings should use the renamed command IDs.

## Source and generated runtime

Edit TypeScript in `src/`. The `out/` directory is generated:

- `npm run compile` compiles the source modules into JavaScript under `out/`.
- `npm run bundle` builds `src/extension.ts` and its dependencies into `out/extension.js`.
- VS Code loads `out/extension.js` through the `main` field in `package.json`; the F5 development host also runs generated JavaScript from `out/`.
- VSIX packaging includes the bundled `out/extension.js`. Source `.ts` files are not required at runtime.

Do not edit `out/` by hand; builds overwrite it. `out/` can be regenerated from source. If it is removed, compile before F5 or run `npm run build:vsix` to regenerate the packaged runtime. Generated `out/` files are excluded from Git by `.gitignore`; build them locally before running the extension.

## Develop and build

Use the Node version in `.nvmrc`. The packaging tool requires **Node.js 22 or later**.

```sh
nvm use
npm install
npm run compile
npm test
```

Press **F5** to launch the configured Extension Development Host. `npm run watch` recompiles TypeScript during development.

To build an installable VSIX after installing dependencies:

```sh
npm run build
```

`npm run build:vsix` is the direct equivalent. A build automatically compiles and bundles the source before packaging; separate compile/bundle commands are not required.

The script uses the local `@vscode/vsce` dependency and writes `dist/dw-manager-<version>.vsix`. VSCE invokes `vscode:prepublish`, which type-checks with TypeScript and bundles the extension with esbuild. Runtime dependencies are bundled; `.vscodeignore` includes only the manifest, runtime bundle, README, license, and icons. Local `dw.json`, `dw-envs.json`, source files, tests, and previous VSIX files are excluded.

This command packages locally and does not publish to the Marketplace or require a publisher access token. See the [official VS Code packaging documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

For the implementation map, persistence rules, and current limitations, read [AI_CONTEXT.md](AI_CONTEXT.md).

## Versioning

Every project update bumps the version once according to its impact: PATCH for compatible fixes, internal changes, documentation, or tooling; MINOR for compatible new features; MAJOR for breaking behavior, command IDs, or data formats. Rebuilding an unchanged project does not change its version. See [AGENTS.md](AGENTS.md) for the project instructions.
