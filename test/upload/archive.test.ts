import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createUploadArchive } from '../../src/upload/archive';
import { UploadCanceled } from '../../src/upload/client';
const unzipper = require('unzipper');
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'dw-archive-test-'));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
describe('disk-backed upload ZIP',()=>{
 it('preserves binary bytes and cartridge-relative entry names and cleans local ZIP',async()=>{
  const filename=path.join(root,'file');const bytes=Buffer.from([0,255,128]);fs.writeFileSync(filename,bytes);
  const zip=await createUploadArchive([{filename,name:'app/cartridge/image.png'}],new AbortController().signal);
  const opened=await unzipper.Open.file(zip.filename);expect(opened.files.map((file:any)=>file.path)).toEqual(['app/cartridge/image.png']);
  expect(await opened.files[0].buffer()).toEqual(bytes);zip.dispose();expect(fs.existsSync(zip.filename)).toBe(false);
 });
 it('rejects missing source files instead of silently dropping them',async()=>{
  await expect(createUploadArchive([{filename:path.join(root,'missing'),name:'app/cartridge/x'}],new AbortController().signal)).rejects.toThrow('Cannot create upload ZIP');
 });
 it('cancels before or during archive creation',async()=>{
  const canceled=new AbortController();canceled.abort();await expect(createUploadArchive([],canceled.signal)).rejects.toBeInstanceOf(UploadCanceled);
  const filename=path.join(root,'file');fs.writeFileSync(filename,Buffer.alloc(1024*1024));
  const controller=new AbortController();const promise=createUploadArchive([{filename,name:'app/cartridge/x'}],controller.signal);
  const rejection=expect(promise).rejects.toBeInstanceOf(UploadCanceled);controller.abort();await rejection;
 });
});
