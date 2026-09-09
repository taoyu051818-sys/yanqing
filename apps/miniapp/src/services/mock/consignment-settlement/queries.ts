import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import {
  getConsignmentPayableEntries,
  getConsignmentSettlements,
  getGoods,
  getInventorySuppliers,
} from "../state";
import { type JsonRecord, text, currentRoles } from "./command-policy.js";

export const supplierSummary = (supplier: JsonRecord) => ({
  id: supplier.id,
  code: supplier.code,
  name: supplier.name,
});

export const itemSummary = (item: JsonRecord) => ({
  id: item.id,
  sku: item.sku,
  name: item.name,
});

export const activeClaimedEntryIds = (settlements: JsonRecord[]) =>
  new Set(
    settlements.flatMap((settlement) =>
      (settlement.lines || [])
        .filter((line: JsonRecord) => !line.releasedAt)
        .map((line: JsonRecord) => line.payableEntryId),
    ),
  );

export const readableRule = (snapshot: JsonRecord = {}) => ({
  supplierCode: text(snapshot.supplierCode),
  supplierName: text(snapshot.supplierName),
  settlementCycle: text(snapshot.settlementCycle),
  commissionRateBps: Number(snapshot.commissionRateBps || 0),
  commissionMeaning: text(snapshot.commissionMeaning) || "VENUE_COMMISSION",
});

export const basePayableView = (entry: JsonRecord) => ({
  id: entry.id,
  type: entry.type,
  quantity: entry.quantity,
  unitSalePriceCents: entry.unitSalePriceCents,
  grossSaleCents: entry.grossSaleCents,
  commissionRateBps: entry.commissionRateBps,
  commissionCents: entry.commissionCents,
  payableCents: entry.payableCents,
  occurredAt: entry.occurredAt,
  createdAt: entry.createdAt,
  businessRule: readableRule(entry.ruleSnapshot),
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
  order: entry.order
    ? {
        id: entry.order.id,
        orderNo: entry.order.orderNo,
        completedAt: entry.order.completedAt,
      }
    : entry.orderNo
      ? { orderNo: entry.orderNo, completedAt: entry.occurredAt }
      : null,
  refund: entry.refund
    ? {
        id: entry.refund.id,
        refundNo: entry.refund.refundNo,
        completedAt: entry.refund.completedAt,
      }
    : null,
});

export const payableView = (entry: JsonRecord, settlements: JsonRecord[]) => ({
  ...basePayableView(entry),
  settlementLines: settlements.flatMap((settlement) =>
    (settlement.lines || [])
      .filter((line: JsonRecord) => line.payableEntryId === entry.id)
      .map((line: JsonRecord) => ({
        id: line.id,
        quantity: line.quantity,
        grossSaleCents: line.grossSaleCents,
        commissionCents: line.commissionCents,
        payableCents: line.payableCents,
        releasedAt: line.releasedAt || null,
        createdAt: line.createdAt,
        settlement: {
          id: settlement.id,
          statementNo: settlement.statementNo,
          status: settlement.status,
        },
      })),
  ),
});

export const settlementView = (settlement: JsonRecord, detail = false) => {
  const supplier =
    settlement.supplier ||
    getInventorySuppliers().find(
      (candidate) => candidate.id === settlement.supplierId,
    );
  const safe = {
    id: settlement.id,
    statementNo: settlement.statementNo,
    supplier: supplierSummary(supplier || {}),
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    version: settlement.version,
    status: settlement.status,
    entryCount: settlement.entryCount,
    netQuantity: settlement.netQuantity,
    grossSaleCents: settlement.grossSaleCents,
    commissionCents: settlement.commissionCents,
    payableCents: settlement.payableCents,
    businessRule: readableRule(settlement.ruleSnapshot),
    creationReason: settlement.creationReason,
    submittedAt: settlement.submittedAt || null,
    confirmedAt: settlement.confirmedAt || null,
    settledAt: settlement.settledAt || null,
    voidedAt: settlement.voidedAt || null,
    paymentReference: settlement.paymentReference || null,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    isOwnCreator: settlement.createdById === mockUser().id,
    createdBy: settlement.createdBy
      ? { displayName: settlement.createdBy.displayName }
      : null,
    submittedBy: settlement.submittedBy
      ? { displayName: settlement.submittedBy.displayName }
      : null,
    confirmedBy: settlement.confirmedBy
      ? { displayName: settlement.confirmedBy.displayName }
      : null,
    settledBy: settlement.settledBy
      ? { displayName: settlement.settledBy.displayName }
      : null,
    voidedBy: settlement.voidedBy
      ? { displayName: settlement.voidedBy.displayName }
      : null,
    transitions: (settlement.transitions || []).map(
      (transition: JsonRecord) => ({
        id: transition.id,
        action: transition.action,
        fromStatus: transition.fromStatus || null,
        toStatus: transition.toStatus,
        reason: transition.reason,
        actor: transition.actor
          ? { displayName: transition.actor.displayName }
          : null,
        createdAt: transition.createdAt,
      }),
    ),
  };
  if (!detail) return safe;
  const entries = getConsignmentPayableEntries();
  return {
    ...safe,
    supplier: supplierSummary(supplier || {}),
    lines: (settlement.lines || []).map((line: JsonRecord) => ({
      id: line.id,
      quantity: line.quantity,
      grossSaleCents: line.grossSaleCents,
      commissionCents: line.commissionCents,
      payableCents: line.payableCents,
      releasedAt: line.releasedAt || null,
      createdAt: line.createdAt,
      payableEntry: basePayableView(
        entries.find((entry) => entry.id === line.payableEntryId) || {},
      ),
    })),
  };
};

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
    .reduce((sum, entry) => sum + Number(entry.payableCents || 0), 0);
  const settledPayableCents = getConsignmentSettlements()
    .filter(
      (settlement) =>
        settlement.status === "SETTLED" && inDay(settlement.settledAt),
    )
    .reduce((sum, settlement) => sum + Number(settlement.payableCents || 0), 0);
  return {
    consignmentPayableCents: payableCents,
    consignmentSettledPayableCents: settledPayableCents,
  };
}
