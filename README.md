# DW Environment Switcher

**Author:** Ivaylo Trepetanov  
**License:** MIT

---

## About

This extension is designed to improve the developer workflow when working with **Salesforce Commerce Cloud** and **Prophet Debugger** inside Visual Studio Code.

Easily manage multiple sandbox environments, securely store credentials, dynamically select cartridges, and export or import sandbox configurations between different workstations.

✅ **NEW:**  
- "Switch Current Sandbox Code Version" command for fast version switching.  
- "Change Saved Password" command to easily update passwords globally and for all sandboxes.  
- **Activity Bar View with sandbox management actions (edit, change cartridges/user, delete)**  
- **Clickable sandbox entries to activate sandbox directly from the view**  
- **Visual indicator (green check ✅ for active, red circle 🔴 for inactive sandboxes)**

---

## Features

- 🌐 Manage multiple Salesforce Commerce Cloud sandboxes.
- 🔐 Securely store global usernames and passwords.
- 🔄 Quickly switch between hostnames and code versions.
- 🛠 Save and overwrite sandbox configurations.
- 📦 Dynamically select cartridges from your workspace.
- 🚮 Delete saved users and sandboxes easily.
- 📥 Import and 📤 export sandbox setups with ease.
- ✅ **Switch current sandbox code version without changing other settings.**
- 🔑 **Change saved password for users globally and update all sandboxes and active sandbox.**
- 📌 **Activity Bar view for easy sandbox access and editing.**
- 🔴 ✅ **Easily activate sandboxes by clicking them in the view (red = inactive, green = active)**.
- 📜 **Live-tail sandbox log files (error/warn/info/debug) straight from the Activity Bar, no Business Manager needed.**
- 🐞 Seamless integration with Prophet Debugger setups.

---

## Activity Bar View

DW Environment Switcher adds a new icon to the Activity Bar.

From the **Sandboxes view**, you can:

- ✅ **See which sandbox is active (green check icon).**
- 🔴 **See inactive sandboxes (red circle icon with "Activate" label).**
- 📌 **Activate sandbox by clicking directly on it in the list.**
- ✏️ **Edit sandbox details, change cartridges/code version/user, toggle Prophet upload, or delete** — click the `Sandbox Actions` inline button (or right-click the sandbox) to open the actions submenu right at the item.
- 🔑 **Change saved password** (use command palette `Change Saved Password`).

This makes sandbox management fast and intuitive — no need to use command palette for most operations.

From the **Cartridges view**, you can:

- 📦 **Browse every cartridge discovered in the workspace as an expandable tree**, drilling into its folders/files with the same icons as the built-in Explorer.
- 📄 **Click a file to open it directly** in the editor.
- 🗂️ **Open a cartridge as its own workspace folder** or **reveal it in the Explorer** via the inline/right-click actions on the cartridge root.
- 🔄 **Refresh** the list from the view title bar, or let it refresh automatically when cartridge folders or `.project` files change.

From the **Logs view**, you can:

- 📜 **See every log file** (`error-*.log`, `warn-*.log`, `info-*.log`, `debug-*.log`, ...) available on the currently active sandbox, fetched over WebDAV using its saved credentials.
- ▶️ **Click a log file to start live-tailing it** — its content streams into a dedicated Output Channel and keeps appending new lines as they're written on the sandbox, similar to Prophet Debugger's log tail.
- ⏹️ **Right-click (or use the inline button on) a file that's currently tailing to stop it.**
- 🔄 **Refresh** the file list from the view title bar. It also refreshes automatically whenever you activate, add, edit, or change credentials for a sandbox.

> Requires a currently active sandbox (`dw.json`) with a saved hostname, username, and password that has WebDAV access to `Sites/Logs/` on the instance.

---

## Commands Available

- `Select Sandbox`: Select an environment from `dw-envs.json`.
- `Select Sandbox with Details`: Create a sandbox config manually (hostname, username, password, code version, cartridges).
- `Switch Current Sandbox Code Version`: Change only the `code-version` of the current sandbox.
- `Change Saved Password`: Update saved passwords globally and in all related sandboxes.
- `Delete Saved Username`: Remove a saved username and password.
- `Delete Saved Sandbox`: Remove a saved sandbox from `dw-envs.json`.
- `Export Sandbox Setup`: Backup `dw.json`, `dw-envs.json` and global state to a zip file.
- `Import Sandbox Setup`: Restore sandbox setup from a zip file.

---

## How to Use

1. Open your Commerce Cloud project in VS Code.
2. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) or use the **Activity Bar view**.
3. Use sandbox commands or right-click on sandboxes in the view to manage them.
4. Select or create sandbox environments, choose cartridges, or switch code versions easily.
5. **Click on any inactive sandbox (red circle 🔴) to instantly activate it.**

### Switching Code Version

Use `Switch Current Sandbox Code Version` command to:

- Quickly change the `code-version` for your current sandbox (`dw.json`).
- Automatically update `dw-envs.json` if the sandbox exists there.

No need to reselect hostname or username — just pick or enter the new code version.

### Change Saved Password

Use `Change Saved Password` command to:

- Select a saved username from the list.
- Enter a new password securely.
- Update the password globally and in all sandboxes (`dw-envs.json` and `dw.json` if active sandbox matches).

This is useful when passwords expire or need to be rotated.

---

### Export Setup

- Use `Export Sandbox Setup` to save your environment into a zip file.
- Exports `dw.json`, `dw-envs.json`, and global state (credentials, hostnames, usernames, code versions).
- Useful for backups or transferring environments between machines.

### Import Setup

- Use `Import Sandbox Setup` to restore sandbox configurations.
- Select the exported zip file and the extension will apply the configurations to your current workspace.

---

## Cartridge Selection

When configuring or switching sandboxes (using `Select Sandbox with Details`):

1. Choose **Yes** when prompted to select cartridges.
2. The extension lists valid cartridges from the workspace (folders with `.project` and `cartridges` folder).
3. Pick cartridges to associate with the sandbox. These will be added to `dw.json`.

---

## Requirements

- VS Code with Prophet Debugger installed.
- Project folder with `dw.json` and/or `dw-envs.json` (automatically created if missing).
- Node.js installed locally (VS Code extension dependencies only).

---

## Extension Settings

No configuration required.  
All credentials and sandbox environments are stored securely in VS Code global state.

---

## License

MIT © 2025 Ivaylo Trepetanov
