# DW Manager

Manage Salesforce B2C Commerce Cloud **Environments** and **Sites** independently in VS Code. Select one of each to generate `dw.json`, watch/upload selected cartridges, debug with Prophet, browse remote Impex files, and tail remote logs.

**Maintainer:** Ferb

**Based on:** Ivaylo Trepetanov's DW Environment Switcher

**License:** MIT; see [LICENSE](LICENSE).

## Environment + Site workflow

DW Manager has five Activity Bar views: **Environments**, **Sites**, **Activities**, **Logs**, and **Impex**. Configuration uses the first workspace folder in a multi-root workspace.

1. In **Environments**, click **Create Environment** and enter a name, hostname, username, password, and version. Its UUID is generated once when saved.
2. In **Sites**, click **Create Site** and enter a name and colon-separated `cartridgesPath`. Its UUID is also generated once when saved.
3. Click an Environment and a Site, in either order. The selected entries get a green check.
4. Only after both entries are selected does the extension write `dw.json`.
5. Change either selection to combine it with the other currently selected entry. You can reuse the same Environment across several Sites, or the same Site across several Environments.

Selecting only one entry before a complete pair exists is held in memory; reopening the workspace loses that pending selection.

Creating an entry only saves it; click it or use **Select Environment** / **Select Site** to select it. Editing or renaming keeps its original ID. Editing a selected entry updates `dw.json`; editing another entry only updates the saved config. Delete and edit actions are available on the relevant tree item. Site items also offer **Change Site Cartridges**.

`cartridgesPath` order is preserved. Enter/edit it directly to control execution order. The cartridge picker keeps the order of existing selections and appends newly discovered cartridges.

Deleting a selected entry removes its ID from `dw.json`, keeps the existing connection/path data, and requires a valid replacement selection before rewriting the combined configuration.

## Configuration: dw-manager.json

Workspace configuration is now **`dw-manager.json`**, containing two independent sections:

```json
{
  "schemaVersion": 2,
  "upload": {
    "concurrency": 5,
    "watchDebounceMs": 300,
    "ignore": ["node_modules/", "\\.zip$"]
  },
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
  ],
  "repoTools": {
    "rootDir": ".",
    "nodeVersion": "8.17.0",
    "priorityBranches": [
      "staging-new",
      "v3.3.0",
      "release/v3.3.0",
      "master"
    ],
    "gitJobs": 8,
    "repoJobs": 4,
    "reinstallDays": 30,
    "skipRepos": {
      "lib_productlist": {
        "skipInstall": true,
        "skipCompile": true
      },
      "link_afterpay": {
        "skipInstall": true,
        "skipCompile": true
      },
      "plugin_facebooktracking": {
        "skipInstall": true,
        "skipCompile": true
      },
      "plugin_passwordlesslogin": {
        "skipInstall": true,
        "skipCompile": true
      },
      "plugin_ordermonitoring": {
        "skipInstall": true,
        "skipCompile": true
      },
      "plugin_pinteresttracking": {
        "skipInstall": true,
        "skipCompile": true
      },
      "plugin_pushnotifications": {
        "skipInstall": true,
        "skipCompile": true
      }
    }
  }
}
```

`upload.concurrency` is a shared upload setting for every Site in this workspace, limiting file operations for watch and concurrent cartridge ZIP deployments for Upload All. Use a positive safe integer; omitting `upload` or `concurrency` defaults to **5**. Edit the top-level field in `dw-manager.json`, then **Disable Upload → Enable Upload** to apply it to a new session. `upload.watchDebounceMs` controls watch debounce in milliseconds (default 300, configurable to 200; integer 0–2147483647). `upload.ignore` is a case-insensitive regex string array, default `["node_modules/", "\\.zip$"]`; JSON requires the doubled backslash. Patterns match cartridge-relative paths using `/`, including ancestor directories, for watch/create/delete and Upload All. A supplied array replaces defaults; `[]` disables these ignore patterns. Hidden paths, symlinks, and files outside `.project` / `cartridge/**` remain excluded for regular cartridges. SFRA `modules` supports root-level files and folders, with root connection configs still excluded. These settings have no per-Site override, are preserved by config import/export, and are not copied to `dw.json`.

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

To change active connection or cartridge values, edit the selected entry through the extension UI or update `dw.json`. Changing those values only in `dw-manager.json` while `dw.json` still contains the previous values causes them to be restored from `dw.json` on reload.

Watchers reload external edits to `dw.json` and `dw-manager.json`. If JSON is malformed, the extension reports an error instead of replacing it with an empty configuration. Renaming an entry in `dw-manager.json` keeps its identity; manually changing its IDs creates a different identity.

### Migration from dw-envs.json

If `dw-manager.json` does not exist but `dw-envs.json` does, the extension creates the new file automatically:

- Each legacy sandbox becomes a Site with its own UUID and existing name/path.
- Identical hostname/username/password/version tuples share one Environment. Different versions or credentials remain separate.
- Both legacy `version` / `cartridgesPath` and older extension `code-version` / `cartridges` formats are accepted.
- If the legacy active `dw.json` matches exactly one entry by name and hostname, its selected pair is migrated and written with both IDs. Otherwise choose the two entries manually.
- The old `dw-envs.json` is retained and is no longer the active config source after migration. Future reloads use `dw-manager.json`, preserving its UUIDs.

Credentials are plaintext in local configuration and exported ZIPs. This implementation does not use `SecretStorage`; keep credential-containing files private.

## Impex, logs, upload, and Prophet debugging

**Impex** browses `https://<hostname>/on/demandware.servlet/webdav/Sites/Impex/` using the active `dw.json` credentials. Expand folders to list their contents and click a file to open it. XML, JSON, TXT, LOG, CSV, and properties files open as editor snapshots; edits do not upload to the server. Other files, including ZIPs, prompt for a download destination. **Refresh Impex** reloads the tree. Changing active configuration refreshes the tree and discards stale responses/items. WebDAV access to Impex is required.

The Cartridges sidebar view has been removed. **Change Site Cartridges** still discovers local cartridges under the first workspace folder and stores their names in order. **Open Cartridge** and **Reveal Cartridge in Explorer** remain available from the command palette and prompt for a local cartridge; **Refresh Cartridges** rescans and reports the count.

**Logs** uses the active `dw.json` hostname and credentials to access `https://<hostname>/on/demandware.servlet/webdav/Sites/Logs/`. Click a `.log` file to tail it in an Output Channel. The first request fetches the whole file; subsequent requests poll every **4 seconds**, using byte ranges. **Stop Tailing** disposes the session. Changing active credentials stops old sessions; choose the log again for the new Environment. Updating only the Site does not retarget log sessions.

**Start Debugging** is available in the Sites header, each Site's **Site Actions** menu, and the command palette. From an item, it selects that Site and retains the selected Environment. Missing selections are prompted; cancellation stops debugging. After a complete pair updates `dw.json`, it launches Prophet (`type: prophet`, `request: launch`). Prophet Debugger (`SqrTT.prophet`) must be installed.

### Upload modes

DW Manager manages its own WebDAV uploader, independently of Prophet debugging. Its missing-cartridge handling, Output workflow and default five-file concurrency follow the public [Prophet uploader source](https://github.com/SqrTT/prophet/blob/8d9a9a434cf101305d26b0e3ce4c89054f57b351/src/providers/Uploader.ts), available under the [MIT license](https://github.com/SqrTT/prophet/blob/8d9a9a434cf101305d26b0e3ce4c89054f57b351/LICENSE.txt). The implementation remains local to DW Manager; Upload All also uses cartridge ZIP upload and server-side UNZIP, following [Prophet WebDAV](https://github.com/SqrTT/prophet/blob/8d9a9a434cf101305d26b0e3ce4c89054f57b351/src/server/WebDav.ts). DW Manager uses its own implementation and preserves remote cartridges/files without Prophet’s pre-extraction cartridge deletion. It matches Prophet’s three retries with 4/6/8-second delays for transient failures, applied per ZIP step. It is not an identical copy: DW Manager stages ZIPs on disk, uses certificate verification, retries selected transient failures, and reconnects for owned ZIP cleanup; Prophet streams ZIP creation, disables certificate verification and retries whole cartridges for most errors except 401. In each Site's **Site Actions** menu or the command palette:

| Command | Initial behavior | Changes afterward |
| --- | --- | --- |
| **DW Manager: Enable Upload (Watch Changes Only)** | Sends no initial upload or remote cleanup request. | Watches the Site cartridges plus SFRA `modules`. |
| **DW Manager: Enable Upload and Upload All** | Deploys one ZIP per available Site cartridge plus SFRA `modules`. | Watches the same cartridges. |
| **DW Manager: Enable Upload for Selected Cartridges** | Lets you choose one or more Site cartridges; sends no initial upload. | Watches only your selection. |
| **DW Manager: Enable Upload and Upload Selected Cartridges** | Lets you choose one or more Site cartridges, then deploys their cartridge ZIPs. | Watches only your selection. |
| **DW Manager: Disable Upload** | Stops watching, clears queued changes and aborts active requests. | Upload stays Off until explicitly enabled. |

DW Manager expands each nonempty Site upload path with **`modules`**, exactly once, matching Prophet’s SFRA scope. It does not write that addition into the Site config or `dw.json`. The selected-cartridge picker includes `modules`; an explicit selection or saved resume scope remains exactly that subset. Missing local `modules` warns/skips like any other cartridge. A valid SFRA `modules/.project` with Demandware nature is recognized even without `cartridge/`; its root files (`server.js`, `synchronous-promise.js`, `server/**`, etc.) are included in ZIP and watch. Ignore rules, physical workspace boundaries, duplicate-root deduplication and symlink exclusions apply. Root `dw.json`, `dw.js`, `dw-manager.json`, and `dw-envs.json` remain excluded.

Enable selects the clicked Site and retains or prompts for an Environment. One uploader is supported per workspace. Enabling another Site stops the previous uploader. Scope selection does not modify the Site's `cartridgesPath` or debug cartridge mapping. **Start / Re-run Activity** resumes the remembered pair/scope in watch-only mode, including after a previous Upload All.

Canceling the cartridge picker leaves upload **Off**. Canceling an Upload All notification stops both that batch and its watcher; already-uploaded files remain on the server. Missing local cartridges produce a warning and are skipped; available cartridges continue. If every requested cartridge is missing, upload remains **Off** and sends no requests. Add missing cartridges locally and restart upload to include them. Duplicate local cartridge names keep the first valid discovered root and skip later roots with a warning, matching Prophet. Output lists skipped roots and the retained root; only the retained root is watched and uploaded. Repeated references to the same physical root do not warn. Invalid paths, HTTP errors or a watcher failure leave upload **Failed**, with a message and a manual Start option. Safe status/error summaries appear in Output; no raw response bodies, stack traces or persistent log files are written.

Upload All archives eligible local `.project` and `cartridge/**` files (or root-level SFRA `modules` payload) in the chosen scope, streams each ZIP to the selected code version, calls server-side UNZIP, then removes its unique temporary remote ZIP. Archive entries include the cartridge name, so extraction lands in the correct cartridge. It overwrites matching remote files. It preserves extra remote cartridges and remote-only files; it never cleans the code version or changes the active code version. Watchers synchronize file create/change/delete events, so a local deletion inside the selected scope deletes that remote file/folder. Hidden paths and symlinks are excluded; `upload.ignore` excludes `node_modules/` and ZIPs by default (root `.project` is included unless ignored); root connection configs such as `dw.json` are not uploaded. Git/install/build changes can also trigger watched uploads.

Available local cartridges must resolve under the first workspace folder; duplicate names retain the first valid discovered root, including the Company `repo/cartridges/<name>/cartridge` layout. The configured code version must already exist. It is checked via WebDAV on the first transfer, so watch-only enable does not verify connectivity until a change occurs. File changes are coalesced per file for `upload.watchDebounceMs` (default 300ms), then up to **`upload.concurrency` independent file operations** (default **5**) run in parallel for watching, matching the [Prophet watcher’s concurrency](https://github.com/SqrTT/prophet/blob/8d9a9a434cf101305d26b0e3ce4c89054f57b351/src/server/uploadServer.ts). Writes to the same path and overlapping parent/child paths retain their queue order; parent directory setup is shared. HTTPS connections use keep-alive with at most `upload.concurrency` sockets. Upload All runs up to `upload.concurrency` cartridge ZIP deployments in parallel (default 5), replacing thousands of individual PUT/MKCOL requests with ZIP PUT → UNZIP POST → ZIP DELETE per cartridge. ZIPs use fast compression and private local temporary files, stream to HTTPS without buffering whole archives, and are removed locally on success/error/cancellation. Watch requests time out after 60 seconds; ZIP transfer/extraction use a 5-minute inactivity timeout. ZIP PUT/UNZIP/DELETE retries transient connection errors and HTTP 429/500/502/503/504 up to three times with 4/6/8-second backoff, reopening the disk ZIP stream for each PUT. Stop cancels retry waits immediately. Permission errors (401/403), certificate failures and local ZIP read errors do not retry. After Stop/failure, a separate connection bound to the original target attempts to delete only the owned `dw-manager-<cartridge>-<UUID>.zip` (10-second inactivity timeout). Output warns about leftover ZIPs only if cleanup cannot be confirmed. Already-completed extraction cannot be undone. Changes observed during Upload All wait for that batch to finish, then sync the latest local files. Errors/Stop cancel the remaining queue and active requests. The uploader uses direct HTTPS with normal certificate verification; Prophet-specific proxy and ignore settings do not configure it.

HTTP and connection errors include the operation and safe remote path; connection errors retain an allowlisted code such as `ECONNRESET` or `ETIMEDOUT`, without exposing raw error text. A **403** means the server denied that operation; check WebDAV permissions, restrictions on the target code version and sandbox security rules. ZIP deployment reduces request count but does not bypass permissions. There is no automatic cartridge deletion or fallback to individual-file full upload after ZIP failure.

### Upload Output

Open **View → Output**, then choose **DW Manager Uploader**. Upload enable opens this channel while preserving editor focus. You can also run **DW Manager: Show Upload Output**, use Site Actions or the Activities header menu, or click the Upload activity row.

The channel shows the Site/Environment, hostname, code version, mode, available and skipped cartridges, watcher startup, successful file uploads (`[U]`) and deletions (`[D]`), Upload All completion/time, Cancel/Stop, and safe warning/error summaries. One channel is reused across sessions until the extension/window reloads. Username, password and authorization values are redacted. This is upload-specific Output; Git/npm logging remains unchanged.

VS Code **1.80.0+** is declared in the manifest. Sandbox credentials with WebDAV access are needed for uploads, logs and Impex; Prophet Debugger is required only for debugging. End users do not need a separately installed Node.js runtime.

## Export and import

**Export DW Manager Setup** creates `dw-manager-setup.zip` containing `dw-manager.json` and, if present, `dw.json`. It waits for archive completion before reporting success.

**Import DW Manager Setup** reads configuration entries directly from the ZIP, validates the schema and IDs, and replaces `dw-manager.json`. It replaces `dw.json` only when that file is included in the archive; otherwise the existing active file remains and its IDs/values are reflected into the imported configuration on reload. It does not extract arbitrary archive paths. Legacy archives containing `dw-envs.json` are also converted. The two views and active selection reload after importing. Exported archives contain plaintext credentials.

## Activities and concurrent operations

**Activities** appears between Sites and Logs. **Show Activities** uses the registered TreeView directly. If the current window still has an old view registry after an update, the command offers **Reload Window** instead of failing with a missing focus command. If it is hidden or moved, run **DW Manager: Show Activities** from the command palette, or use **Show Activities** in the Environments/Sites header menu. You can also right-click a DW Manager view header and enable Activities. After installing a new VSIX, use **Developer: Reload Window** if the running window still shows the old layout.

The Upload All notification title shows **Site @ Environment**; its message shows completed/total cartridges without repeating the count in the title.

**Activities** shows the DW Manager uploader, observed Prophet debug sessions and repository tasks (Git/install/compile). Upload displays **Watching**, **Uploading completed/total**, **Starting**, **Off**, or **Failed**, with its Site/Environment and a tooltip listing the cartridge scope. Watching means only subsequent local changes will be sent; Upload All counts completed cartridges; a cartridge completes after ZIP upload, extraction and ZIP cleanup; cartridges with no eligible files are skipped and counted complete. Watch bursts report file operations.

Use each row's **Stop Activity** or **Start / Re-run Activity** button. Upload resume restores its previous Site/Environment pair and cartridge scope, in watch-only mode. Stop Debugging ends just that session. Its row is removed automatically when VS Code reports termination; start it again from Sites → Start Debugging. Stop Task terminates that task; re-run uses its captured Site and action with current repoTools settings. Expand a task to see each repo's Git/install/compile status, scoped to that run rather than old cached build results. **Refresh Activities** reconciles upload state; **Clear Finished Activities** removes completed repository task rows; terminated debug rows are already removed automatically.

| Situation | Behavior |
| --- | --- |
| Upload and debug on the same Site/Environment | Can remain enabled together; stopping one does not stop the other. |
| Enable upload on another Site | Stops the old uploader, selects the new Site, then starts one uploader for the new pair. There are no parallel Site uploaders in one workspace. |
| Change Site/Environment or edit active values through DW Manager | Stops upload before writing the changed target. Upload stays off until explicitly enabled again. Existing connected debug sessions retain their connection. |
| Start debugging another Environment | Stops old-target upload during selection; existing debug on a different hostname may remain running. |
| Start a second debug session on the same hostname | Blocked until the existing observed session is stopped, avoiding Prophet client/breakpoint conflicts. Different Site names on one sandbox still share that hostname; they are not independent debuggers. |
| Change configuration while debug is initializing | Managed changes are blocked until Prophet's adapter target is received, or the starting activity is stopped. |
| External edits to dw.json | Upload is stopped after the file reload is detected. A pending debug with a changed target is canceled. Already-sent HTTP requests cannot be undone. |
| Build/install on another Site | Uses an independent Site snapshot. Same-root tasks remain serialized by the repository lock; different roots can run concurrently. |

Upload binding persists only safe IDs, labels, hostname, a one-way target digest and cartridge names in VS Code workspace state; credentials remain in the uploader's in-memory target snapshot. Opening/reloading VS Code always leaves upload **Off**, even when the previous binding still matches. Binding is for manual resume only. When Prophet is installed, DW Manager keeps `extension.prophet.upload.enabled` **false** and stops its native subscription at startup and before enabling DW Manager upload. This avoids running two uploaders and avoids Prophet's automatic full-upload/extra-cartridge prompt. Use DW Manager upload controls; native Prophet commands invoked separately are outside Activities tracking and can start another uploader. Target configuration changes stop the current DW Manager session; in-flight requests are aborted, but completed server writes cannot be undone.

Debug rows represent live sessions only and disappear on termination, avoiding duplicate rows after repeated starts. They first show an **unverified** requested target. DW Manager observes Prophet's `DebuggerConfig` adapter message, compares the connection digest, and stops the session if the target differs; **Running** appears after the adapter's initialized event. Launch-time timeout also stops an unverified session. Sessions launched externally or already active at extension startup may remain **target unverified**. Detection relies on Prophet's adapter protocol (checked against local 1.4.81), so server and installed-version behavior still requires manual validation. Restarted debugger sessions are checked again. Multiple sessions are supported on different hostnames. Prophet 1.4.81 defaults to client ID `prophet` and clears breakpoints during launch; DW Manager retains the same-host guard. The [Salesforce Debugger API](https://salesforcecommercecloud.github.io/b2c-dev-doc/docs/current/sdapi_2_0.pdf) documents the debugger client's breakpoint and halted-thread lifecycle.

Repository operation history is in memory; running VS Code tasks can be recovered when this extension activates, while completed rows disappear on reload. Activities covers repository tasks launched by DW Manager, not arbitrary terminal commands. Git/build file changes may trigger an enabled DW Manager watcher; stop upload first if those changes should stay local.

## Site repository tools

Each Site offers a **Repository Tools** menu. These actions read that Site by ID directly from `dw-manager.json`; they neither select it nor read/write `dw.json`, and need no Environment. They run locally in a VS Code Task terminal with concise OK/SKIP/FAIL/BLOCKED statuses. Git/npm command output and error bodies remain hidden; `.dw-update-log.json` stores state, not command-output logs.

| Action | Behavior |
| --- | --- |
| Preview Site Repositories | Show matching repositories, root, Node version, branch priority, concurrency, and skip policy without executing Git/npm. |
| Git Reset All | Fetch all origin branches, select the first existing priority branch, switch to it, hard-reset and clean untracked files. |
| Install All | Force `npm install` in each eligible repo, without Git or compile. |
| Re-install All | Remove `node_modules`, then force `npm install`, without Git or compile. |
| Compile All | Run available `compile:scss` then `compile:js`, without Git or install. |
| Compile SCSS / Compile JS | Run just that script; a partial build is not recorded as a complete build. |
| Install and Compile All | Install when missing/stale/changed, then compile; no Git. |
| Update All Repositories | Git reset stage, smart install/reinstall, then compile. All Git workers finish before npm starts; failed Git repos are excluded. |
| Update Changed Repositories | Same Git stage; process changed repos, stale/missing dependencies, and unfinished builds. |
| Configure Repository Tools | Open `dw-manager.json`, inserting default `repoTools` settings if missing. |
| Open Repository State | Open the root's `.dw-update-log.json` with repo/cartridge branch, commit, install/build dates/status, and missing-script cache. |

`repoTools` at the top level provides workspace defaults. A Site can override individual settings with its own `repoTools` object (e.g. `{"nodeVersion":"18.20.8","priorityBranches":["develop","master"]}`). Overrides are shallow: a supplied `skipRepos` map replaces the common map. Site edits preserve these overrides; export/import includes them. Settings are optional, keeping existing schemaVersion 2 files compatible.

`rootDir` is relative to the first workspace folder, or an absolute directory. Default `.` scans immediate child repos having `.git` and `cartridges/<name>` matching the Site's colon-separated path; each repo runs once even when several cartridges match. Symlink repo directories are excluded. This matches the existing Company layout; it does not recursively find arbitrary nested repositories.

Default Node is **8.17.0**, Git concurrency **8**, install/compile repo concurrency **4**, and reinstall age **30 days**. Node/npm steps use your existing NVM installation (`NVM_DIR`, otherwise `~/.nvm`) and the configured numeric Node version; Git-only runs require no Node. Install/build actions require Bash, Python 3, Git, and macOS/Linux. Windows users need a supported extension host such as WSL. Node versions are not auto-installed.

Smart installation reinstalls when modules are missing, the last successful install is unknown/older than the threshold, or Node version changed; dependency-file changes and unsuccessful installs trigger `npm install`. The seven default skipped repos are listed in the config example; Git still runs for them. Missing compile scripts are remembered by package.json hash and checked again when that file changes. Repository state is shared by all Sites using the same root, so installs are reused across Sites.

Reset actions discard tracked local edits and `git clean -fd` removes untracked files; ignored files are retained. The UI shows the concrete repository list and asks confirmation before Git reset/update or force reinstall. Use Preview first to inspect scope. Stop a running Task with VS Code's **Tasks: Terminate Task**. A root lock (`.dw-update.lock`) prevents overlapping runs; the state lock (`.dw-update-log.json.lock`) protects parallel updates. After a crash, remove a stale root lock only after verifying no workers remain.

The standalone `update_repo_by_dw.sh` also supports Site mode:

```sh
bash update_repo_by_dw.sh --manager-config /path/to/dw-manager.json --site-id <site-uuid> --root /path/to/repos --action all
```

Supported script actions: `git`, `install`, `reinstall`, `compile`, `scss`, `js`, `install-compile`, `all`, `changed`. The supplied `--root` determines standalone scan scope; use the extension for resolved `rootDir` settings. Calling the old standalone script without arguments retains its legacy `dw.json` behavior. The VSIX includes its own `scripts/update-repos.sh`; it does not require the Company script to be installed.

## Commands

| Area | Commands |
| --- | --- |
| Environments | Create Environment; Select Environment; Edit Environment; Delete Environment |
| Sites | Create Site; Select Site; Edit Site; Delete Site; Change Site Cartridges |
| Configuration | Refresh Configuration; Export DW Manager Setup; Import DW Manager Setup |
| Cartridges | Refresh Cartridges; Open Cartridge; Reveal Cartridge in Explorer |
| Logs | Refresh Logs; Tail Log; Stop Tailing |
| Impex | Refresh Impex; Open Impex File |
| Activities | DW Manager: Show Activities; Start / Re-run Activity; Stop Activity; Refresh Activities; Clear Finished Activities |
| Repository Tools | Preview Site Repositories; Git Reset All; Install All; Re-install All; Compile All; Compile SCSS; Compile JS; Install and Compile All; Update All Repositories; Update Changed Repositories; Configure Repository Tools; Open Repository State |
| Debugging | Start Debugging |
| Upload | DW Manager: Enable Upload (Watch Changes Only); DW Manager: Enable Upload and Upload All; DW Manager: Enable Upload for Selected Cartridges; DW Manager: Enable Upload and Upload Selected Cartridges; DW Manager: Disable Upload; DW Manager: Show Upload Output |

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

Edit `src/`; `out/` is generated and ignored by Git. VS Code loads `out/extension.js` via `package.json.main`. `npm run compile` produces development JavaScript under `out/`; `npm run watch` recompiles it; **F5** starts the configured Extension Development Host. Packaging bundles dependencies into `out/extension.js` and includes the runtime, repository shell engine, manifest, README, CHANGELOG, license, and icons.

Install via **Extensions → … → Install from VSIX…**, or:

```sh
code --install-extension dist/dw-manager-2.8.4.vsix
```

A build packages locally and does not publish. See the [VS Code packaging documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## Version notes

See [CHANGELOG.md](CHANGELOG.md) for the changes in each version, including historical versions and migration notes. Every version bump must add its notes at the top; the VSIX build checks that the current version has a nonempty entry.

## Versioning and implementation guide

Follow [AGENTS.md](AGENTS.md): bump PATCH for compatible fixes/docs/tooling, MINOR for compatible new features, and MAJOR for breaking behavior/IDs/data formats. Rebuilding unchanged source does not bump its version.

Every project change must update the affected documentation sections: setup, workflow, configuration examples, synchronization/migration, commands, import/export, build/install, and version references as applicable. Keep this README, [AI_CONTEXT.md](AI_CONTEXT.md), and manifest behavior consistent.

Read [AI_CONTEXT.md](AI_CONTEXT.md) for the implementation map, synchronization rules, migration details, and remaining limitations.

Upload duplicate priority follows valid Demandware `.project` discovery order using Prophet’s folder-scoped `RelativePattern` query (`**/.project`, excluding `**/{node_modules,.git}/**`, without a result cap). The first valid root wins; filesystem search order is not a fixed alphabetical priority. Supplemental DW Manager bare-folder discovery runs afterward and cannot override that root.
