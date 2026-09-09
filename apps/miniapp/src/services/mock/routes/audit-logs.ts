import { getAuditLogs } from "../state";
import { ok, hasMockRole, requireMockRole, text } from "../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleAuditLogsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/audit-logs" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const objectType = text(data.objectType);
    const fullAuditAccess = hasMockRole("ADMIN", "SUPER_ADMIN");
    const financeObjectTypes = new Set([
      "AccountAdjustmentRequest",
      "AllianceSettlement",
      "ConsignmentPayableEntry",
      "ConsignmentSettlement",
      "Export",
      "HostReward",
      "Order",
      "Payment",
      "ReconciliationPeriod",
      "ReferralReward",
      "Refund",
      "TrainingSettlement",
    ]);
    if (!fullAuditAccess && objectType && !financeObjectTypes.has(objectType)) {
      throw new Error("财务仅可查询财务职责范围内的审计记录");
    }
    const rows = getAuditLogs().filter(
      (item) =>
        (!objectType || item.objectType === objectType) &&
        (fullAuditAccess || financeObjectTypes.has(text(item.objectType))),
    );
    const items = fullAuditAccess
      ? rows
      : rows.map((item) => ({
          id: item.id,
          actorRole: item.actorRole,
          action: item.action,
          objectType: item.objectType,
          objectId: item.objectId,
          reason: item.reason,
          result: item.result,
          createdAt: item.createdAt,
          actor: item.actor ? { displayName: item.actor.displayName } : null,
        }));
    return {
      handled: true,
      value: ok({ items, total: items.length, page: 1, pageSize: 100 }),
    };
  }
  return { handled: false };
}
