import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Site } from '../types';
import { validateConfig } from '../config/model';
import { DEFAULT_REPO_TOOLS, discoverSiteRepos, resolveRepoTools } from './config';
import { randomUUID } from 'crypto';

export const REPO_ACTIONS = {
    preview: 'Preview Site Repositories', git: 'Git Reset All', install: 'Install All', reinstall: 'Re-install All',
    compile: 'Compile All', scss: 'Compile SCSS', js: 'Compile JS', 'install-compile': 'Install and Compile All',
    all: 'Update All Repositories', changed: 'Update Changed Repositories', configure: 'Configure Repository Tools', state: 'Open Repository State'
} as const;
export type RepoAction = keyof typeof REPO_ACTIONS;

/** Read the chosen Site directly; do not select it, reflect dw.json, or load ConfigStore. */
export async function runRepoAction(context: vscode.ExtensionContext, action: RepoAction, siteId?: string): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) { vscode.window.showErrorMessage('Open a workspace first.'); return; }
    const file = path.join(workspace.uri.fsPath, 'dw-manager.json');
    let temporary: string | undefined;
    try {
        const config = JSON.parse(fs.readFileSync(file, 'utf8')); validateConfig(config);
        if (action === 'configure') {
            if (!config.repoTools) {
                config.repoTools = DEFAULT_REPO_TOOLS;
                const temp = `${file}.${randomUUID()}.tmp`;
                try { fs.writeFileSync(temp, JSON.stringify(config, null, 4) + '\n', { mode: 0o600 }); fs.renameSync(temp, file); }
                finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
            }
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
            return;
        }
        let site: Site | undefined = config.sites.find(entry => entry.id === siteId);
        if (siteId && !site) throw new Error('Site no longer exists.');
        if (!site) {
            const selected = await vscode.window.showQuickPick(config.sites.map(entry => ({ label: entry.name, description: entry.id, entry })), { placeHolder: 'Choose Site for repository tools (active selection stays unchanged)' });
            if (!selected) return;
            site = selected.entry;
        }
        const selectedSite = site!;
        const settings = resolveRepoTools(workspace.uri.fsPath, config.repoTools, selectedSite.repoTools);
        const stateFile = path.join(settings.rootDir, '.dw-update-log.json');
        if (action === 'state') {
            if (!fs.existsSync(stateFile)) { vscode.window.showInformationMessage('No repository state yet. Run repository tools first.'); return; }
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(stateFile))); return;
        }
        const repos = discoverSiteRepos(settings.rootDir, selectedSite);
        if (!repos.length) { vscode.window.showInformationMessage('No matching Site repositories found. Check repoTools.rootDir and cartridgesPath.'); return; }
        if (action === 'preview') {
            const content = `Site: ${selectedSite.name}\nRoot: ${settings.rootDir}\nNode: ${settings.nodeVersion}\nPriority branches: ${settings.priorityBranches.join(' → ')}\nGit jobs: ${settings.gitJobs}; repo jobs: ${settings.repoJobs}\nReinstall after: ${settings.reinstallDays} days\n\n` + repos.map(name => {
                const skip = settings.skipRepos[name] ?? {};
                return `${name} | install: ${skip.skipInstall ? 'SKIP' : 'enabled'} | compile: ${skip.skipCompile ? 'SKIP' : 'enabled'}`;
            }).join('\n');
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'plaintext' })); return;
        }
        if (process.platform === 'win32') { vscode.window.showErrorMessage('Repository tools require Bash, Python 3 and NVM on macOS/Linux.'); return; }
        if (['git', 'all', 'changed', 'reinstall'].includes(action)) {
            const description = action === 'reinstall' ? 'removes node_modules before npm install' : 'discards local tracked changes and untracked files using git reset --hard and git clean -fd';
            const choice = await vscode.window.showWarningMessage(`${REPO_ACTIONS[action]} for Site "${selectedSite.name}" ${description}. Repositories (${repos.length}): ${repos.join(', ')}`, { modal: true }, 'Run');
            if (choice !== 'Run') return;
        }
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-manager-repos-'));
        const snapshot = path.join(temporary, 'site.json');
        // Snapshot contains no Environment or deployment credentials.
        fs.writeFileSync(snapshot, JSON.stringify({ site: { id: selectedSite.id, name: selectedSite.name, cartridgesPath: selectedSite.cartridgesPath }, repoTools: settings }), { mode: 0o600 });
        const taskRunId = randomUUID();
        const task = new vscode.Task({ type: 'dw-manager-repos', siteId: selectedSite.id, action, runId: taskRunId, siteName: selectedSite.name, rootDir: settings.rootDir }, workspace,
            `${REPO_ACTIONS[action]}: ${selectedSite.name}`, 'DW Manager',
            new vscode.ProcessExecution('bash', [context.asAbsolutePath('scripts/update-repos.sh'), '--site-config', snapshot, '--root', settings.rootDir, '--action', action], {
                cwd: settings.rootDir, env: { LOG_FILE: stateFile, SKIP_GIT: '0', SKIP_NPM: '0', SKIP_BUILD: '0', CHANGED_ONLY: '0', DW_RUN_ID: taskRunId }
            }));
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        const directory = temporary;
        let execution: vscode.TaskExecution | undefined;
        let completed: { execution: vscode.TaskExecution; exitCode?: number } | undefined;
        const finish = (ended: vscode.TaskExecution, exitCode?: number) => {
            if (ended !== execution) return;
            fs.rmSync(directory, { recursive: true, force: true }); listener.dispose(); fallback.dispose();
            if (exitCode === 0) vscode.window.showInformationMessage(`${REPO_ACTIONS[action]}: ${selectedSite.name} — OK.`);
            else vscode.window.showWarningMessage(`${REPO_ACTIONS[action]}: ${selectedSite.name} — ${exitCode === undefined || exitCode === 130 || exitCode === 143 ? 'stopped' : 'FAIL'}. Check task statuses.`);
        };
        const listener = vscode.tasks.onDidEndTaskProcess(event => {
            if (event.execution.task.definition.runId === task.definition.runId) { completed = { execution: event.execution, exitCode: event.exitCode }; if (execution) finish(event.execution, event.exitCode); }
        });
        const fallback = vscode.tasks.onDidEndTask(event => { if (event.execution === execution && !completed) finish(event.execution); });
        try { execution = await vscode.tasks.executeTask(task); }
        catch (error) { listener.dispose(); fallback.dispose(); throw error; }
        // End events normally arrive after executeTask; handle unusually fast tasks too.
        if (completed?.execution === execution) finish(execution, completed.exitCode);
        temporary = undefined;
    } catch { vscode.window.showErrorMessage('Cannot run Site repository tools. Check dw-manager.json, root directory and task prerequisites.'); }
    finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
}
