import { mockUser } from "../core";
import { getReconciliationPeriods, saveReconciliationPeriods } from "../state";
import { ok, requireMockRole } from "../policies/common.js";
import {
  mockReconciliationTotals,
  mockReconciliationBlockers,
} from "../policies/reconciliation.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleReconciliationGetGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const reconciliationGetMatch = url.match(
    /^\/reconciliation\/periods\/(\d{4}-\d{2}-\d{2})$/,
  );
  if (reconciliationGetMatch && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const date = reconciliationGetMatch[1];
    const periods = getReconciliationPeriods();
    const current = periods[date];
    if (current?.status === "LOCKED")
      return { handled: true, value: ok(current) };
    const blockers = mockReconciliationBlockers(date);
    return {
      handled: true,
      value: ok({
        ...(current || {}),
        id: current?.id,
        businessDate: `${date}T00:00:00+08:00`,
        status: blockers.length ? "REVIEW" : "OPEN",
        totals: mockReconciliationTotals(date),
        exceptionCount: blockers.length,
        closedById: null,
        closedAt: null,
        detail: { businessDate: date, timezone: "Asia/Shanghai", blockers },
        blocked: blockers.length > 0,
        blockers,
      }),
    };
  }
  return { handled: false };
}

export async function handleReconciliationClosePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const reconciliationCloseMatch = url.match(
    /^\/reconciliation\/periods\/(\d{4}-\d{2}-\d{2})\/close$/,
  );
  if (reconciliationCloseMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const date = reconciliationCloseMatch[1];
    if (new Date(`${date}T24:00:00+08:00`).getTime() > Date.now()) {
      throw new Error("营业日结束后才可关账；当天数据请使用实时日结预览");
    }
    const periods = getReconciliationPeriods();
    const current = periods[date];
    if (current?.status === "LOCKED")
      return { handled: true, value: ok(current) };
    const now = new Date().toISOString();
    const blockers = mockReconciliationBlockers(date);
    const blocked = blockers.length > 0;
    const next = {
      id: current?.id || `reconciliation-${date}`,
      businessDate: `${date}T00:00:00+08:00`,
      status: blocked ? "REVIEW" : "LOCKED",
      totals: mockReconciliationTotals(date),
      exceptionCount: blockers.length,
      closedById: blocked ? null : mockUser().id,
      closedAt: blocked ? null : now,
      detail: {
        businessDate: date,
        timezone: "Asia/Shanghai",
        blockers,
        ...(data?.reason ? { reason: data.reason } : {}),
      },
      blocked,
      blockers,
    };
    periods[date] = next;
    saveReconciliationPeriods(periods);
    return { handled: true, value: ok(next) };
  }
  return { handled: false };
}
