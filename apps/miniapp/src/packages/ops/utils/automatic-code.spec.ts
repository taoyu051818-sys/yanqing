import { beforeEach, expect, it, vi } from 'vitest';
import { automaticCode } from './automatic-code';
import { withPendingCreationKey } from '../../../utils/pending-creation-key';
const storage = new Map<string, unknown>();
beforeEach(() => {
 storage.clear(); vi.stubGlobal('uni', { getStorageSync:(key:string) => storage.get(key), setStorageSync:(key:string, value:unknown) => storage.set(key,value), removeStorageSync:(key:string) => storage.delete(key) });
});
it('keeps an automatic business code after uncertain failure, and changes it for a new command', async () => {
 const codes:string[]=[];
 await expect(withPendingCreationKey('class', {name:'周末班'}, async key => { codes.push(automaticCode('CLS',key)); throw new Error('timeout'); })).rejects.toThrow('timeout');
 await withPendingCreationKey('class', {name:'周末班'}, async key => { codes.push(automaticCode('CLS',key)); });
 await withPendingCreationKey('class', {name:'进阶班'}, async key => { codes.push(automaticCode('CLS',key)); });
 expect(codes[0]).toBe(codes[1]); expect(codes[2]).not.toBe(codes[0]);
 for (const code of codes) { expect(code).toMatch(/^[A-Z0-9][A-Z0-9_-]{1,39}$/); }
});
