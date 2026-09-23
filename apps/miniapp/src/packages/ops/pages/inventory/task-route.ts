import type { MasterType, MovementType, Tab, UsageType } from './page-types';
export type InventoryTask = 'purchase' | 'stocktake' | 'movement' | 'master' | 'usage';
export const taskTabs: Record<InventoryTask, Tab> = { purchase: 'PURCHASE', stocktake: 'STOCKTAKE', movement: 'MOVEMENT', master: 'MASTER', usage: 'STOCK' };
export interface InventoryTaskRoute {
  form: InventoryTask; masterType: MasterType; movementType: MovementType; usageType: UsageType;
  source: string; itemId: string; balanceId: string;
}
export function parseInventoryTask(query: Record<string, unknown> = {}): InventoryTaskRoute | null {
  if (!query.form) return null;
  if (typeof query.form !== 'string' || !Object.prototype.hasOwnProperty.call(taskTabs, query.form)) throw new Error('作业入口无效，请返回库存列表重新打开。');
  const text = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const choice = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = text(key);
    if (value && !values.includes(value as T)) throw new Error('作业类型无效，请返回列表重新打开。');
    return (value || fallback) as T;
  };
  return { form: query.form as InventoryTask, masterType: choice('masterType', ['ITEM', 'SUPPLIER', 'LOCATION'], 'ITEM'), movementType: choice('movementType', ['TRANSFER', 'LOSS'], 'TRANSFER'), usageType: choice('usageType', ['TRAINING_USAGE', 'EVENT_USAGE'], 'TRAINING_USAGE'), source: text('source'), itemId: text('itemId'), balanceId: text('balanceId') };
}
export function inventoryTaskUrl(form: InventoryTask, context: Record<string, string> = {}): string {
  return '/packages/ops/pages/inventory/index?' + Object.entries({ ...context, form }).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}
