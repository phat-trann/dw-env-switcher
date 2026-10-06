import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const mock = vi.hoisted(() => ({ enabled: false, running: false, concurrency: 0, status: null as any, uploadAll: vi.fn(), trackerFactory: null as any, starts: [] as any[], ends: [] as any[], debugEnds: [] as any[], executeCommand: vi.fn(), stopDebugging: vi.fn(), update: vi.fn() }));
vi.mock('vscode', () => ({
 TreeItem: class { constructor(public label: string, public collapsibleState: number) {} }, ThemeIcon: class { constructor(public id: string) {} },
 TreeItemCollapsibleState: { None: 0, Collapsed: 1 }, ConfigurationTarget: { Workspace: 2 },
 EventEmitter: class { event = () => ({dispose(){}}); fire(){} dispose(){} },
 workspace: { workspaceFolders: [] as any[], onDidChangeConfiguration: () => ({dispose(){}}), getConfiguration: () => ({ get: () => mock.enabled, update: mock.update }) },
 ProgressLocation: { Notification: 15 },
 window: { withProgress: async (_options:any,callback:any)=>callback({}, {isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})}), showErrorMessage: vi.fn(), showWarningMessage: vi.fn(), showInformationMessage: vi.fn(), showQuickPick: vi.fn() },
 extensions: { getExtension: () => ({ isActive: true }) },
 commands: { getCommands: async () => ['extension.prophet.command.disable.upload', 'extension.prophet.command.enable.upload'], executeCommand: mock.executeCommand },
 debug: { onDidStartDebugSession: () => ({dispose(){}}), onDidTerminateDebugSession: (cb:any) => {mock.debugEnds.push(cb);return{dispose(){}};},
 registerDebugAdapterTrackerFactory: (_type:string, factory:any) => {mock.trackerFactory=factory;return{dispose(){}};}, stopDebugging: mock.stopDebugging },
 tasks: { taskExecutions: [], onDidStartTask: (cb:any)=>{mock.starts.push(cb);return{dispose(){}};},onDidEndTaskProcess:(cb:any)=>{mock.ends.push(cb);return{dispose(){}};},onDidEndTask:()=>({dispose(){}}) }
}));
vi.mock('../../src/upload/output',()=>({UploadOutput:class {setTarget(){} write(){} warning(){} error(){} show(){} dispose(){}}}));
vi.mock('../../src/upload/session', async importOriginal => { const original=await importOriginal<any>(); return {
 uploadCartridgeNames: original.uploadCartridgeNames,
 resolveUploadCartridges: vi.fn(async (_root: string, names: string[]) => names.map(name => ({name,root:'/local/'+name}))),
 UploadSession: class { constructor(...args:any[]){mock.running=true;mock.concurrency=args[5];mock.status=args[2];} dispose(){mock.running=false;} async uploadAll(){await mock.uploadAll();} }
}; });
import { Activities } from '../../src/activity/manager';
import { activityTarget, connectionFingerprint, uploadFingerprint } from '../../src/activity/target';
import { ConfigStore } from '../../src/config/store';
import * as vscode from 'vscode';
import { resolveUploadCartridges } from '../../src/upload/session';
let root:string, store:ConfigStore, activity:Activities, manager:any;
beforeEach(()=>{
 vi.useFakeTimers();vi.clearAllMocks();mock.uploadAll.mockReset();mock.enabled=false;mock.running=false;mock.starts.length=0;mock.ends.length=0;mock.debugEnds.length=0;
 root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-activities-'));(vscode.workspace as any).workspaceFolders=[{uri:{fsPath:root}}];
 store=new ConfigStore(root);store.config={schemaVersion:2,environments:[{id:'e',name:'Dev',hostname:'dev.invalid',username:'user',password:'placeholder',version:'v1'},{id:'e2',name:'QA',hostname:'qa.invalid',username:'user',password:'placeholder',version:'v1'}],sites:[{id:'s',name:'Store',cartridgesPath:'app'},{id:'s2',name:'Other',cartridgesPath:'other'}]};store.save();store.select('environment','e');store.select('site','s');
 mock.executeCommand.mockImplementation(async (command:string) => { if(command==='extension.prophet.command.enable.upload')mock.running=true; if(command==='extension.prophet.command.disable.upload')mock.running=false; });
 mock.update.mockImplementation(async(key:string,value:any)=>{if(key==='extension.prophet.upload.enabled')mock.enabled=value;});
 manager={store,run:async(action:any)=>action(),select:async(kind:string,id:string)=>{if((kind==='site'?store.siteId:store.environmentId)!==id && !await activity.beforeActiveChange())return;store.select(kind,id);}};
 activity=new Activities({workspaceState:{get:()=>undefined,update:vi.fn(async()=>{})}} as any,manager);
});
afterEach(()=>{activity.dispose();vi.useRealTimers();fs.rmSync(root,{recursive:true,force:true});});
async function enable(site='s'){const pending=activity.enableUpload(site);await vi.advanceTimersByTimeAsync(1500);await pending;}
describe('Activities and shared Prophet target protection',()=>{
 it('binds upload to the clicked Site, stops before managed target changes and retains resume target',async()=>{
  await enable('s2');expect(store.siteId).toBe('s2');expect(mock.running).toBe(true);expect(mock.enabled).toBe(false);
  expect(activity.getChildren()[0].description).toContain('Other @ Dev');
  await activity.beforeActiveChange();expect(mock.running).toBe(false);expect(mock.enabled).toBe(false);expect(mock.executeCommand).toHaveBeenCalledWith('extension.prophet.command.disable.upload');
  store.select('environment','e2');expect(activity.getChildren()[0].description).toContain('Off — Other @ Dev');
 });
 it('adds modules to default scope/picker without modifying Site or dw.json and preserves subset choice',async()=>{
  const savedPath=store.config.sites[0].cartridgesPath;
  await enable();expect(resolveUploadCartridges).toHaveBeenLastCalledWith(root,['app','modules'],expect.any(Function),expect.any(Function));
  expect(store.config.sites[0].cartridgesPath).toBe(savedPath);expect(JSON.parse(fs.readFileSync(path.join(root,'dw.json'),'utf8')).cartridgesPath).toBe('app');
  (vscode.window.showQuickPick as any).mockResolvedValueOnce([{label:'modules'}]);
  await activity.enableUpload('s',undefined,{chooseCartridges:true});
  expect(resolveUploadCartridges).toHaveBeenLastCalledWith(root,['modules'],expect.any(Function),expect.any(Function));
  await activity.pauseUpload();await activity.start(activity.getChildren()[0]);expect(resolveUploadCartridges).toHaveBeenLastCalledWith(root,['modules'],expect.any(Function),expect.any(Function));
 });
 it('uses global upload concurrency for every Site and defaults to five',async()=>{
  await enable();expect(mock.concurrency).toBe(5);
  store.config.upload={concurrency:8};store.save();
  await enable('s2');expect(mock.concurrency).toBe(8);
  await enable('s');expect(mock.concurrency).toBe(8);
 });
 it('watch-only never invokes a full upload or native Prophet enable',async()=>{
  await enable();expect(mock.uploadAll).not.toHaveBeenCalled();expect(mock.executeCommand).not.toHaveBeenCalledWith('extension.prophet.command.enable.upload');
  expect(activity.getChildren()[0].description).toContain('Watching');
 });
 it('uploads all only when explicitly requested and stops on failure',async()=>{
  mock.uploadAll.mockRejectedValueOnce(new Error('HTTP 401'));
  await activity.enableUpload('s',undefined,{uploadAll:true});
  expect(mock.uploadAll).toHaveBeenCalledOnce();expect(mock.running).toBe(false);expect(activity.getChildren()[0].description).toContain('Failed');
 });
 it('includes both Site and Environment in Upload All loading',async()=>{
  const progress=vi.spyOn(vscode.window,'withProgress');
  await activity.enableUpload('s',undefined,{uploadAll:true});
  expect(progress.mock.calls.at(-1)?.[0].title).toBe('Upload: Store @ Dev');
 });
 it('reports cartridge counts in the Upload All notification',async()=>{
  const reporter={report:vi.fn()};
  vi.spyOn(vscode.window,'withProgress').mockImplementationOnce(async (_options:any,callback:any)=>callback(reporter,{isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})}));
  // Session mock emits a real engine-style status when Upload All starts.
  mock.uploadAll.mockImplementationOnce(async()=>{mock.status({state:'uploading',completed:10,total:100,cartridgesCompleted:1,cartridgesTotal:2});});
  await activity.enableUpload('s',undefined,{uploadAll:true});
  expect(reporter.report).toHaveBeenCalledWith({message:'1/2 cartridges',increment:50});
 });
 it('canceling Upload All progress stops the batch watcher and leaves Off',async()=>{
  let finish: (()=>void) | undefined;
  mock.uploadAll.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  vi.spyOn(vscode.window,'withProgress').mockImplementationOnce(async (_options:any,callback:any)=>callback({}, {
   isCancellationRequested:false,
   onCancellationRequested(cb:any){queueMicrotask(()=>{cb();finish?.();});return{dispose(){}};}
  }));
  await activity.enableUpload('s',undefined,{uploadAll:true});
  expect(mock.running).toBe(false);expect(activity.getChildren()[0].description).toContain('Off');
 });
 it('canceling cartridge selection leaves upload Off',async()=>{
  (vscode.window.showQuickPick as any).mockResolvedValueOnce(undefined);
  await activity.enableUpload('s',undefined,{chooseCartridges:true});expect(mock.running).toBe(false);expect(activity.getChildren()[0].description).toBe('Off');
 });
 it('binds only chosen Site cartridges and reuses that scope for manual resume',async()=>{
  store.config.sites[0].cartridgesPath='app:other';store.save();store.select('site','s');
  (vscode.window.showQuickPick as any).mockResolvedValueOnce([{label:'other'}]);
  await activity.enableUpload('s',undefined,{chooseCartridges:true});
  expect(resolveUploadCartridges).toHaveBeenLastCalledWith(root,['other'],expect.any(Function),expect.any(Function));expect(activity.getChildren()[0].tooltip).toContain('other');
  await activity.pauseUpload();await activity.start(activity.getChildren()[0]);expect(resolveUploadCartridges).toHaveBeenLastCalledWith(root,['other'],expect.any(Function),expect.any(Function));
 });
 it('invalid cartridge resolution still fails closed',async()=>{
  (resolveUploadCartridges as any).mockRejectedValueOnce(new Error('Missing local root'));
  await activity.enableUpload('s');expect(mock.running).toBe(false);expect(activity.getChildren()[0].description).toContain('Failed');
 });
 it('warns for a missing cartridge while starting available cartridges',async()=>{
  (resolveUploadCartridges as any).mockImplementationOnce(async (_root:string,_names:string[],missing:any)=>{missing('absent');return[{name:'app',root:'/local/app'}];});
  await activity.enableUpload('s');expect(mock.running).toBe(true);expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Skipping missing local cartridges'));
  expect(activity.getChildren()[0].description).toContain('Watching');expect(activity.getChildren()[0].tooltip).toContain('Skipped locally: absent');
 });
 it('warns for duplicate roots and keeps upload enabled on the retained root',async()=>{
  (resolveUploadCartridges as any).mockImplementationOnce(async (_root:string,_names:string[],_missing:any,duplicate:any)=>{
   duplicate({name:'app',kept:'/local/app',skipped:['/legacy/app']});return[{name:'app',root:'/local/app'}];
  });
  await enable();expect(mock.running).toBe(true);expect(activity.getChildren()[0].description).toContain('Watching');
  expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('/legacy/app'));
  expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
 });
 it('stays Off with a warning when no cartridges exist locally',async()=>{
  (resolveUploadCartridges as any).mockImplementationOnce(async (_root:string,_names:string[],missing:any)=>{missing('app');return[];});
  await activity.enableUpload('s',undefined,{uploadAll:true});expect(mock.running).toBe(false);expect(mock.uploadAll).not.toHaveBeenCalled();
  expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('upload remains Off'));expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  expect(activity.getChildren()[0].description).toBe('Off');
 });
 it('stops upload after external dw.json target changes and does not silently re-enable it',async()=>{
  await enable();const active=store.readActive()!;active.hostname='changed.invalid';fs.writeFileSync(store.activePath,JSON.stringify(active));
  await activity.refresh();expect(mock.running).toBe(false);expect(mock.enabled).toBe(false);expect(mock.update).toHaveBeenLastCalledWith('extension.prophet.upload.enabled',false,2);
 });
 it('cancels a pending upload start and handles canceled Site choice without enabling',async()=>{
  const pending=activity.enableUpload('s');await vi.advanceTimersByTimeAsync(10);await activity.pauseUpload();await vi.advanceTimersByTimeAsync(1500);await pending;expect(mock.enabled).toBe(false);
  (vscode.window.showQuickPick as any).mockResolvedValue(undefined);await activity.enableUpload();expect(mock.enabled).toBe(false);
 });
 it('allows upload and debug for the same pair, blocks switching during initialization, and confirms adapter target',async()=>{
  await enable();const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  const pending=activity.beforeDebug(target,connectionFingerprint(active));await vi.advanceTimersByTimeAsync(1500);expect(await pending).toBe(true);expect(mock.running).toBe(true);expect(mock.enabled).toBe(false);
  expect(await activity.beforeActiveChange()).toBe(false);expect(mock.running).toBe(true);expect(mock.enabled).toBe(false);
  const session={id:'debug',type:'prophet',name:'Debug',configuration:{__dwManagerTarget:target,__dwManagerFingerprint:connectionFingerprint(active)}};
  const tracker=mock.trackerFactory.createDebugAdapterTracker(session);tracker.onWillReceiveMessage({command:'DebuggerConfig',arguments:{config:active}});tracker.onDidSendMessage({type:'event',event:'initialized'});
  expect(activity.getChildren().find(row=>row.kind==='debug')!.description).toBe('Running');
  expect(await activity.beforeActiveChange()).toBe(true);expect(mock.running).toBe(false);expect(mock.enabled).toBe(false);
 });
 it('stops a debugger when Prophet reports a different connection target',()=>{
  const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  const session={id:'wrong',type:'prophet',name:'Debug',configuration:{__dwManagerTarget:target,__dwManagerFingerprint:connectionFingerprint(active)}};
  const tracker=mock.trackerFactory.createDebugAdapterTracker(session);tracker.onWillReceiveMessage({command:'DebuggerConfig',arguments:{config:{...active,hostname:'wrong.invalid'}}});
  expect(mock.stopDebugging).toHaveBeenCalledWith(session);expect(activity.getChildren().find(row=>row.kind==='debug')!.description).toContain('Target mismatch');
 });
 it('shows per-repo install/compile phase and stops or reruns a captured Site task',async()=>{
  const execution={task:{name:'Compile: Store',definition:{type:'dw-manager-repos',siteId:'s',siteName:'Store',action:'compile',runId:'run',rootDir:root}},terminate:vi.fn()};
  mock.starts[0]({execution});fs.writeFileSync(path.join(root,'.dw-update-log.json'),JSON.stringify({repos:{repo:{run_id:'run',branch:'master',sync_status:'ok',install_status:'running',build_status:'skipped'},old:{run_id:'old'}}}));
  const row=activity.getChildren().find(row=>row.kind==='task')!;expect(activity.getChildren(row)).toHaveLength(1);expect(activity.getChildren(row)[0].description).toContain('Install: running');
  await activity.stop(row);expect(execution.terminate).toHaveBeenCalled();mock.ends[0]({execution,exitCode:143});expect(activity.getChildren().find(row=>row.kind==='task')!.description).toBe('Stopped');
  await activity.start(row);expect(mock.executeCommand).toHaveBeenCalledWith('dw-manager.repos.compile',{id:'s'});
  activity.clearFinished();expect(activity.getChildren().some(row=>row.kind==='task')).toBe(false);
 });
 it('removes stopped debug rows across repeated launches and releases the hostname guard',async()=>{
  const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  for(let index=0;index<5;index++){
   const session={id:'repeat-'+index,type:'prophet',name:'Debug: Store',configuration:{__dwManagerTarget:target,__dwManagerFingerprint:connectionFingerprint(active)}};
   const tracker=mock.trackerFactory.createDebugAdapterTracker(session);tracker.onDidSendMessage({type:'event',event:'initialized'});
   expect(activity.getChildren().filter(row=>row.kind==='debug')).toHaveLength(1);
   mock.debugEnds[0](session);expect(activity.getChildren().filter(row=>row.kind==='debug')).toHaveLength(0);
  }
  const pending=activity.beforeDebug(target,connectionFingerprint(active));await vi.advanceTimersByTimeAsync(1500);expect(await pending).toBe(true);
 });
 it('removes only the terminated session and retains another running debugger',()=>{
  const first={id:'first',type:'prophet',name:'First',configuration:{}};
  const second={id:'second',type:'prophet',name:'Second',configuration:{}};
  mock.trackerFactory.createDebugAdapterTracker(first);mock.trackerFactory.createDebugAdapterTracker(second);
  mock.debugEnds[0](first);expect(activity.getChildren().filter(row=>row.kind==='debug').map(row=>row.key)).toEqual(['second']);
  mock.debugEnds[0](first);expect(activity.getChildren().filter(row=>row.kind==='debug').map(row=>row.key)).toEqual(['second']);
 });
 it('termination of an old session does not unlock a newer pending debugger',async()=>{
  const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  const old={id:'old',type:'prophet',name:'Old',configuration:{}};mock.trackerFactory.createDebugAdapterTracker(old);
  const pending=activity.beforeDebug(target,connectionFingerprint(active));await vi.advanceTimersByTimeAsync(1500);expect(await pending).toBe(true);
  const newer={id:'new',type:'prophet',name:'New',configuration:{__dwManagerTarget:target,__dwManagerFingerprint:connectionFingerprint(active)}};mock.trackerFactory.createDebugAdapterTracker(newer);
  mock.debugEnds[0](old);expect(await activity.beforeActiveChange()).toBe(false);
  const pendingRow=activity.getChildren().find(row=>row.kind==='pending')!;await activity.stop(pendingRow);expect(mock.stopDebugging).toHaveBeenCalledWith(newer);expect(await activity.beforeActiveChange()).toBe(true);
 });
 it('stops a debug session that arrives after its pending start was canceled',async()=>{
  const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  const pending=activity.beforeDebug(target,connectionFingerprint(active),'late-run');await vi.advanceTimersByTimeAsync(1500);expect(await pending).toBe(true);
  await activity.stop(activity.getChildren().find(row=>row.kind==='pending')!);
  const session={id:'late',type:'prophet',name:'Late',configuration:{__dwManagerTarget:target,__dwManagerFingerprint:connectionFingerprint(active),__dwManagerRunId:'late-run'}};mock.trackerFactory.createDebugAdapterTracker(session);
  expect(mock.stopDebugging).toHaveBeenCalledWith(session);expect(activity.getChildren().find(row=>row.kind==='debug')!.description).toContain('Canceled');
 });
 it('blocks another observed debugger on the same hostname',async()=>{
  const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  mock.trackerFactory.createDebugAdapterTracker({id:'existing',type:'prophet',name:'Existing',configuration:{__dwManagerTarget:target,__dwManagerFingerprint:connectionFingerprint(active)}});
  expect(await activity.beforeDebug(target,connectionFingerprint(active))).toBe(false);
 });
 it('allows another session on a different hostname',async()=>{
  const active=store.readActive()!;const target=activityTarget(store.config,active)!;
  mock.trackerFactory.createDebugAdapterTracker({id:'existing',type:'prophet',name:'Existing',configuration:{__dwManagerTarget:{...target,hostname:'other.invalid'},__dwManagerFingerprint:'other'}});
  const pending=activity.beforeDebug(target,connectionFingerprint(active));await vi.advanceTimersByTimeAsync(1500);expect(await pending).toBe(true);
 });
 it('resets a legacy true flag and matching saved binding to Off at startup without enabling',async()=>{
  activity.dispose();const active=store.readActive()!;const binding={target:activityTarget(store.config,active)!,fingerprint:uploadFingerprint(active)};
  mock.enabled=true;mock.running=true;
  activity=new Activities({workspaceState:{get:()=>binding,update:vi.fn(async()=>{})}} as any,manager);
  await activity.resetUploadOnStartup();
  expect(mock.enabled).toBe(false);expect(mock.running).toBe(false);expect(mock.executeCommand).not.toHaveBeenCalledWith('extension.prophet.command.enable.upload');
  expect(activity.getChildren()[0].description).toBe('Off — Store @ Dev');
 });
 it('manual enable never persists true, so a reopened session starts Off',async()=>{
  await enable();expect(mock.running).toBe(true);expect(mock.update.mock.calls.filter(call=>call[0]==='extension.prophet.upload.enabled').every(call=>call[1]===false)).toBe(true);
  activity.dispose();mock.running=false;activity=new Activities({workspaceState:{get:()=>undefined,update:vi.fn(async()=>{})}} as any,manager);
  await activity.resetUploadOnStartup();expect(activity.getChildren()[0].description).toBe('Off');expect(mock.running).toBe(false);
 });
 it('fails closed when uploader is enabled without a verified binding',async()=>{mock.enabled=true;await activity.refresh();expect(mock.running).toBe(false);expect(mock.enabled).toBe(false);});
});
