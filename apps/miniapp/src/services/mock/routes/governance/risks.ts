import type { AppRole } from "../../../../types/domain";
import { mockUser } from "../../core";
import {
  getRiskEvents,
  getAuditLogs,
  saveRiskEvents,
  saveAuditLogs,
} from "../../state";
import {
  ok,
  mockRoles,
  requireMockRole,
  text,
  newId,
} from "../../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleGovernanceRiskEventsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/governance/risk-events" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    const severity = text(data.severity);
    const items = getRiskEvents().filter(
      (item) =>
        (!status || item.status === status) &&
        (!severity || item.severity === severity),
    );
    return {
      handled: true,
      value: ok({ items, total: items.length, page: 1, pageSize: 100 }),
    };
  }
  return { handled: false };
}

export async function handleRiskActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const riskActionMatch = url.match(
    /^\/governance\/risk-events\/([^/]+)\/(review|resolve|dismiss)$/,
  );
  if (riskActionMatch && method === "POST") {
    const action = riskActionMatch[2];
    requireMockRole(
      ...(action === "review"
        ? (["FINANCE", "ADMIN", "SUPER_ADMIN"] as AppRole[])
        : (["ADMIN", "SUPER_ADMIN"] as AppRole[])),
    );
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("请填写风险处理原因");
    const risks = getRiskEvents();
    const risk = risks.find((item) => item.id === riskActionMatch[1]);
    if (!risk) throw new Error("风险事件不存在");
    const target =
      action === "review"
        ? "REVIEWING"
        : action === "resolve"
          ? "RESOLVED"
          : "DISMISSED";
    if (risk.status === target) return { handled: true, value: ok(risk) };
    if (["RESOLVED", "DISMISSED"].includes(risk.status))
      throw new Error("终态风险事件不能再次处理");
    if (action === "review" && risk.status !== "OPEN")
      throw new Error("只有待处理风险可以进入复核");
    const oldStatus = risk.status;
    risk.status = target;
    risk.evidence = {
      ...(risk.evidence || {}),
      lastAction: action,
      lastReason: reason,
      lastActorId: mockUser().id,
    };
    risk.resolvedBy = target === "REVIEWING" ? null : mockUser().id;
    risk.resolvedAt = target === "REVIEWING" ? null : new Date().toISOString();
    saveRiskEvents(risks);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action: `RISK_EVENT_${target}`,
        objectType: "RiskEvent",
        objectId: risk.id,
        oldValue: { status: oldStatus },
        newValue: { status: target },
        reason,
        result: "SUCCESS",
        createdAt: new Date().toISOString(),
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(risk) };
  }
  return { handled: false };
}
