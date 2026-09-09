import { mockUser } from "../../core";
import {
  getEnrollments,
  getTrainingSettlements,
  saveTrainingSettlements,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import {
  assertTrainingSettlementPeriodUnlocked,
  trainingSettlementView,
} from "../../policies/training.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleTrainingFinancialSummaryAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/financial-summary") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const recognitionDelta = getEnrollments()
      .flatMap((enrollment) => enrollment.attendances || [])
      .flatMap((attendance: any) => attendance.revenueRecognitions || [])
      .reduce(
        (
          total: { revenueCents: number; venueContributionCents: number },
          recognition: any,
        ) => ({
          revenueCents:
            total.revenueCents + Number(recognition.effectiveRevenueCents || 0),
          venueContributionCents:
            total.venueContributionCents +
            Number(recognition.venueContributionCents || 0),
        }),
        { revenueCents: 0, venueContributionCents: 0 },
      );
    return {
      handled: true,
      value: ok({
        effectiveRevenueCents: 1_680_000 + recognitionDelta.revenueCents,
        confirmedRevenueCents: 1_680_000 + recognitionDelta.revenueCents,
        venueContractContributionCents:
          336_000 + recognitionDelta.venueContributionCents,
        venueContributionCents:
          336_000 + recognitionDelta.venueContributionCents,
        venueFeeCents: 0,
      }),
    };
  }
  return { handled: false };
}

export async function handleTrainingSettlementsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/settlements" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const periodStart = data.periodStart
      ? new Date(String(data.periodStart))
      : null;
    const periodEnd = data.periodEnd ? new Date(String(data.periodEnd)) : null;
    if (
      (periodStart && !Number.isFinite(periodStart.getTime())) ||
      (periodEnd && !Number.isFinite(periodEnd.getTime())) ||
      (periodStart && periodEnd && periodEnd <= periodStart)
    ) {
      throw new Error("培训结算查询周期无效");
    }
    return {
      handled: true,
      value: ok(
        getTrainingSettlements()
          .filter(
            (settlement) =>
              (!data.status || settlement.status === data.status) &&
              (!periodStart ||
                new Date(settlement.periodStart).getTime() >=
                  periodStart.getTime()) &&
              (!periodEnd ||
                new Date(settlement.periodEnd).getTime() <=
                  periodEnd.getTime()),
          )
          .sort(
            (left, right) =>
              new Date(right.periodEnd).getTime() -
              new Date(left.periodEnd).getTime(),
          )
          .map(trainingSettlementView),
      ),
    };
  }
  return { handled: false };
}

export async function handleTrainingSettlementsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/settlements" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const periodStart = new Date(String(data.periodStart || ""));
    const periodEnd = new Date(String(data.periodEnd || ""));
    if (
      !Number.isFinite(periodStart.getTime()) ||
      !Number.isFinite(periodEnd.getTime()) ||
      periodEnd <= periodStart
    ) {
      throw new Error("结算结束时间必须晚于开始时间");
    }
    const acquisitionCostCents = integer(data.acquisitionCostCents ?? 0);
    const marketingCostCents = integer(data.marketingCostCents ?? 0);
    if (acquisitionCostCents < 0 || marketingCostCents < 0) {
      throw new Error("获客和营销费用必须为非负整数");
    }
    assertTrainingSettlementPeriodUnlocked(periodStart, periodEnd);
    const list = getTrainingSettlements();
    const existing = list.find(
      (settlement) =>
        settlement.periodStart === periodStart.toISOString() &&
        settlement.periodEnd === periodEnd.toISOString(),
    );
    if (existing) {
      if (
        Number(existing.acquisitionCostCents) !== acquisitionCostCents ||
        Number(existing.marketingCostCents) !== marketingCostCents
      ) {
        throw new Error("该培训结算周期已生成，费用口径不同，不能覆盖原草稿");
      }
      return { handled: true, value: ok(trainingSettlementView(existing)) };
    }
    const now = new Date().toISOString();
    const effectiveRevenueCents = 168_000;
    const coachCostCents = 36_000;
    const assistantCostCents = 8_000;
    const materialCostCents = 5_000;
    const venueContributionCents = Math.round(
      (effectiveRevenueCents * 2_000) / 10_000,
    );
    const actor = mockUser();
    const settlement = {
      id: newId("training-settlement"),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      effectiveRevenueCents,
      contractRateBps: 2_000,
      venueContributionCents,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
      acquisitionCostCents,
      marketingCostCents,
      occupiedCourtHours: 6,
      cashContributionMarginCents:
        effectiveRevenueCents -
        coachCostCents -
        assistantCostCents -
        materialCostCents -
        acquisitionCostCents -
        marketingCostCents,
      status: "DRAFT",
      confirmedById: null,
      confirmedAt: null,
      createdById: actor.id,
      createdBy: { id: actor.id, displayName: actor.displayName },
      workflowHistory: [
        {
          action: "TRAINING_SETTLEMENT_CREATED",
          actorId: actor.id,
          actorName: actor.displayName,
          reason: null,
          oldValue: null,
          newValue: { status: "DRAFT" },
          at: now,
        },
      ],
      processedIdempotencyKeys: {},
      createdAt: now,
      updatedAt: now,
    };
    saveTrainingSettlements([settlement, ...list]);
    return { handled: true, value: ok(trainingSettlementView(settlement)) };
  }
  return { handled: false };
}

export async function handleTrainingSettlementActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const trainingSettlementAction = url.match(
    /^\/training\/settlements\/([^/]+)\/(submit|confirm|settle|return|void)$/,
  );
  if (trainingSettlementAction && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const list = getTrainingSettlements();
    const settlement = list.find(
      (item) => item.id === trainingSettlementAction[1],
    );
    if (!settlement) throw new Error("培训结算单不存在");
    const action = trainingSettlementAction[2];
    const transitions: Record<
      string,
      { from: string; to: string; auditAction: string }
    > = {
      submit: {
        from: "DRAFT",
        to: "PENDING_CONFIRMATION",
        auditAction: "TRAINING_SETTLEMENT_SUBMITTED",
      },
      confirm: {
        from: "PENDING_CONFIRMATION",
        to: "CONFIRMED",
        auditAction: "TRAINING_SETTLEMENT_CONFIRMED",
      },
      settle: {
        from: "CONFIRMED",
        to: "SETTLED",
        auditAction: "TRAINING_SETTLEMENT_SETTLED",
      },
      return: {
        from: "PENDING_CONFIRMATION",
        to: "DRAFT",
        auditAction: "TRAINING_SETTLEMENT_RETURNED",
      },
      void: {
        from: "DRAFT",
        to: "VOID",
        auditAction: "TRAINING_SETTLEMENT_VOIDED",
      },
    };
    const transition = transitions[action];
    const actor = mockUser();
    if (
      ["confirm", "settle", "return"].includes(action) &&
      settlement.createdById === actor.id
    ) {
      throw new Error("制单人不能确认、结算或退回自己的培训结算单");
    }
    const reason = text(data.reason);
    if (["return", "void"].includes(action) && reason.length < 2) {
      throw new Error("退回或作废结算单必须填写原因");
    }
    const idempotencyKey = data.idempotencyKey
      ? requireIdempotencyKey(data.idempotencyKey, "培训结算动作幂等键")
      : "";
    const processed = (settlement.processedIdempotencyKeys || {}) as Record<
      string,
      string
    >;
    if (idempotencyKey && processed[idempotencyKey]) {
      if (processed[idempotencyKey] !== transition.auditAction) {
        throw new Error("幂等键已用于其他培训结算动作");
      }
      return { handled: true, value: ok(trainingSettlementView(settlement)) };
    }
    if (settlement.status === transition.to)
      return { handled: true, value: ok(trainingSettlementView(settlement)) };
    if (settlement.status !== transition.from) {
      throw new Error(
        `培训结算单当前状态为 ${settlement.status}，不能执行该操作`,
      );
    }
    assertTrainingSettlementPeriodUnlocked(
      new Date(settlement.periodStart),
      new Date(settlement.periodEnd),
    );
    const oldStatus = settlement.status;
    const now = new Date().toISOString();
    settlement.status = transition.to;
    settlement.updatedAt = now;
    if (action === "confirm") {
      settlement.confirmedById = actor.id;
      settlement.confirmedAt = now;
    } else if (action === "return") {
      settlement.confirmedById = null;
      settlement.confirmedAt = null;
    }
    settlement.workflowHistory = [
      ...(Array.isArray(settlement.workflowHistory)
        ? settlement.workflowHistory
        : []),
      {
        action: transition.auditAction,
        actorId: actor.id,
        actorName: actor.displayName,
        reason: reason || null,
        oldValue: { status: oldStatus },
        newValue: { status: transition.to },
        at: now,
      },
    ];
    if (idempotencyKey) processed[idempotencyKey] = transition.auditAction;
    settlement.processedIdempotencyKeys = processed;
    saveTrainingSettlements(list);
    return { handled: true, value: ok(trainingSettlementView(settlement)) };
  }
  return { handled: false };
}
