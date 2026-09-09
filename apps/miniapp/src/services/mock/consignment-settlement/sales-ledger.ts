import {
  getConsignmentPayableEntries,
  getInventorySuppliers,
  getInventoryTransactions,
  saveConsignmentPayableEntries,
} from "../state";
import {
  type JsonRecord,
  clone,
  text,
  newId,
  requireConsignmentRule,
  appendAudit,
} from "./command-policy.js";

export function buildMockGoodsOrderItemSnapshot(item: JsonRecord) {
  const supplier = getInventorySuppliers().find(
    (candidate) => candidate.id === item.supplierId,
  );
  const base = {
    inventorySnapshotVersion: 1,
    sku: item.sku,
    mode: item.mode,
    supplier: supplier?.name || item.supplier,
    supplierId: supplier?.id || item.supplierId || null,
    supplierCode: supplier?.code || null,
    supplierName: supplier?.name || item.supplier,
  };
  if (item.mode !== "CONSIGNMENT") return base;
  if (!supplier || supplier.type !== "CONSIGNMENT")
    throw new Error("寄售商品缺少有效寄售供应商，不能创建商品订单");
  const rule = requireConsignmentRule(supplier);
  return {
    ...base,
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.name,
    settlementRule: rule,
  };
}

export const readMockConsignmentOrderSnapshot = (value: unknown) => {
  const snapshot =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  if (text(snapshot.mode) !== "CONSIGNMENT") return null;
  if (Number(snapshot.inventorySnapshotVersion) !== 1)
    throw new Error(
      "寄售订单缺少下单时结算快照，属于cutover前交易，禁止按当前主数据推算应付",
    );
  const supplierId = text(snapshot.supplierId);
  const supplierCode = text(snapshot.supplierCode);
  const supplierName = text(snapshot.supplierName);
  const sku = text(snapshot.sku);
  if (!supplierId || !supplierCode || !supplierName || !sku)
    throw new Error(
      "寄售订单的供应商或SKU快照不完整，禁止按当前主数据推算应付",
    );
  const settlementRule = snapshot.settlementRule;
  const settlementCycle = text(settlementRule?.settlementCycle);
  const commissionRateBps = Number(settlementRule?.commissionRateBps);
  if (!["PER_ORDER", "WEEKLY", "MONTHLY"].includes(settlementCycle))
    throw new Error("寄售订单快照中的结算周期无效");
  if (
    !Number.isInteger(commissionRateBps) ||
    commissionRateBps < 0 ||
    commissionRateBps > 10_000
  ) {
    throw new Error("寄售订单快照中的场馆佣金基点无效");
  }
  return {
    supplierId,
    supplierCode,
    supplierName,
    sku,
    settlementCycle,
    commissionRateBps,
  };
};

export function recordMockConsignmentSale(order: JsonRecord): JsonRecord[] {
  if (order.businessType !== "GOODS") return [];
  if (!order.paidAt && !order.completedAt)
    throw new Error("商品订单尚未完成履约，不能生成寄售应付");

  const entries = getConsignmentPayableEntries();
  const inventoryTransactions = getInventoryTransactions();
  const completedAt = order.completedAt || order.paidAt;
  order.completedAt = completedAt;
  if (order.status === "PAID") order.status = "COMPLETED";
  if (order.status !== "COMPLETED")
    throw new Error("商品订单尚未完成履约，不能生成寄售应付");
  const created: JsonRecord[] = [];
  const newPayables: JsonRecord[] = [];

  for (const orderItem of order.items || []) {
    const snapshot = readMockConsignmentOrderSnapshot(orderItem.metadata);
    if (!snapshot) continue;
    const quantity = Number(orderItem.quantity || 0);
    const saleOut = inventoryTransactions.find(
      (entry) =>
        entry.type === "SALE_OUT" &&
        entry.orderItemId === orderItem.id &&
        Number(entry.quantity) === -quantity,
    );
    if (!saleOut) throw new Error(`商品 ${orderItem.name} 尚未完成销售出库`);
    const unitSalePriceCents = Number(orderItem.unitPriceCents || 0);
    const grossSaleCents = unitSalePriceCents * quantity;
    if (grossSaleCents !== Number(orderItem.amountCents || 0))
      throw new Error(`商品 ${orderItem.name} 的成交金额快照不一致`);
    if (grossSaleCents <= 0) continue;
    const commissionCents = Math.round(
      (grossSaleCents * snapshot.commissionRateBps) / 10_000,
    );
    const payableCents = grossSaleCents - commissionCents;
    const idempotencyKey = `CONSIGNMENT-SALE:${orderItem.id}`;
    const existing = entries.find(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (
        existing.orderId !== order.id ||
        existing.orderItemId !== orderItem.id ||
        existing.supplierId !== snapshot.supplierId ||
        Number(existing.payableCents) !== payableCents
      ) {
        throw new Error("寄售销售应付幂等记录与当前订单不一致");
      }
      created.push(existing);
      continue;
    }
    const payable = {
      id: newId("consignment-payable"),
      type: "SALE",
      supplierId: snapshot.supplierId,
      supplier: {
        id: snapshot.supplierId,
        code: snapshot.supplierCode,
        name: snapshot.supplierName,
      },
      itemId: orderItem.itemId,
      item: {
        id: orderItem.itemId,
        sku: snapshot.sku,
        name: orderItem.name,
      },
      orderId: order.id,
      orderItemId: orderItem.id,
      order: {
        id: order.id,
        orderNo: order.orderNo,
        completedAt,
      },
      refundId: null,
      refund: null,
      reversalOfId: null,
      quantity,
      unitSalePriceCents,
      grossSaleCents,
      commissionRateBps: snapshot.commissionRateBps,
      commissionCents,
      payableCents,
      ruleSnapshot: {
        supplierCode: snapshot.supplierCode,
        supplierName: snapshot.supplierName,
        sku: snapshot.sku,
        itemName: orderItem.name,
        settlementCycle: snapshot.settlementCycle,
        commissionRateBps: snapshot.commissionRateBps,
        commissionMeaning: "VENUE_COMMISSION",
      },
      occurredAt: completedAt,
      idempotencyKey,
      createdAt: completedAt,
    };
    entries.unshift(payable);
    created.push(payable);
    newPayables.push(payable);
  }
  if (newPayables.length) {
    saveConsignmentPayableEntries(entries);
  }
  for (const payable of newPayables) {
    appendAudit(
      "CONSIGNMENT_PAYABLE_SALE_RECORDED",
      "ConsignmentPayableEntry",
      payable.id,
      `商品订单 ${order.orderNo} 完成履约`,
      payable.idempotencyKey,
      null,
      {
        supplierId: payable.supplierId,
        itemId: payable.itemId,
        orderId: order.id,
        orderItemId: payable.orderItemId,
        quantity: payable.quantity,
        grossSaleCents: payable.grossSaleCents,
        commissionCents: payable.commissionCents,
        payableCents: payable.payableCents,
      },
    );
  }
  return clone(created);
}

export function recordMockConsignmentRefund(
  order: JsonRecord,
  refund: JsonRecord,
): JsonRecord[] {
  if (order.businessType !== "GOODS") return [];
  if (
    refund.status !== "SUCCEEDED" ||
    !refund.completedAt ||
    Number(order.refundedCents || 0) < Number(order.paidCents || 0)
  ) {
    throw new Error("仅成功的商品整单退款可反冲寄售应付");
  }
  const entries = getConsignmentPayableEntries();
  const sales = entries.filter(
    (entry) => entry.orderId === order.id && entry.type === "SALE",
  );
  const reversals: JsonRecord[] = [];
  const newReversals: JsonRecord[] = [];
  for (const sale of sales) {
    const existing = entries.find((entry) => entry.reversalOfId === sale.id);
    if (existing) {
      if (existing.refundId !== refund.id)
        throw new Error("寄售应付已由其他退款记录反冲");
      reversals.push(existing);
      continue;
    }
    const idempotencyKey = `CONSIGNMENT-REFUND:${refund.id}:${sale.id}`;
    const reversal = {
      id: newId("consignment-payable"),
      type: "REFUND_REVERSAL",
      supplierId: sale.supplierId,
      supplier: sale.supplier,
      itemId: sale.itemId,
      item: sale.item,
      orderId: sale.orderId,
      orderItemId: sale.orderItemId,
      order: sale.order,
      refundId: refund.id,
      refund: {
        id: refund.id,
        refundNo: refund.refundNo,
        completedAt: refund.completedAt,
      },
      reversalOfId: sale.id,
      quantity: -Number(sale.quantity),
      unitSalePriceCents: Number(sale.unitSalePriceCents),
      grossSaleCents: -Number(sale.grossSaleCents),
      commissionRateBps: Number(sale.commissionRateBps),
      commissionCents: -Number(sale.commissionCents),
      payableCents: -Number(sale.payableCents),
      ruleSnapshot: {
        ...(sale.ruleSnapshot || {}),
        reversalOfEntryId: sale.id,
        refundNo: refund.refundNo,
      },
      occurredAt: refund.completedAt,
      idempotencyKey,
      createdAt: refund.completedAt,
    };
    entries.unshift(reversal);
    reversals.push(reversal);
    newReversals.push(reversal);
  }
  if (newReversals.length) saveConsignmentPayableEntries(entries);
  for (const reversal of newReversals) {
    appendAudit(
      "CONSIGNMENT_PAYABLE_REFUND_REVERSED",
      "ConsignmentPayableEntry",
      reversal.id,
      text(refund.reason) || "商品整单退款",
      reversal.idempotencyKey,
      {
        saleEntryId: reversal.reversalOfId,
        payableCents: -Number(reversal.payableCents),
      },
      {
        refundId: refund.id,
        reversalOfId: reversal.reversalOfId,
        payableCents: reversal.payableCents,
      },
    );
  }
  return clone(reversals);
}
