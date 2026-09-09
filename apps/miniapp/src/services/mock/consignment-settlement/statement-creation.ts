import { mockUser } from "../core";
import {
  getConsignmentPayableEntries,
  getConsignmentSettlements,
  getInventorySuppliers,
  saveConsignmentSettlements,
} from "../state";
import {
  type JsonRecord,
  clone,
  text,
  newId,
  requireSettlementRole,
  requireReason,
  requireIdempotencyKey,
  requirePeriod,
  actorSnapshot,
  requireConsignmentRule,
  appendAudit,
} from "./command-policy.js";
import { activeClaimedEntryIds, settlementView } from "./queries.js";

export const entryTotals = (entries: JsonRecord[]) =>
  entries.reduce(
    (totals, entry) => ({
      entryCount: totals.entryCount + 1,
      netQuantity: totals.netQuantity + Number(entry.quantity || 0),
      grossSaleCents: totals.grossSaleCents + Number(entry.grossSaleCents || 0),
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

export const createSettlement = (data: JsonRecord) => {
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
