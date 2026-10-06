import { beforeEach, describe, it, expect, vi } from 'vitest';
const mock=vi.hoisted(()=>({prophet:{isActive:false,activate:vi.fn()},update:vi.fn(),executeCommand:vi.fn(),getCommands:vi.fn()}));
vi.mock('vscode',()=>({ConfigurationTarget:{Workspace:2},workspace:{workspaceFolders:[{uri:{fsPath:'/workspace'}}],getConfiguration:()=>({update:mock.update})},extensions:{getExtension:()=>mock.prophet},commands:{getCommands:mock.getCommands,executeCommand:mock.executeCommand}}));
import { stopProphetUpload } from '../../src/prophet';
beforeEach(()=>{vi.clearAllMocks();mock.prophet.isActive=false;mock.getCommands.mockResolvedValue(['extension.prophet.command.disable.upload']);});
describe('Keep native Prophet upload disabled',()=>{
 it('clears persisted flag without activating idle Prophet',async()=>{
  await stopProphetUpload();expect(mock.update).toHaveBeenCalledWith('extension.prophet.upload.enabled',false,2);
  expect(mock.prophet.activate).not.toHaveBeenCalled();expect(mock.executeCommand).not.toHaveBeenCalled();
 });
 it('stops the native subscription when Prophet is active',async()=>{
  mock.prophet.isActive=true;await stopProphetUpload();expect(mock.executeCommand).toHaveBeenCalledWith('extension.prophet.command.disable.upload');
 });
 it('tolerates a missing native command while keeping startup disabled',async()=>{
  mock.prophet.isActive=true;mock.getCommands.mockResolvedValue([]);await stopProphetUpload();expect(mock.executeCommand).not.toHaveBeenCalled();expect(mock.update).toHaveBeenCalledWith('extension.prophet.upload.enabled',false,2);
 });
});
