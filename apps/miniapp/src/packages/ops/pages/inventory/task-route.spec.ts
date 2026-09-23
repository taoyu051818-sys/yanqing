import { describe, expect, it } from 'vitest';
import { parseInventoryTask, inventoryTaskUrl } from './task-route';
describe('inventory task navigation', () => {
 it('leaves the list alone without a task and rejects unknown task types', () => {
   expect(parseInventoryTask({ view:'MASTER' })).toBeNull();
   expect(() => parseInventoryTask({ form:'delete' })).toThrow('入口无效');
   expect(() => parseInventoryTask({ form:'__proto__' })).toThrow('入口无效');
   expect(() => parseInventoryTask({ form:'movement', movementType:'UNKNOWN' })).toThrow('类型无效');
 });
 it('preserves an exact stock batch or source record across navigation', () => {
   const query = new URLSearchParams(inventoryTaskUrl('movement', { itemId:'item 1', balanceId:'batch&2', movementType:'LOSS' }).split('?')[1]);
   expect(parseInventoryTask(Object.fromEntries(query))).toMatchObject({ form:'movement', itemId:'item 1', balanceId:'batch&2', movementType:'LOSS' });
   expect(parseInventoryTask({ form:'master', masterType:'SUPPLIER', source:'supplier-2' })).toMatchObject({ masterType:'SUPPLIER', source:'supplier-2' });
 });
});
