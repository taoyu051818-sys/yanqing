import { mockUser } from "../core";
import {
  getConsignmentPayableEntries,
  getConsignmentSettlements,
  saveConsignmentSettlements,
} from "../state";
import {
  type JsonRecord,
  text,
  newId,
  requireSettlementRole,
  requireReason,
  requireIdempotencyKey,
  actorSnapshot,
  appendAudit,
} from "./command-policy.js";
import { activeClaimedEntryIds, settlementView } from "./queries.js";
import { entryTotals } from "./statement-creation.js";

export const assertStatementSnapshotCurrent = (
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

export const transitionSettlement = (
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
  const settlement = settlements.find(
    (candidate) => candidate.id === settlementId,
  );
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
