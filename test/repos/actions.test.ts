import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const mock = vi.hoisted(() => ({ ends: [] as any[], executeTask: vi.fn(), showWarningMessage: vi.fn(), showInformationMessage: vi.fn(), showTextDocument: vi.fn() }));
vi.mock('vscode', () => ({
 Uri: { file: (fsPath: string) => ({ fsPath }) },
 Task: class { presentationOptions: any; constructor(public definition: any, public scope: any, public name: string, public source: string, public execution: any) {} },
 ProcessExecution: class { constructor(public process: string, public args: string[], public options: any) {} },
 TaskRevealKind: { Always: 1 }, TaskPanelKind: { Dedicated: 1 },
 workspace: { workspaceFolders: [] as any[], openTextDocument: vi.fn(async (input: any) => input) },
 tasks: { executeTask: mock.executeTask, onDidEndTaskProcess: vi.fn((callback: any) => { mock.ends.push(callback); return { dispose() {} }; }), onDidEndTask: vi.fn(() => ({ dispose() {} })) },
 window: { showQuickPick: vi.fn(), showTextDocument: mock.showTextDocument, showWarningMessage: mock.showWarningMessage, showInformationMessage: mock.showInformationMessage, showErrorMessage: vi.fn() }
}));
import * as vscode from 'vscode';
import { runRepoAction } from '../../src/repos/actions';
let root: string;
const context = { asAbsolutePath: (name: string) => path.resolve(name) } as any;
beforeEach(() => {
 vi.clearAllMocks(); mock.ends.length=0;
 root=fs.mkdtempSync(path.join(os.tmpdir(), 'dw-repo-actions-'));
 (vscode.workspace as any).workspaceFolders=[{ uri: { fsPath: root } }];
 fs.mkdirSync(path.join(root,'repo/cartridges/app_site'),{recursive:true});fs.mkdirSync(path.join(root,'repo/.git'));
 fs.writeFileSync(path.join(root,'dw-manager.json'),JSON.stringify({schemaVersion:2,environments:[{id:'e',name:'Env',hostname:'private.invalid',username:'private-user',password:'private-password',version:'v1'}],sites:[{id:'chosen',name:'Chosen',cartridgesPath:'app_site',repoTools:{nodeVersion:'18.20.8'}},{id:'active',name:'Active',cartridgesPath:'other'}],repoTools:{gitJobs:3}}));
 fs.writeFileSync(path.join(root,'dw.json'),'{malformed-active-file');
 mock.executeTask.mockImplementation(async(task:any)=>({task,terminate(){}}));
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
describe('Site repository actions are independent of active dw.json',()=>{
 it('previews the clicked Site and its overrides with no writes or task execution',async()=>{
  const before=fs.readFileSync(path.join(root,'dw-manager.json'),'utf8');
  await runRepoAction(context,'preview','chosen');
  const doc=mock.showTextDocument.mock.calls[0][0];expect(doc.content).toContain('Site: Chosen');expect(doc.content).toContain('Node: 18.20.8');expect(doc.content).toContain('repo |');
  expect(mock.executeTask).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(root,'dw-manager.json'),'utf8')).toBe(before);expect(fs.readFileSync(path.join(root,'dw.json'),'utf8')).toBe('{malformed-active-file');
 });
 it('passes only Site and settings in a credential-free task snapshot; cleans it on success',async()=>{
  await runRepoAction(context,'compile','chosen');
  const task=mock.executeTask.mock.calls[0][0];const execution=await mock.executeTask.mock.results[0].value;
  expect(task.execution.process).toBe('bash');const snapshot=task.execution.args[2];const raw=fs.readFileSync(snapshot,'utf8');
  expect(raw).not.toContain('private-');expect(raw).not.toContain('environments');expect(JSON.parse(raw)).toMatchObject({site:{id:'chosen',cartridgesPath:'app_site'},repoTools:{nodeVersion:'18.20.8',gitJobs:3}});
  mock.ends[0]({execution,exitCode:0});expect(fs.existsSync(snapshot)).toBe(false);expect(mock.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('OK'));
  expect(fs.readFileSync(path.join(root,'dw.json'),'utf8')).toBe('{malformed-active-file');
 });
 it('canceled destructive confirmation performs no task or writes',async()=>{
  mock.showWarningMessage.mockResolvedValue(undefined);await runRepoAction(context,'git','chosen');
  expect(mock.showWarningMessage.mock.calls[0][0]).toContain('repo');expect(mock.executeTask).not.toHaveBeenCalled();
 });
 it('configure preserves Sites and dw.json while adding defaults',async()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'dw-manager.json'),'utf8'));delete config.repoTools;fs.writeFileSync(path.join(root,'dw-manager.json'),JSON.stringify(config));
  await runRepoAction(context,'configure','chosen');const after=JSON.parse(fs.readFileSync(path.join(root,'dw-manager.json'),'utf8'));
  expect(after.sites).toEqual(config.sites);expect(after.repoTools.nodeVersion).toBe('8.17.0');expect(fs.readFileSync(path.join(root,'dw.json'),'utf8')).toBe('{malformed-active-file');
 });
});
