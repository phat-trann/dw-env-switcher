import { resolveUploadSettings } from '../upload/config';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ConfigManager } from '../config/manager';
import { startDebugging } from '../config/debug';
import { stopProphetUpload } from '../prophet';
import { UploadSession, resolveUploadCartridges, uploadCartridgeNames, DuplicateUploadRoot } from '../upload/session';
import { UploadOutput } from '../upload/output';
import { UploadCanceled } from '../upload/client';
import { ActivityTarget, activityTarget, connectionFingerprint, uploadFingerprint } from './target';

interface DebugRecord { session: vscode.DebugSession; target?: ActivityTarget; status: string; verified: boolean; observedHost?: string; }
interface TaskRecord { execution: vscode.TaskExecution; status: string; stopped: boolean; }
export class ActivityItem extends vscode.TreeItem {
    parent?: ActivityItem;
    constructor(readonly kind: 'upload' | 'debug' | 'pending' | 'task' | 'repo', label: string,
        readonly key = '', collapsible = false) {
        super(label, collapsible ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    }
}

export class Activities implements vscode.TreeDataProvider<ActivityItem>, vscode.Disposable {
    private uploadItem = new ActivityItem('upload', 'Upload');
    private emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private subscriptions: vscode.Disposable[] = [];
    private debugRecords = new Map<string, DebugRecord>();
    private taskRecords = new Map<string, TaskRecord>();
    private upload?: { target: ActivityTarget; fingerprint: string; cartridges?: string[] };
    private uploadSession?: UploadSession;
    private uploadStatus = 'Off';
    private uploadOutput = new UploadOutput();
    private uploadScope?: string[];
    private uploadMissing: string[] = [];
    private canceledDebugRuns = new Set<string>();
    private uploadEnabled = false;
    private uploadStarting = false;
    private uploadGeneration = 0;
    private pendingDebug?: { target: ActivityTarget; fingerprint: string; runId: string; sessionId?: string; timer?: ReturnType<typeof setTimeout> };
    private timer: ReturnType<typeof setInterval>;
    private reconciling = false;
    constructor(private context: vscode.ExtensionContext, private manager: ConfigManager) {
        this.upload = context.workspaceState.get('dwManager.uploadBinding');
        this.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('extension.prophet')) void this.refresh(); }),
            vscode.debug.onDidStartDebugSession(session => this.debugStarted(session)),
            vscode.debug.onDidTerminateDebugSession(session => {
                const removed = this.debugRecords.delete(session.id);
                if (this.pendingDebug?.sessionId === session.id) this.clearPending();
                if (removed) this.emit();
            }),
            vscode.debug.registerDebugAdapterTrackerFactory('prophet', { createDebugAdapterTracker: session => { this.debugStarted(session); return ({
                onWillReceiveMessage: message => {
                    if (this.canceledDebugRuns.has(session.configuration.__dwManagerRunId)) { void vscode.debug.stopDebugging(session); return; }
                    if (message.command !== 'DebuggerConfig' || !message.arguments?.config) return;
                    const row = this.debugRecords.get(session.id); if (!row) return;
                    row.observedHost = message.arguments.config.hostname;
                    const expected = session.configuration.__dwManagerFingerprint;
                    if (expected && connectionFingerprint(message.arguments.config) !== expected) {
                        row.status = 'Target mismatch — stopping'; void vscode.debug.stopDebugging(session);
                        vscode.window.showErrorMessage('Prophet returned a different debug target. The session is being stopped. Retry after configuration settles.');
                    } else { row.verified = !!expected; row.status = expected ? 'Connecting' : 'Connecting — target unverified'; }
                    if (this.pendingDebug?.sessionId === session.id) this.clearPending(); this.emit();
                },
                onDidSendMessage: message => {
                    if (message.type === 'event' && message.event === 'initialized') {
                        const row = this.debugRecords.get(session.id); if (row && !row.status.toLowerCase().includes('stopping')) { row.status = row.verified ? 'Running' : 'Running — target unverified'; this.emit(); }
                    }
                }
            }); } }),
            vscode.tasks.onDidStartTask(event => this.taskStarted(event.execution)),
            vscode.tasks.onDidEndTaskProcess(event => this.taskEnded(event.execution, event.exitCode)),
            vscode.tasks.onDidEndTask(event => this.taskEnded(event.execution))
        );
        for (const execution of vscode.tasks.taskExecutions) this.taskStarted(execution);
        if (vscode.debug.activeDebugSession) this.debugStarted(vscode.debug.activeDebugSession);
        this.timer = setInterval(() => { if ([...this.taskRecords.values()].some(row => row.status === 'Running' || row.status === 'Stopping')) this.emit(); }, 750);
    }
    private emit(): void { this.emitter.fire(); }
    private current() {
        try { const active = this.manager.store?.readActive(); const target = this.manager.store && activityTarget(this.manager.store.config, active); return { active, target }; }
        catch { return {}; }
    }
    private persistedUploadEnabled(): boolean {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) return false;
        return !!vscode.workspace.getConfiguration(undefined, folder?.uri).get('extension.prophet.upload.enabled', false);
    }
    private enabled(): boolean { return this.uploadEnabled; }
    async resetUploadOnStartup(): Promise<void> {
        this.uploadSession?.dispose(); this.uploadSession = undefined;
        this.uploadGeneration++; this.uploadStarting = false; this.uploadEnabled = false; this.uploadStatus = 'Off';
        await stopProphetUpload(); this.emit();
    }
    async refresh(): Promise<void> {
        if (this.reconciling) return;
        this.reconciling = true;
        try {
            if (this.persistedUploadEnabled()) {
                await this.pauseUpload();
                vscode.window.showWarningMessage('Automatic upload is disabled. Use Enable Upload or Start Activity to run it for this session.');
            }
            const current = this.current();
            if (this.pendingDebug && (!current.active || connectionFingerprint(current.active) !== this.pendingDebug.fingerprint || current.target?.siteId !== this.pendingDebug.target.siteId)) {
                const session = this.pendingDebug.sessionId && this.debugRecords.get(this.pendingDebug.sessionId)?.session;
                if (session) await vscode.debug.stopDebugging(session);
                this.clearPending(true);
            }
            if (this.enabled() && (!this.upload || !current.active || this.upload.fingerprint !== uploadFingerprint(current.active))) {
                await this.pauseUpload();
                vscode.window.showWarningMessage('Upload stopped because its target changed or could not be verified. Enable it for the intended Site again.');
            }
        } catch { vscode.window.showErrorMessage('Cannot stop Prophet upload automatically. Disable it in Prophet before changing configuration.'); }
        finally { this.reconciling = false; this.emit(); }
    }
    async beforeActiveChange(): Promise<boolean> {
        if (this.pendingDebug) { vscode.window.showWarningMessage('Wait for debug target initialization, or stop the starting debug activity before changing configuration.'); return false; }
        await this.pauseUpload(); return true;
    }
    showUploadOutput(): void { this.uploadOutput.show(); }
    async pauseUpload(): Promise<void> {
        const wasEnabled = this.uploadEnabled || this.uploadStarting || this.persistedUploadEnabled();
        this.uploadGeneration++; this.uploadStarting = false; this.uploadEnabled = false; this.uploadStatus = 'Off';
        this.uploadSession?.dispose(); this.uploadSession = undefined; this.emit();
        if (wasEnabled) { this.uploadOutput.write('Stopped: watching and queued transfers canceled.'); await stopProphetUpload(); }
    }
    async enableUpload(siteId?: string, resume?: ActivityTarget, options: { uploadAll?: boolean; chooseCartridges?: boolean; cartridges?: string[] } = {}): Promise<void> {
        if (!siteId && !resume) {
            const choice = await vscode.window.showQuickPick(this.manager.store?.config.sites.map(site => ({ label: site.name, description: site.id, id: site.id })) ?? [], { placeHolder: 'Select Site to enable upload' });
            if (!choice) return; siteId = choice.id;
        }
        if (!await this.beforeActiveChange()) return;
        await this.manager.run(async () => {
            if (resume) await this.manager.select('environment', resume.environmentId);
            await this.manager.select('site', siteId ?? resume?.siteId);
            if (!this.manager.store?.environmentId) await this.manager.select('environment');
        });
        const current = this.current();
        if (!current.active || !current.target || (siteId && current.target.siteId !== siteId) || (resume && current.target.environmentId !== resume.environmentId)) return;
        this.uploadOutput.setTarget(current.active);
        this.uploadOutput.write(`Starting: ${current.target.siteName} @ ${current.target.environmentName} (${current.active.hostname}), version ${current.active.version}. Mode: ${options.uploadAll ? 'upload all then watch' : 'watch changes only'}.`);
        this.uploadOutput.show();
        const generation = ++this.uploadGeneration;
        this.uploadStarting = true; this.uploadStatus = 'Starting'; this.emit();
        try {
            const names = uploadCartridgeNames(current.active.cartridgesPath ?? '');
            let selected = options.cartridges ?? names;
            if (options.chooseCartridges) {
                const choice = await vscode.window.showQuickPick(names.map(name => ({ label: name, picked: true })), {
                    canPickMany: true, placeHolder: 'Choose cartridges for this upload session (Cancel leaves upload Off)'
                });
                if (!choice?.length) { this.uploadOutput.write('Cartridge selection canceled. Upload remains Off.'); return; }
                selected = choice.map(item => item.label);
            }
            if (!selected.length || selected.some(name => !names.includes(name))) throw new Error('Upload scope must contain cartridges from this Site.');
            const workspace = vscode.workspace.workspaceFolders?.[0]; if (!workspace) return;
            const missing: string[] = [];
            const duplicates: DuplicateUploadRoot[] = [];
            const cartridges = await resolveUploadCartridges(workspace.uri.fsPath, selected, name => missing.push(name), entry => duplicates.push(entry));
            const fingerprint = uploadFingerprint(current.active);
            if (generation !== this.uploadGeneration || uploadFingerprint(this.current().active ?? {}) !== fingerprint) return;
            if (duplicates.length) {
                const skipped = duplicates.flatMap(entry => entry.skipped);
                this.uploadOutput.warning(`Duplicate cartridges skipped: ${skipped.join(', ')}`);
                for (const entry of duplicates) this.uploadOutput.write(`Cartridge ${entry.name}: using first root ${entry.kept}`);
                vscode.window.showWarningMessage(`Following cartridge/s are duplicates and won't be uploaded: ${skipped.join(', ')}. The first root for each name will continue.`);
            }
            this.uploadMissing = missing; this.uploadScope = cartridges.map(item => item.name);
            if (missing.length) {
                this.uploadOutput.warning(`Skipping cartridges not found locally: ${missing.join(', ')}. Restart upload after adding them locally.`);
                vscode.window.showWarningMessage(`Skipping missing local cartridges: ${missing.join(', ')}.${cartridges.length ? ' Available cartridges will continue.' : ' No local cartridges are available; upload remains Off.'}`);
            }
            if (!cartridges.length) { this.uploadStatus = 'Off'; this.uploadOutput.write('No local cartridges available. Upload remains Off.'); return; }
            this.uploadOutput.write(`Cartridges to watch/upload: ${this.uploadScope.join(', ')}`);
            // Keep Prophet's uploader stopped. Its Enable command can force a full upload after the first call.
            await stopProphetUpload();
            if (generation !== this.uploadGeneration) return;
            this.upload = { target: current.target, fingerprint, cartridges: selected };
            await this.context.workspaceState.update('dwManager.uploadBinding', this.upload);
            if (generation !== this.uploadGeneration || uploadFingerprint(this.current().active ?? {}) !== fingerprint) return;
            let progress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
            let reported = 0;
            const settings = resolveUploadSettings(this.manager.store?.config.upload);
            const concurrency = settings.concurrency;
            this.uploadOutput.write(`Upload concurrency: ${concurrency} files for watch / cartridges for Upload All.`);
            const session = new UploadSession(current.active, cartridges, status => {
                if (generation !== this.uploadGeneration) return;
                if (progress && status.state === 'uploading') {
                    const percent = status.cartridgesTotal ? (status.cartridgesCompleted ?? 0) / status.cartridgesTotal * 100 : 0;
                    progress.report({ message: `${status.cartridgesCompleted ?? 0}/${status.cartridgesTotal ?? cartridges.length} cartridges`, increment: Math.max(0, percent - reported) }); reported = percent;
                }
                this.uploadStatus = status.state === 'uploading' ? `Uploading ${status.cartridgesCompleted ?? status.completed}/${status.cartridgesTotal ?? status.total} ${status.cartridgesTotal === undefined ? 'files' : 'cartridges'}` : 'Watching'; this.emit();
            }, message => {
                if (generation !== this.uploadGeneration) return;
                this.uploadGeneration++; this.uploadStarting = false; this.uploadEnabled = false; this.uploadStatus = 'Failed'; this.uploadSession = undefined; this.emit();
                this.uploadOutput.error(`Upload stopped: ${message}`);
                vscode.window.showErrorMessage(`Upload stopped: ${message}`);
            }, message => this.uploadOutput.write(message), concurrency, settings);
            this.uploadSession = session; this.uploadEnabled = true; this.uploadStarting = false; this.uploadStatus = 'Watching'; this.emit();
            if (options.uploadAll) {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Upload: ${current.target.siteName} @ ${current.target.environmentName}`, cancellable: true }, async (_progress, token) => {
                    progress = _progress;
                    const cancellation = token.onCancellationRequested(() => { this.uploadOutput.write('Upload All canceled.'); void this.pauseUpload(); });
                    try { if (token.isCancellationRequested) throw new UploadCanceled(); await session.uploadAll(); }
                    finally { progress = undefined; cancellation.dispose(); }
                });
                if (generation === this.uploadGeneration) vscode.window.showInformationMessage(`Upload complete: ${cartridges.length} cartridges. Watching for changes.`);
            } else { this.uploadOutput.write('Watching files. Initial upload disabled.'); vscode.window.showInformationMessage(`Watching ${cartridges.length} cartridges for changes. No initial upload was performed.`); }
        } catch (error) {
            if (generation !== this.uploadGeneration) return;
            this.uploadSession?.dispose(); this.uploadSession = undefined; this.uploadEnabled = false;
            this.uploadStatus = error instanceof UploadCanceled ? 'Off' : 'Failed';
            if (!(error instanceof UploadCanceled)) { const message = error instanceof Error ? error.message : 'Cannot enable upload.'; this.uploadOutput.error(message); vscode.window.showErrorMessage(message); }
            else this.uploadOutput.write('Upload canceled. Upload remains Off.');
        } finally {
            if (generation === this.uploadGeneration) { this.uploadStarting = false; if (!this.uploadEnabled && this.uploadStatus === 'Starting') this.uploadStatus = 'Off'; this.emit(); }
        }
    }
    private clearPending(canceled = false): void {
        if (canceled && this.pendingDebug) this.canceledDebugRuns.add(this.pendingDebug.runId);
        if (this.pendingDebug?.timer) clearTimeout(this.pendingDebug.timer);
        this.pendingDebug = undefined; this.emit();
    }
    async beforeDebug(target: ActivityTarget, fingerprint: string, runId: string = randomUUID()): Promise<boolean> {
        if (this.pendingDebug) return false;
        if ([...this.debugRecords.values()].some(row => (row.observedHost ?? row.target?.hostname) === target.hostname)) {
            vscode.window.showWarningMessage('A Prophet debug session already uses this hostname. Stop that activity before starting another; sessions on different hosts can run together.'); return false;
        }
        const currentBefore = this.current();
        if (this.enabled() && (!currentBefore.active || this.upload?.fingerprint !== uploadFingerprint(currentBefore.active))) await this.pauseUpload();
        await vscode.workspace.getConfiguration().update('extension.prophet.sitecontext.selectedSiteID', 'dw.json', vscode.ConfigurationTarget.Workspace);
        const pending = { target, fingerprint, runId };
        this.pendingDebug = pending; this.emit();
        await new Promise(resolve => setTimeout(resolve, 1500));
        const current = this.current();
        if (this.pendingDebug !== pending || !current.active || connectionFingerprint(current.active) !== fingerprint || current.target?.siteId !== target.siteId) { if (this.pendingDebug === pending) this.clearPending(); return false; }
        this.pendingDebug.timer = setTimeout(() => {
            for (const row of this.debugRecords.values()) if (row.session.id === this.pendingDebug?.sessionId && !row.verified) void vscode.debug.stopDebugging(row.session);
            this.clearPending(true); vscode.window.showWarningMessage('Debug target initialization timed out. Retry the Site action.');
        }, 30000);
        return true;
    }
    debugLaunchFinished(started: boolean): void { if (!started) this.clearPending(); }
    private debugStarted(session: vscode.DebugSession): void {
        if (session.type !== 'prophet' || this.debugRecords.has(session.id)) return;
        if (this.pendingDebug && !this.pendingDebug.sessionId && session.configuration.__dwManagerFingerprint === this.pendingDebug.fingerprint && session.configuration.__dwManagerTarget?.siteId === this.pendingDebug.target.siteId) this.pendingDebug.sessionId = session.id;
        const canceled = this.canceledDebugRuns.has(session.configuration.__dwManagerRunId);
        this.debugRecords.set(session.id, { session, target: session.configuration.__dwManagerTarget, status: canceled ? 'Canceled — stopping' : 'Starting — target unverified', verified: false });
        if (canceled) void vscode.debug.stopDebugging(session); this.emit();
    }
    private taskStarted(execution: vscode.TaskExecution): void {
        const definition = execution.task.definition;
        if (definition.type !== 'dw-manager-repos' || !definition.runId) return;
        this.taskRecords.set(definition.runId, { execution, status: 'Running', stopped: false }); this.emit();
    }
    private taskEnded(execution: vscode.TaskExecution, code?: number): void {
        const row = this.taskRecords.get(execution.task.definition.runId); if (!row || !['Running', 'Stopping'].includes(row.status)) return;
        row.status = row.stopped || code === 130 || code === 143 ? 'Stopped' : code === 0 ? 'OK' : code === undefined ? 'Stopped' : 'FAIL'; this.emit();
    }
    private repoItems(row: TaskRecord): ActivityItem[] {
        const definition = row.execution.task.definition;
        try {
            const state = JSON.parse(fs.readFileSync(path.join(definition.rootDir, '.dw-update-log.json'), 'utf8'));
            return Object.entries(state.repos).filter(([, entry]: [string, any]) => entry.run_id === definition.runId).map(([name, entry]: [string, any]) => {
                const item = new ActivityItem('repo', name);
                const steps = entry.activity_steps;
                const status = (value: string | undefined) => value === 'running' && !['Running', 'Stopping'].includes(row.status) ? 'interrupted' : value;
                item.description = `Git: ${status(steps?.git ?? entry.sync_status) ?? '—'} | Install: ${status(steps?.install ?? entry.install_status) ?? '—'} | Compile: ${status(steps?.compile ?? entry.build_status) ?? '—'}`;
                item.tooltip = `${name}\nBranch: ${entry.branch ?? '—'}\n${item.description}`; return item;
            });
        } catch { return []; }
    }
    getParent(item: ActivityItem): ActivityItem | undefined { return item.parent; }
    getTreeItem(item: ActivityItem): vscode.TreeItem { return item; }
    getChildren(parent?: ActivityItem): ActivityItem[] {
        if (parent?.kind === 'task') { const row = this.taskRecords.get(parent.key); return row ? this.repoItems(row).map(item => { item.parent = parent; return item; }) : []; }
        if (parent) return [];
        const upload = this.uploadItem;
        upload.contextValue = this.enabled() || this.uploadStarting ? 'activityUploadOn' : 'activityUploadOff';
        const target = this.upload?.target;
        upload.description = `${this.uploadStarting ? 'Starting' : this.uploadStatus}${target ? ` — ${target.siteName} @ ${target.environmentName}` : ''}`;
        upload.tooltip = `DW Manager uploader. Scope: ${(this.uploadScope ?? this.upload?.cartridges)?.join(', ') ?? 'Site cartridges'}. Watching sends only changes; Upload All overwrites local files without removing extra remote cartridges. Stop cannot undo requests already sent.${this.uploadMissing.length ? ` Skipped locally: ${this.uploadMissing.join(', ')}.` : ''}`;
        upload.command = { command: 'dw-manager.showUploadOutput', title: 'Show Upload Output' };
        upload.iconPath = new vscode.ThemeIcon('cloud-upload');
        const items = [upload];
        if (this.pendingDebug) { const item = new ActivityItem('pending', `Debug starting: ${this.pendingDebug.target.siteName} @ ${this.pendingDebug.target.environmentName}`); item.contextValue = 'activityPending'; item.iconPath = new vscode.ThemeIcon('loading~spin'); items.push(item); }
        for (const [id, row] of this.debugRecords) {
            const item = new ActivityItem('debug', row.target ? `Debug: ${row.target.siteName} @ ${row.target.environmentName}` : row.session.name, id);
            item.description = row.status; item.contextValue = 'activityDebugRunning';
            item.iconPath = new vscode.ThemeIcon('debug-alt'); items.push(item);
        }
        for (const [id, row] of this.taskRecords) {
            const item = new ActivityItem('task', row.execution.task.name, id, true);
            item.description = row.status; item.contextValue = ['Running', 'Stopping'].includes(row.status) ? 'activityTaskRunning' : 'activityTaskStopped';
            item.iconPath = new vscode.ThemeIcon('tools'); items.push(item);
        }
        return items;
    }
    async stop(item: ActivityItem): Promise<void> {
        if (item.kind === 'upload') await this.pauseUpload();
        else if (item.kind === 'pending') { const session = this.pendingDebug?.sessionId && this.debugRecords.get(this.pendingDebug.sessionId)?.session; if (this.pendingDebug) this.canceledDebugRuns.add(this.pendingDebug.runId); if (session) await vscode.debug.stopDebugging(session); this.clearPending(true); }
        else if (item.kind === 'debug') { const row = this.debugRecords.get(item.key); if (row) await vscode.debug.stopDebugging(row.session); }
        else if (item.kind === 'task') { const row = this.taskRecords.get(item.key); if (row) { row.stopped = true; row.status = 'Stopping'; row.execution.terminate(); this.emit(); } }
    }
    async start(item?: ActivityItem): Promise<void> {
        if (!item || item.kind === 'upload') { await this.enableUpload(this.upload?.target.siteId, this.upload?.target, { cartridges: this.upload?.cartridges }); return; }
        if (item.kind === 'debug') {
            const target = this.debugRecords.get(item.key)?.target; if (!target) return;
            await this.manager.run(async () => {
                await this.manager.select('environment', target.environmentId);
                if (this.manager.store?.environmentId !== target.environmentId) return;
                await startDebugging(this.manager, { kind: 'site', id: target.siteId } as any, { beforeLaunch: (t, f, runId) => this.beforeDebug(t, f, runId), launchFinished: ok => this.debugLaunchFinished(ok) });
            });
        }
        if (item.kind === 'task') {
            const row = this.taskRecords.get(item.key); if (row) await vscode.commands.executeCommand(`dw-manager.repos.${row.execution.task.definition.action}`, { id: row.execution.task.definition.siteId });
        }
    }
    clearFinished(): void {
        for (const [id, row] of this.taskRecords) if (!['Running', 'Stopping'].includes(row.status)) this.taskRecords.delete(id);
        this.emit();
    }
    dispose(): void { this.uploadSession?.dispose(); this.uploadOutput.dispose(); clearInterval(this.timer); this.clearPending(); this.subscriptions.forEach(item => item.dispose()); this.emitter.dispose(); }
}
