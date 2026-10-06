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

## Documentation completeness

For every project change, review the existing documentation against the final implementation and update every affected section before completing the work. Do not merely append a note while leaving obsolete descriptions or examples elsewhere.

- Update README requirements/setup, user workflow, configuration examples, persistence/reverse synchronization, migration, commands/tree actions, import/export, and build/install instructions whenever the corresponding behavior changes.
- Keep command names, configuration filenames/fields, script names, extension identity, and versioned installation examples consistent with source and package.json.
- Update AI_CONTEXT for changes to architecture, source ownership, data contracts, lifecycle, synchronization, packaging, verification, and known limitations.
- Update these project instructions when the user establishes a lasting development or documentation rule.
- Use placeholder credentials in examples. Do not copy actual workspace credentials into documentation or packaged artifacts.

Documentation-only changes follow the PATCH version policy above. Report documentation alignment and any material validation limits when completing an update.

## Sidebar action placement

Keep Start Debugging and DW Manager upload controls in the Sites UI (Site Actions menu; debugging also in the Sites header). Debugging from a Site selects that Site and retains or prompts for an Environment. Upload is a single workspace uploader; enabling it selects the requested Site and retains/prompts for an Environment. Stop upload before managed target changes; preserve upload when debugging the same pair. Keep lifecycle controls in Activities and label enabled watching separately from actual file transfer.

Site repository tools belong in the Sites Repository Tools submenu. Read the chosen Site directly from dw-manager.json; never select it or read/write dw.json for these local operations. Keep repository configuration in optional global/Site repoTools fields, preserve overrides when editing Sites, and keep packaged/Company shell engines aligned. Test destructive operations only with temporary repositories.

Track upload/debug/task ownership with safe IDs/labels/digests, never credentials in activity metadata. Report file-operation progress only from DW Manager’s own uploader; do not infer external Prophet uploader state. Debugger target initialization guards must be scoped to the launching session. Current-run task phases must stay separate from cached install/build planning state.

## Version notes

Whenever package.json.version changes, add a matching entry at the top of CHANGELOG.md before completing the update. Describe the final user-visible changes, fixes and breaking/migration behavior as applicable. Preserve old notes, do not invent release dates or imply Marketplace publication, and do not add another version entry just for an unchanged rebuild. Keep README's version-note link and installation example aligned; include CHANGELOG.md in the VSIX. npm run build checks that the current version is the first version heading and has nonempty notes.

Upload must never auto-resume on startup/reload. Default Enable Upload watches changes only, with no initial transfer. Only explicit Upload All sends existing files. Scope can be all Site cartridges or a selected subset; selection does not alter Site/debug paths. Cancel full upload stops its watcher too. DW Manager owns the uploader: keep Prophet upload.enabled false and stop its native uploader; never call native Enable to implement these modes. Preserve extra remote cartridges and remote-only files; no implicit cleanup. Store only safe resume metadata and dispose/abort the session on Stop, target changes and deactivate. Keep same-host debug guard; different hosts may have concurrent sessions.

Upload has a dedicated DW Manager Uploader Output channel for lifecycle, safe transfer/status and warning/error summaries. Keep credentials, authorization, raw bodies/stacks out of it. Missing configured local cartridges warn and are skipped; available cartridges continue. If none exist, keep Off without making requests. Duplicate names keep the first valid discovered root and warn/skip later roots like Prophet; invalid roots remain excluded/errors as appropriate. Preserve requested scope for manual retry and show the effective scope separately.

Keep upload concurrency in top-level dw-manager.json upload.concurrency, shared across Sites, default 5. Pass the same session snapshot to queue, Upload All workers and HTTPS agent; do not add per-Site overrides.

Keep watch debounce and regex ignore lists in the same global upload config (default 300ms and node_modules/ plus ZIP suffix). Apply ignores consistently to watch events and batch enumeration/transfers. Upload All uses per-cartridge ZIP PUT → server-side UNZIP → temporary ZIP DELETE, preserving remote-only files and never deleting a cartridge before extraction. Count progress only after extraction and ZIP cleanup; watch remains per-file. Keep archives disk-backed/cancellable and report safe stage/path HTTP errors.

ZIP retries must reopen the archive stream, preserve safe network error codes/method/path, and be cancelable during backoff. After abort, cleanup uses a separate connection to the captured original target and removes only the owned unique ZIP. Progress title contains Site @ Environment without a duplicate cartridge count.

Expand nonempty default Site upload scopes with SFRA modules once, without changing persisted Site/dw.json paths. Include it in selection UI while preserving explicit selected/resume subsets. Recognize Demandware .project-backed modules roots without cartridge/ and apply identical ZIP/watch filtering to their root payload.
