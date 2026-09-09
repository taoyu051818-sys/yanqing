import { mockUser } from "../../core";
import { getMerchants, getSettlements, saveSettlements } from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  newId,
} from "../../policies/common.js";
import {
  settlementDirectoryIsScoped,
  merchantCanManage,
  allianceSettlementView,
} from "../../policies/alliance.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleAllianceSettlementsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/settlements" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const merchant = getMerchants().find((item) => item.id === data.merchantId);
    if (!merchant) throw new Error("商户不存在");
    const periodStart = new Date(String(data.periodStart || ""));
    const periodEnd = new Date(String(data.periodEnd || ""));
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd <= periodStart
    )
      throw new Error("结算周期无效");
    const grossProfit = integer(data.attributedGrossProfitCents)
      ? Number(data.attributedGrossProfitCents)
      : 0;
    if (grossProfit < 0) throw new Error("归因毛利必须为非负整数");
    const existing = getSettlements().find(
      (item) =>
        item.merchantId === merchant.id &&
        item.periodStart === periodStart.toISOString() &&
        item.periodEnd === periodEnd.toISOString(),
    );
    if (existing) {
      if (Number(existing.attributedGrossProfitCents || 0) !== grossProfit)
        throw new Error("该商户结算周期已生成，利润口径不同，请先提出调整申请");
      return { handled: true, value: ok(allianceSettlementView(existing)) };
    }
    const settlement = {
      id: newId("settlement"),
      merchantId: merchant.id,
      merchant,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      attributedGrossProfitCents: grossProfit,
      cooperationFeeCents: 12000,
      issuedCount: 0,
      claimedCount: 0,
      redeemedCount: 0,
      effectiveNewCustomers: 0,
      attributedGmvCents: 0,
      roi: 0,
      status: "DRAFT",
      detail: { workflowHistory: [] },
    };
    saveSettlements([settlement, ...getSettlements()]);
    return { handled: true, value: ok(settlement) };
  }
  return { handled: false };
}

export async function handleAllianceSettlementsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/alliance/settlements" && method === "GET") {
    requireMockRole("MERCHANT", "FINANCE", "ADMIN", "SUPER_ADMIN");
    if (settlementDirectoryIsScoped()) {
      return {
        handled: true,
        value: ok(
          getSettlements()
            .filter((settlement) => settlement.merchantId === "merchant-coffee")
            .map(allianceSettlementView),
        ),
      };
    }
    return {
      handled: true,
      value: ok(getSettlements().map(allianceSettlementView)),
    };
  }
  return { handled: false };
}

export async function handleSettlementActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const settlementAction = url.match(
    /^\/alliance\/settlements\/([^/]+)\/(submit|confirm|dispute|settle)$/,
  );
  if (settlementAction && method === "POST") {
    const list = getSettlements();
    const settlement = list.find((item) => item.id === settlementAction[1]);
    if (!settlement) throw new Error("联盟结算单不存在");
    const action = settlementAction[2];
    const transitions: Record<string, { from: string; to: string }> = {
      submit: { from: "DRAFT", to: "PENDING_CONFIRMATION" },
      confirm: { from: "PENDING_CONFIRMATION", to: "CONFIRMED" },
      dispute: { from: "PENDING_CONFIRMATION", to: "DRAFT" },
      settle: { from: "CONFIRMED", to: "SETTLED" },
    };
    if (
      ["confirm", "dispute"].includes(settlementAction[2]) &&
      !merchantCanManage(settlement.merchantId)
    )
      throw new Error("只能操作本商户的结算单");
    const transition = transitions[action];
    if (["confirm", "dispute"].includes(action))
      requireMockRole("MERCHANT", "ADMIN", "SUPER_ADMIN");
    if (["submit", "settle"].includes(action))
      requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    if (settlement.status === transition.to)
      return { handled: true, value: ok(allianceSettlementView(settlement)) };
    if (settlement.status !== transition.from)
      throw new Error(`结算单当前状态为 ${settlement.status}，不能执行该操作`);
    if (action === "dispute" && text(data.reason).length < 2)
      throw new Error("提出争议必须填写原因");
    settlement.status = transition.to;
    const history = Array.isArray(settlement.detail?.workflowHistory)
      ? settlement.detail.workflowHistory
      : [];
    settlement.detail = {
      ...(settlement.detail || {}),
      workflowHistory: [
        ...history,
        {
          action,
          state: transition.to,
          reason: data.reason,
          actorId: mockUser().id,
          at: new Date().toISOString(),
        },
      ],
    };
    saveSettlements(list);
    return { handled: true, value: ok(allianceSettlementView(settlement)) };
  }
  return { handled: false };
}
