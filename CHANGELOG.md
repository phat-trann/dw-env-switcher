# Version notes

Project versions are listed newest first. Historical notes are reconstructed from repository history and completed project changes; these are local builds, not claims of Marketplace publication. Dates are included only when known.

## 2.8.4 — 2026-10-06

- Match Prophet’s folder-scoped `.project` search, exclusion pattern and uncapped results before selecting duplicate roots. This fixes reversed `modules` selection caused by DW Manager’s previous global search query.
- Keep duplicate warnings and supplemental discovery without overriding the first valid project root.

## 2.8.3 — 2026-10-05

- Match Prophet’s duplicate-cartridge handling: keep the first valid discovered root, warn and skip later roots instead of failing upload.
- Preserve valid Demandware `.project` discovery order ahead of supplemental bare-folder roots.
- Show skipped and retained root paths in Output; watch/upload only one root per cartridge name and count it once.

## 2.8.2 — 2026-10-05

- Match Prophet’s default SFRA upload scope by adding `modules` once, without editing Site or `dw.json` paths.
- Recognize `.project`-backed `modules` without a `cartridge/` folder and upload/watch its root-level runtime files.
- Include `modules` in the cartridge picker and progress while retaining explicit subset/resume choices, ignore rules and root credential-file exclusions.

## 2.8.1 — 2026-10-05

- Recover transient ZIP transfer/extraction/cleanup failures with three cancellable retries and 4/6/8-second backoff; reopen ZIP input streams for retries.
- Preserve safe network error codes and operation/path instead of a generic upload-request error; do not retry permission or certificate failures.
- Reconnect to the captured target for owned temporary ZIP cleanup after Stop/batch failure, warning only when deletion cannot be confirmed.
- Shorten upload progress title to Site @ Environment; retain completed/total cartridges in the message.

## 2.8.0 — 2026-10-05

- Speed up Upload All with parallel per-cartridge ZIP transfer and server-side UNZIP; watch continues uploading changed files individually.
- Preserve ignore rules and remote-only files; remove only owned temporary ZIPs, without deleting remote cartridges before extraction.
- Use disk-backed archives, cancellation-safe local cleanup and extended ZIP inactivity timeouts. Output shows cartridge ZIP stages and warns if remote ZIP cleanup remains necessary.
- Include operation/path in HTTP failures and actionable context for 403 instead of a generic file-upload error.

## 2.7.0 — 2026-10-05

- Add shared `upload.ignore` regex patterns and `upload.watchDebounceMs` (default 300ms); watch and Upload All use the same ignore rules.
- Show completed/total cartridges in Upload All progress, retaining Site and Environment labels.

## 2.6.1 — 2026-10-05

- Configure shared watch/Upload All concurrency with top-level `upload.concurrency` in `dw-manager.json` (default 5).
- Apply the same limit to file workers and HTTPS connections; Disable/Enable Upload applies changes to a new session.

## 2.6.0 — 2026-10-05

- Upload up to five independent files concurrently in watcher and Upload All modes, matching Prophet's file concurrency. Reuse HTTPS connections and share code-version/directory checks.
- Preserve same-file and parent/child operation order; keep changes observed during Upload All behind its batch and cancel queued/in-flight work on Stop or failure.
- Show Site @ Environment and file progress in Upload All loading; keep watcher activity progress accurate until its burst finishes.

## 2.5.0 — 2026-10-05

- Add DW Manager Uploader in Output, with a Show Upload Output command/menu and upload-row shortcut. Show target/mode/scope, file uploads/deletions, completion/time, Cancel/Stop and safe warning/error summaries with credentials redacted.
- Follow Prophet's missing-cartridge behavior: warn and skip local cartridges that are unavailable, continuing with the remaining scope. If every cartridge is missing, stay Off without transferring.
- Keep duplicate/invalid-root errors, manual-only watcher startup, selected scopes and cancellation safeguards. Document the public MIT Prophet source used as a behavioral reference; the DW Manager engine remains locally implemented.

## 2.4.1 — 2026-10-05

- Remove debug activities automatically when their session terminates, avoiding duplicate stopped rows after repeated launches.
- Preserve other running sessions and their pending target guards; restart debugging from Sites. Clear Finished remains available for completed repository tasks.

## 2.4.0 — 2026-10-05

- Enable Upload now watches changes without immediately uploading. Add explicit Enable Upload and Upload All plus watch/upload modes for selected Site cartridges.
- Use a DW Manager WebDAV uploader so Prophet's full-upload/extra-cartridge prompt no longer runs through these controls. Extra remote cartridges and remote-only files are preserved.
- Activities reports actual watcher/file-operation status and scope. Cancel or Stop aborts upload and stops watching; failures show Failed rather than a stale Enabled state.
- Keep manual-only resume and target-change guards. Upload no longer requires Prophet; Prophet remains the debugger. Document and test concurrent debugging on different hosts while retaining the same-host breakpoint guard.

## 2.3.3 — 2026-10-05

- Open Activities through its TreeView handle instead of relying on a missing generated focus command; offer Reload Window when the window has stale views after updating.
- Register views and commands before startup upload cleanup, so a cleanup error does not leave the sidebar unregistered.
- Keep Activities between Sites and Logs and align the README view order.

## 2.3.2 — 2026-10-05

- Fix upload automatically resuming when reopening VS Code with a matching saved target.
- Keep Prophet's saved upload flag false; explicitly enabled upload runs only for the current session through its native command.
- Always reset/stop upload at startup, retain the previous pair for manual resume, and stop the live uploader on extension deactivation.
- Clear legacy enabled settings before activating Prophet; document that already-sent requests cannot be retracted.

## 2.3.1 — 2026-10-05

- Add **DW Manager: Show Activities** to the command palette and the Environments/Sites header menus to reveal and focus the Activities view.
- Place Activities immediately after Sites, with default visibility enabled. VS Code can still remember a user's hidden/moved view layout.
- Add this version history, link it from README, and include it in the VSIX.
- Require a matching, nonempty version note before building a VSIX; document the rule for future updates.

## 2.3.0

- Add Activities for the workspace uploader, Prophet debug sessions, and Site repository tasks, with stop, resume/re-run, refresh, and clear-finished controls.
- Bind one uploader to a Site/Environment pair; stop it before managed target changes. Upload and debug on the same pair can coexist.
- Track requested debugger targets, verify Prophet adapter configuration, stop mismatches, and protect/cancel pending starts. Block observed same-host debug conflicts.
- Show per-repo Git/install/compile phases for the current task separately from cached planning state.
- Distinguish upload enabled state from actual transfer progress; document external-edit and Prophet integration limits.

## 2.2.0

- Add Site **Repository Tools**: preview, Git reset, install/reinstall, compile all/SCSS/JS, install-and-compile, update all/changed, configuration, and repository state.
- Read the clicked Site directly, without selecting it or reading/writing dw.json.
- Store global and per-Site repoTools settings in dw-manager.json: root, Node version, branch priority, concurrency, reinstall age, and skip policies.
- Bundle the Bash/Python engine; retain the Git completion barrier, smart reinstall, per-cartridge state, missing-script cache, and quiet command output.
- Extend the standalone update_repo_by_dw.sh with Site/config/action modes while retaining legacy invocation.

## 2.1.1

- Move Start Debugging and Prophet Enable/Disable Upload from Environment Actions to **Site Actions**.
- Move the debugging header button to Sites; debugging selects the clicked Site and retains/prompts for an Environment.
- Update documentation and preserve the UI placement rule in AGENTS.md.

## 2.1.0

- Restore Start Debugging and visible Prophet Enable/Disable Upload actions (initially in Environment Actions).
- Restore the remote Impex sidebar: expand WebDAV folders, open text snapshots, and download binary files.
- Remove the Cartridges sidebar; keep Site cartridge selection and local cartridge commands.
- Add Impex path/status handling and stale-response protection when active configuration changes.

## 2.0.1

- Clarify incomplete selections, dw.json reverse synchronization, and imports without an active file.
- Require complete updates to affected README and AI_CONTEXT sections for each project change.

## 2.0.0

- **Breaking:** replace combined Sandboxes with independent Environments and Sites, each with stable generated IDs.
- Replace dw-envs.json with dw-manager.json (schemaVersion 2), migrating the legacy data while retaining the original file.
- Generate dw.json only with a complete selected pair; persist environmentId/siteId and reflect active values by ID on startup/external reload.
- Preserve unrelated dw.json options, ordered cartridge paths, and record identity through edits/renames.
- Update commands, views, ZIP import/export, validation, documentation, and migration/synchronization tests for the new model.

## 1.0.1

- Establish semantic version bumps for completed updates and align local lockfile metadata and versioned installation examples.
- Keep generated out/, dist/, and VSIX artifacts out of Git; rebuild the runtime from src/.

## 1.0.0

- Rename the project/extension to **DW Manager** (Ferb.dw-manager), with matching commands, views, package names, and metadata.
- Add local npm run build / build:vsix packaging, TypeScript compile plus esbuild bundling, and a VSIX asset allowlist.
- Add/update README, AI_CONTEXT, project guidance, and build/install instructions.
- The initial packaging work and rename were rebuilt under this same version; local artifacts may have either dw-env-switcher or dw-manager filenames.

## 0.1.11 — repository baseline

- Original DW Environment Switcher implementation: combined Sandbox configuration and selection, cartridge browsing, remote log tailing, Prophet upload setting, and ZIP setup import/export.

## Legacy reference: upstream 0.1.13

The separately installed IvayloTrepetanov.dw-env-switcher 0.1.13 contained Start Debugging and Impex, which were absent from this repository's 0.1.11 baseline. Those features were restored in DW Manager 2.1.0. This upstream version is not a DW Manager release.
