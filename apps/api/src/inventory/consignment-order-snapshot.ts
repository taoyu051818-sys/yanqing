import {
  InventoryMode,
  Prisma,
  SupplierType,
} from '../generated/prisma/client.js';

export const GOODS_INVENTORY_SNAPSHOT_VERSION = 1;

export interface ConsignmentOrderSnapshot {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  sku: string;
  settlementCycle: 'PER_ORDER' | 'WEEKLY' | 'MONTHLY';
  commissionRateBps: number;
}

export class ConsignmentOrderSnapshotError extends Error {}

type OrderableInventoryItem = {
  sku: string;
  mode: InventoryMode;
  supplier: string;
  supplierId: string | null;
  supplierRecord: {
    id: string;
    code: string;
    name: string;
    type: SupplierType;
    settlementRule: Prisma.JsonValue | null;
  } | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const requireRule = (value: unknown) => {
  const rule = asRecord(value);
  const settlementCycle = String(rule.settlementCycle ?? '');
  const commissionRateBps = Number(rule.commissionRateBps);
  if (!['PER_ORDER', 'WEEKLY', 'MONTHLY'].includes(settlementCycle))
    throw new ConsignmentOrderSnapshotError(
      '寄售供应商未配置有效结算周期，不能创建商品订单',
    );
  if (
    !Number.isInteger(commissionRateBps) ||
    commissionRateBps < 0 ||
    commissionRateBps > 10_000
  ) {
    throw new ConsignmentOrderSnapshotError(
      '寄售供应商未配置有效场馆佣金基点，不能创建商品订单',
    );
  }
  return {
    settlementCycle: settlementCycle as ConsignmentOrderSnapshot['settlementCycle'],
    commissionRateBps,
  };
};

/**
 * Freezes every mutable inventory/supplier fact needed by later fulfilment.
 * The returned JSON is the economic contract for this order line.
 */
export function buildGoodsOrderItemSnapshot(item: OrderableInventoryItem) {
  const supplier = item.supplierRecord;
  const base = {
    inventorySnapshotVersion: GOODS_INVENTORY_SNAPSHOT_VERSION,
    sku: item.sku,
    mode: item.mode,
    supplier: supplier?.name || item.supplier,
    supplierId: supplier?.id || item.supplierId || null,
    supplierCode: supplier?.code || null,
    supplierName: supplier?.name || item.supplier,
  };
  if (item.mode !== InventoryMode.CONSIGNMENT) return base;
  if (!supplier || supplier.type !== SupplierType.CONSIGNMENT)
    throw new ConsignmentOrderSnapshotError(
      '寄售商品缺少有效寄售供应商，不能创建商品订单',
    );
  const rule = requireRule(supplier.settlementRule);
  return {
    ...base,
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.name,
    settlementRule: rule,
  };
}

/**
 * Reads only the immutable order-line JSON. It deliberately never accepts a
 * current InventoryItem/Supplier fallback because that would rewrite history.
 */
export function readConsignmentOrderSnapshot(
  value: Prisma.JsonValue | null,
): ConsignmentOrderSnapshot | null {
  const snapshot = asRecord(value);
  if (String(snapshot.mode ?? '') !== InventoryMode.CONSIGNMENT) return null;
  if (
    Number(snapshot.inventorySnapshotVersion) !==
    GOODS_INVENTORY_SNAPSHOT_VERSION
  ) {
    throw new ConsignmentOrderSnapshotError(
      '寄售订单缺少下单时结算快照，属于cutover前交易，禁止按当前主数据推算应付',
    );
  }
  const supplierId = String(snapshot.supplierId ?? '').trim();
  const supplierCode = String(snapshot.supplierCode ?? '').trim();
  const supplierName = String(snapshot.supplierName ?? '').trim();
  const sku = String(snapshot.sku ?? '').trim();
  if (!supplierId || !supplierCode || !supplierName || !sku)
    throw new ConsignmentOrderSnapshotError(
      '寄售订单的供应商或SKU快照不完整，禁止按当前主数据推算应付',
    );
  const rule = requireRule(snapshot.settlementRule);
  return {
    supplierId,
    supplierCode,
    supplierName,
    sku,
    ...rule,
  };
}
