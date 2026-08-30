import type { AppRole } from "../../types/domain";
import { mockUser } from "./core";
import {
  getAuditLogs,
  getConsignmentPayableEntries,
  getConsignmentSettlements,
  getGoods,
  getInventorySuppliers,
  getInventoryTransactions,
  saveAuditLogs,
  saveConsignmentPayableEntries,
  saveConsignmentSettlements,
} from "./state";

type JsonRecord = Record<string, any>;

export type MockConsignmentRouteResult =
  | { handled: false }
  | { handled: true; value: unknown };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const text = (value: unknown) => String(value ?? "").trim();
const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const currentRoles = (): AppRole[] =>
  mockUser().roles.map((role: any) =>
    typeof role === "string" ? role : role.role,
  );

const requireSettlementRole = () => {
  if (
    !currentRoles().some((role) =>
      (["FINANCE", "ADMIN", "SUPER_ADMIN"] as AppRole[]).includes(role),
    )
  ) {
    throw new Error("仅财务或管理员可操作寄售应付与结算");
  }
};

const requireReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 2 || reason.length > 300)
    throw new Error("操作原因长度必须为2-300个字符");
  return reason;
};

const requireIdempotencyKey = (value: unknown) => {
  const idempotencyKey = text(value);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100)
    throw new Error("幂等键长度必须为8-100个字符");
  return idempotencyKey;
};

const requirePeriod = (startValue: unknown, endValue: unknown) => {
  const periodStart = new Date(String(startValue || ""));
  const periodEnd = new Date(String(endValue || ""));
  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodEnd <= periodStart
  ) {
    throw new Error("寄售结算周期无效");
  }
  if (periodEnd.getTime() - periodStart.getTime() > 366 * 86_400_000)
    throw new Error("单张寄售结算单周期不能超过366天");
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
};

const optionalPeriod = (startValue: unknown, endValue: unknown) => {
  if (!startValue && !endValue) return null;
  if (!startValue || !endValue)
    throw new Error("查询周期开始和结束时间必须同时填写");
  return requirePeriod(startValue, endValue);
};

const actorSnapshot = () => ({
  id: mockUser().id,
  displayName: mockUser().displayName,
});

const supplierSummary = (supplier: JsonRecord) => ({
  id: supplier.id,
  code: supplier.code,
  name: supplier.name,
});

const itemSummary = (item: JsonRecord) => ({
  id: item.id,
  sku: item.sku,
  name: item.name,
});

const requireConsignmentRule = (supplier: JsonRecord) => {
  const settlementCycle = text(supplier.settlementRule?.settlementCycle);
  const commissionRateBps = Number(
    supplier.settlementRule?.commissionRateBps,
  );
  if (!['PER_ORDER', 'WEEKLY', 'MONTHLY'].includes(settlementCycle))
    throw new Error("寄售供应商未配置有效结算周期");
  if (
    !Number.isInteger(commissionRateBps) ||
    commissionRateBps < 0 ||
    commissionRateBps > 10_000
  ) {
    throw new Error("寄售供应商未配置有效场馆佣金基点");
  }
  return { settlementCycle, commissionRateBps };
};

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

const readMockConsignmentOrderSnapshot = (value: unknown) => {
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
  if (!['PER_ORDER', 'WEEKLY', 'MONTHLY'].includes(settlementCycle))
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

const appendAudit = (
  action: string,
  objectType: string,
  objectId: string,
  reason: string,
  requestId: string,
  oldValue: unknown,
  newValue: unknown,
) => {
  const now = new Date().toISOString();
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: mockUser().id,
      actor: actorSnapshot(),
      actorRole: currentRoles()[0],
      action,
      objectType,
      objectId,
      reason,
      requestId,
      oldValue,
      newValue,
      result: "SUCCESS",
      createdAt: now,
    },
    ...getAuditLogs(),
  ]);
};

/**
 * Mirrors the API's post-fulfilment hook. The caller invokes this only after
 * all SALE_OUT rows are durable; owned inventory is intentionally skipped.
 */
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

/** Appends exact negative rows for every original consignment sale entry. */
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
    const existing = entries.find(
      (entry) => entry.reversalOfId === sale.id,
    );
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

const activeClaimedEntryIds = (settlements: JsonRecord[]) =>
  new Set(
    settlements.flatMap((settlement) =>
      (settlement.lines || [])
        .filter((line: JsonRecord) => !line.releasedAt)
        .map((line: JsonRecord) => line.payableEntryId),
    ),
  );

const basePayableView = (entry: JsonRecord) => ({
  ...entry,
  supplier:
    entry.supplier ||
    supplierSummary(
      getInventorySuppliers().find(
        (supplier) => supplier.id === entry.supplierId,
      ) || {},
    ),
  item:
    entry.item ||
    itemSummary(getGoods().find((item) => item.id === entry.itemId) || {}),
});

const payableView = (entry: JsonRecord, settlements: JsonRecord[]) => ({
  ...basePayableView(entry),
  settlementLines: settlements.flatMap((settlement) =>
    (settlement.lines || [])
      .filter((line: JsonRecord) => line.payableEntryId === entry.id)
      .map((line: JsonRecord) => ({
        ...line,
        settlement: {
          id: settlement.id,
          statementNo: settlement.statementNo,
          status: settlement.status,
        },
      })),
  ),
});

const settlementView = (settlement: JsonRecord, detail = false) => {
  const supplier =
    settlement.supplier ||
    getInventorySuppliers().find(
      (candidate) => candidate.id === settlement.supplierId,
    );
  if (!detail) return { ...settlement, supplier: supplierSummary(supplier || {}) };
  const entries = getConsignmentPayableEntries();
  return {
    ...settlement,
    supplier: supplier || null,
    lines: (settlement.lines || []).map((line: JsonRecord) => ({
      ...line,
      payableEntry: basePayableView(
        entries.find((entry) => entry.id === line.payableEntryId) || {},
      ),
    })),
  };
};

const entryTotals = (entries: JsonRecord[]) =>
  entries.reduce(
    (totals, entry) => ({
      entryCount: totals.entryCount + 1,
      netQuantity: totals.netQuantity + Number(entry.quantity || 0),
      grossSaleCents:
        totals.grossSaleCents + Number(entry.grossSaleCents || 0),
      commissionCents:
        totals.commissionCents + Number(entry.commissionCents || 0),
      payableCents: totals.payableCents + Number(entry.payableCents || 0),
    }),
    {
      entryCount: 0,
      netQuantity: 0,
      grossSaleCents: 0,
      commissionCents: 0,
      payableCents: 0,
    },
  );

const assertStatementSnapshotCurrent = (
  settlement: JsonRecord,
  settlements: JsonRecord[],
) => {
  const entries = getConsignmentPayableEntries();
  const lines = (settlement.lines || []).filter(
    (line: JsonRecord) => !line.releasedAt,
  );
  const lineTotals = entryTotals(lines);
  if (
    lineTotals.entryCount !== Number(settlement.entryCount) ||
    lineTotals.netQuantity !== Number(settlement.netQuantity) ||
    lineTotals.grossSaleCents !== Number(settlement.grossSaleCents) ||
    lineTotals.commissionCents !== Number(settlement.commissionCents) ||
    lineTotals.payableCents !== Number(settlement.payableCents)
  ) {
    throw new Error("寄售结算单明细与冻结汇总不一致，请联系管理员");
  }
  const claimed = activeClaimedEntryIds(settlements);
  const unclaimed = entries.some(
    (entry) =>
      entry.supplierId === settlement.supplierId &&
      entry.occurredAt >= settlement.periodStart &&
      entry.occurredAt < settlement.periodEnd &&
      !claimed.has(entry.id),
  );
  if (unclaimed)
    throw new Error("账期新增寄售应付或退款冲正，请作废并重建结算单");
};

const createSettlement = (data: JsonRecord) => {
  requireSettlementRole();
  const reason = requireReason(data.reason);
  const idempotencyKey = requireIdempotencyKey(data.idempotencyKey);
  const period = requirePeriod(data.periodStart, data.periodEnd);
  const supplierId = text(data.supplierId);
  const commandHash = JSON.stringify({
    action: "CREATED",
    supplierId,
    ...period,
    reason,
  });
  const settlements = getConsignmentSettlements();
  const replay = settlements.find(
    (settlement) => settlement.creationIdempotencyKey === idempotencyKey,
  );
  if (replay) {
    if (
      replay.createdById !== mockUser().id ||
      replay.creationCommandHash !== commandHash
    ) {
      throw new Error("寄售结算创建幂等键已用于其他操作人或命令");
    }
    return settlementView(replay, true);
  }
  const supplier = getInventorySuppliers().find(
    (candidate) => candidate.id === supplierId,
  );
  if (!supplier) throw new Error("寄售供应商不存在");
  if (supplier.type !== "CONSIGNMENT")
    throw new Error("自营采购供应商不能生成寄售结算单");
  const rule = requireConsignmentRule(supplier);
  if (
    settlements.some(
      (settlement) =>
        settlement.supplierId === supplier.id &&
        settlement.periodStart === period.periodStart &&
        settlement.periodEnd === period.periodEnd &&
        settlement.status !== "VOID",
    )
  ) {
    throw new Error("该供应商账期已有未作废结算单");
  }
  const claimed = activeClaimedEntryIds(settlements);
  const entries = getConsignmentPayableEntries()
    .filter(
      (entry) =>
        entry.supplierId === supplier.id &&
        entry.occurredAt >= period.periodStart &&
        entry.occurredAt < period.periodEnd &&
        !claimed.has(entry.id),
    )
    .sort(
      (left, right) =>
        String(left.occurredAt).localeCompare(String(right.occurredAt)) ||
        String(left.createdAt).localeCompare(String(right.createdAt)),
    );
  if (!entries.length) throw new Error("该供应商账期没有待结寄售应付明细");
  if (entries.length > 10_000)
    throw new Error("单张结算单最多包含10000条明细，请拆分账期");
  const version =
    Math.max(
      0,
      ...settlements
        .filter(
          (settlement) =>
            settlement.supplierId === supplier.id &&
            settlement.periodStart === period.periodStart &&
            settlement.periodEnd === period.periodEnd,
        )
        .map((settlement) => Number(settlement.version || 0)),
    ) + 1;
  const totals = entryTotals(entries);
  const now = new Date().toISOString();
  const actor = actorSnapshot();
  const settlementId = newId("consignment-settlement");
  const transition = {
    id: newId("consignment-transition"),
    settlementId,
    action: "CREATED",
    fromStatus: null,
    toStatus: "DRAFT",
    reason,
    actorId: actor.id,
    actor,
    idempotencyKey,
    commandHash,
    createdAt: now,
  };
  const settlement = {
    id: settlementId,
    statementNo: `CS${now.replace(/\D/g, "").slice(0, 14)}${String(version).padStart(2, "0")}`,
    supplierId: supplier.id,
    supplier: clone(supplier),
    ...period,
    version,
    status: "DRAFT",
    ...totals,
    ruleSnapshot: {
      supplierCode: supplier.code,
      supplierName: supplier.name,
      settlementCycle: rule.settlementCycle,
      commissionRateBps: rule.commissionRateBps,
      commissionMeaning: "VENUE_COMMISSION",
    },
    creationReason: reason,
    creationIdempotencyKey: idempotencyKey,
    creationCommandHash: commandHash,
    createdById: actor.id,
    createdBy: actor,
    submittedById: null,
    submittedBy: null,
    confirmedById: null,
    confirmedBy: null,
    settledById: null,
    settledBy: null,
    voidedById: null,
    voidedBy: null,
    submittedAt: null,
    confirmedAt: null,
    settledAt: null,
    voidedAt: null,
    paymentReference: null,
    lines: entries.map((entry) => ({
      id: newId("consignment-line"),
      settlementId,
      payableEntryId: entry.id,
      quantity: Number(entry.quantity),
      grossSaleCents: Number(entry.grossSaleCents),
      commissionCents: Number(entry.commissionCents),
      payableCents: Number(entry.payableCents),
      releasedAt: null,
      createdAt: now,
    })),
    transitions: [transition],
    createdAt: now,
    updatedAt: now,
  };
  saveConsignmentSettlements([settlement, ...settlements]);
  appendAudit(
    "CONSIGNMENT_SETTLEMENT_CREATED",
    "ConsignmentSettlement",
    settlement.id,
    reason,
    idempotencyKey,
    null,
    { supplierId: supplier.id, ...period, version, ...totals },
  );
  return settlementView(settlement, true);
};

const transitionSettlement = (
  settlementId: string,
  actionName: string,
  data: JsonRecord,
) => {
  requireSettlementRole();
  const reason = requireReason(data.reason);
  const idempotencyKey = requireIdempotencyKey(data.idempotencyKey);
  const definitions: Record<
    string,
    { action: string; from: string; to: string }
  > = {
    submit: { action: "SUBMITTED", from: "DRAFT", to: "PENDING_CONFIRMATION" },
    confirm: {
      action: "CONFIRMED",
      from: "PENDING_CONFIRMATION",
      to: "CONFIRMED",
    },
    dispute: {
      action: "DISPUTED",
      from: "PENDING_CONFIRMATION",
      to: "DRAFT",
    },
    return: { action: "RETURNED", from: "CONFIRMED", to: "DRAFT" },
    settle: { action: "SETTLED", from: "CONFIRMED", to: "SETTLED" },
    void: { action: "VOIDED", from: "DRAFT", to: "VOID" },
  };
  const definition = definitions[actionName];
  if (!definition) throw new Error("寄售结算动作无效");
  const paymentReference =
    actionName === "settle" ? text(data.paymentReference) : "";
  if (
    actionName === "settle" &&
    (paymentReference.length < 2 || paymentReference.length > 120)
  ) {
    throw new Error("结算付款凭证长度必须为2-120个字符");
  }
  const commandHash = JSON.stringify({
    action: definition.action,
    settlementId,
    fromStatus: definition.from,
    toStatus: definition.to,
    reason,
    paymentReference: paymentReference || undefined,
  });
  const settlements = getConsignmentSettlements();
  const replay = settlements
    .flatMap((settlement) => settlement.transitions || [])
    .find((transition) => transition.idempotencyKey === idempotencyKey);
  if (replay) {
    if (
      replay.settlementId !== settlementId ||
      replay.actorId !== mockUser().id ||
      replay.action !== definition.action ||
      replay.commandHash !== commandHash
    ) {
      throw new Error("寄售结算动作幂等键已用于其他操作人或命令");
    }
    const replayedSettlement = settlements.find(
      (settlement) => settlement.id === settlementId,
    );
    if (!replayedSettlement) throw new Error("寄售结算单不存在");
    return settlementView(replayedSettlement, true);
  }
  const settlement = settlements.find((candidate) => candidate.id === settlementId);
  if (!settlement) throw new Error("寄售结算单不存在");
  if (settlement.status !== definition.from)
    throw new Error(
      `寄售结算单当前状态为 ${settlement.status}，不能执行 ${definition.action}`,
    );
  if (
    ["confirm", "dispute", "return", "settle"].includes(actionName) &&
    settlement.createdById === mockUser().id
  ) {
    throw new Error("制单人不能确认、争议、退回或结算自己的寄售结算单");
  }
  if (["submit", "confirm", "settle"].includes(actionName))
    assertStatementSnapshotCurrent(settlement, settlements);

  const now = new Date().toISOString();
  const actor = actorSnapshot();
  const oldStatus = settlement.status;
  settlement.status = definition.to;
  settlement.updatedAt = now;
  if (actionName === "submit") {
    settlement.submittedById = actor.id;
    settlement.submittedBy = actor;
    settlement.submittedAt = now;
  } else if (actionName === "confirm") {
    settlement.confirmedById = actor.id;
    settlement.confirmedBy = actor;
    settlement.confirmedAt = now;
  } else if (["dispute", "return"].includes(actionName)) {
    settlement.submittedById = null;
    settlement.submittedBy = null;
    settlement.submittedAt = null;
    settlement.confirmedById = null;
    settlement.confirmedBy = null;
    settlement.confirmedAt = null;
    settlement.settledById = null;
    settlement.settledBy = null;
    settlement.settledAt = null;
    settlement.paymentReference = null;
  } else if (actionName === "settle") {
    settlement.settledById = actor.id;
    settlement.settledBy = actor;
    settlement.settledAt = now;
    settlement.paymentReference = paymentReference;
  } else if (actionName === "void") {
    settlement.voidedById = actor.id;
    settlement.voidedBy = actor;
    settlement.voidedAt = now;
    for (const line of settlement.lines || []) line.releasedAt = now;
  }
  settlement.transitions = [
    ...(settlement.transitions || []),
    {
      id: newId("consignment-transition"),
      settlementId,
      action: definition.action,
      fromStatus: definition.from,
      toStatus: definition.to,
      reason,
      actorId: actor.id,
      actor,
      idempotencyKey,
      commandHash,
      createdAt: now,
    },
  ];
  saveConsignmentSettlements(settlements);
  appendAudit(
    `CONSIGNMENT_SETTLEMENT_${definition.action}`,
    "ConsignmentSettlement",
    settlement.id,
    reason,
    idempotencyKey,
    { status: oldStatus },
    {
      status: settlement.status,
      ...(paymentReference ? { paymentReference } : {}),
    },
  );
  return settlementView(settlement, true);
};

export function routeMockConsignmentSettlement(
  method: string,
  url: string,
  data: JsonRecord = {},
): MockConsignmentRouteResult {
  if (url === "/inventory/consignment/payables" && method === "GET") {
    requireSettlementRole();
    const period = optionalPeriod(data.periodStart, data.periodEnd);
    const settlements = getConsignmentSettlements();
    const filtered = getConsignmentPayableEntries()
      .filter(
        (entry) =>
          (!data.supplierId || entry.supplierId === text(data.supplierId)) &&
          (!data.type || entry.type === text(data.type)) &&
          (!period ||
            (entry.occurredAt >= period.periodStart &&
              entry.occurredAt < period.periodEnd)),
      )
      .sort(
        (left, right) =>
          String(right.occurredAt).localeCompare(String(left.occurredAt)) ||
          String(right.createdAt).localeCompare(String(left.createdAt)),
      );
    const page = Math.max(1, Number(data.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(data.pageSize) || 50));
    const start = (page - 1) * pageSize;
    return {
      handled: true,
      value: {
        items: filtered
          .slice(start, start + pageSize)
          .map((entry) => payableView(entry, settlements)),
        total: filtered.length,
        page,
        pageSize,
      },
    };
  }
  if (url === "/inventory/consignment/settlements" && method === "GET") {
    requireSettlementRole();
    const period = optionalPeriod(data.periodStart, data.periodEnd);
    const filtered = getConsignmentSettlements()
      .filter(
        (settlement) =>
          (!data.supplierId ||
            settlement.supplierId === text(data.supplierId)) &&
          (!data.status || settlement.status === text(data.status)) &&
          (!period ||
            (settlement.periodStart >= period.periodStart &&
              settlement.periodEnd <= period.periodEnd)),
      )
      .sort(
        (left, right) =>
          String(right.periodEnd).localeCompare(String(left.periodEnd)) ||
          Number(right.version) - Number(left.version),
      );
    const page = Math.max(1, Number(data.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(data.pageSize) || 30));
    const start = (page - 1) * pageSize;
    return {
      handled: true,
      value: {
        items: filtered
          .slice(start, start + pageSize)
          .map((settlement) => settlementView(settlement)),
        total: filtered.length,
        page,
        pageSize,
      },
    };
  }
  if (url === "/inventory/consignment/settlements" && method === "POST") {
    return { handled: true, value: createSettlement(data) };
  }
  const detailMatch = url.match(
    /^\/inventory\/consignment\/settlements\/([^/]+)$/,
  );
  if (detailMatch && method === "GET") {
    requireSettlementRole();
    const settlement = getConsignmentSettlements().find(
      (candidate) => candidate.id === detailMatch[1],
    );
    if (!settlement) throw new Error("寄售结算单不存在");
    return { handled: true, value: settlementView(settlement, true) };
  }
  const actionMatch = url.match(
    /^\/inventory\/consignment\/settlements\/([^/]+)\/(submit|confirm|dispute|return|settle|void)$/,
  );
  if (actionMatch && method === "POST") {
    return {
      handled: true,
      value: transitionSettlement(actionMatch[1], actionMatch[2], data),
    };
  }
  return { handled: false };
}

export function mockConsignmentSettlementWorkItems(): JsonRecord[] {
  if (
    !currentRoles().some((role) =>
      (["FINANCE", "ADMIN", "SUPER_ADMIN"] as AppRole[]).includes(role),
    )
  ) {
    return [];
  }
  return getConsignmentSettlements()
    .filter(
      (settlement) =>
        settlement.status === "DRAFT" ||
        (["PENDING_CONFIRMATION", "CONFIRMED"].includes(settlement.status) &&
          settlement.createdById !== mockUser().id),
    )
    .sort(
      (left, right) =>
        String(left.periodEnd).localeCompare(String(right.periodEnd)) ||
        String(left.createdAt).localeCompare(String(right.createdAt)),
    )
    .map((settlement) => ({
      id: `consignment-settlement:${settlement.id}`,
      kind: "CONSIGNMENT_SETTLEMENT",
      objectType: "ConsignmentSettlement",
      objectId: settlement.id,
      status: settlement.status,
      priority: 78,
      title:
        settlement.status === "DRAFT"
          ? `寄售结算草稿待提交 · ${settlement.supplier?.name || "寄售供应商"}`
          : settlement.status === "PENDING_CONFIRMATION"
            ? `寄售结算待复核 · ${settlement.supplier?.name || "寄售供应商"}`
            : `寄售结算待付款 · ${settlement.supplier?.name || "寄售供应商"}`,
      description: `${settlement.statementNo} · ${settlement.entryCount} 条明细 · 应付 ¥${(Number(settlement.payableCents || 0) / 100).toFixed(2)}`,
      ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
      createdAt: settlement.createdAt,
      dueAt: settlement.periodEnd,
      amountCents: settlement.payableCents,
      action: `/packages/ops/pages/finance/index?focus=consignment-settlement&id=${settlement.id}`,
      metadata: {
        statementNo: settlement.statementNo,
        supplierId: settlement.supplierId,
        supplierCode: settlement.supplier?.code,
        createdById: settlement.createdById,
        entryCount: settlement.entryCount,
      },
    }));
}

export function mockConsignmentReconciliationTotals(date?: string) {
  const dayStart = date
    ? new Date(`${date}T00:00:00+08:00`).getTime()
    : Number.NEGATIVE_INFINITY;
  const dayEnd = date ? dayStart + 86_400_000 : Number.POSITIVE_INFINITY;
  const inDay = (value: unknown) => {
    const time = new Date(String(value || "")).getTime();
    return Number.isFinite(time) && time >= dayStart && time < dayEnd;
  };
  const payableCents = getConsignmentPayableEntries()
    .filter((entry) => inDay(entry.occurredAt))
    .reduce(
    (sum, entry) => sum + Number(entry.payableCents || 0),
    0,
  );
  const settledPayableCents = getConsignmentSettlements()
    .filter(
      (settlement) =>
        settlement.status === "SETTLED" && inDay(settlement.settledAt),
    )
    .reduce(
      (sum, settlement) => sum + Number(settlement.payableCents || 0),
      0,
    );
  return {
    consignmentPayableCents: payableCents,
    consignmentSettledPayableCents: settledPayableCents,
  };
}
