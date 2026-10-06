import { afterEach, describe, expect, it, vi } from 'vitest';
import { retryUploadOperation, UploadHttpError } from '../../src/upload/retry';
import { UploadCanceled, UploadRequestError } from '../../src/upload/client';
afterEach(()=>vi.useRealTimers());
describe('upload retry',()=>{
 it('uses three retries with 4/6/8s backoff then preserves the original network error',async()=>{
  vi.useFakeTimers();const error=new UploadRequestError('PUT',['temp.zip'],'ECONNRESET');const action=vi.fn(async()=>{throw error;});const notify=vi.fn();
  const pending=retryUploadOperation(action,new AbortController().signal,notify);const rejected=expect(pending).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(3999);expect(action).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(action).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(6000);expect(action).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(8000);await rejected;expect(action).toHaveBeenCalledTimes(4);expect(notify).toHaveBeenCalledTimes(3);
 });
 it('recovers transient HTTP failures and does not retry permission or certificate errors',async()=>{
  vi.useFakeTimers();const action=vi.fn().mockRejectedValueOnce(new UploadHttpError('HTTP 503',503)).mockResolvedValue(undefined);
  const pending=retryUploadOperation(action,new AbortController().signal,vi.fn());await vi.advanceTimersByTimeAsync(4000);await pending;expect(action).toHaveBeenCalledTimes(2);
  for(const error of [new UploadHttpError('HTTP 401',401),new UploadHttpError('HTTP 403',403),new UploadRequestError('PUT',['zip'],'CERT_HAS_EXPIRED')]) {
   const denied=vi.fn(async()=>{throw error;});await expect(retryUploadOperation(denied,new AbortController().signal,vi.fn())).rejects.toBe(error);expect(denied).toHaveBeenCalledOnce();
  }
 });
 it('cancels during backoff without sending another request',async()=>{
  vi.useFakeTimers();const controller=new AbortController();const action=vi.fn(async()=>{throw new UploadRequestError('PUT',['zip'],'ETIMEDOUT');});
  const pending=retryUploadOperation(action,controller.signal,vi.fn());const rejected=expect(pending).rejects.toBeInstanceOf(UploadCanceled);
  await vi.advanceTimersByTimeAsync(1);controller.abort();await rejected;await vi.advanceTimersByTimeAsync(30000);expect(action).toHaveBeenCalledOnce();
 });
});
