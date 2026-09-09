import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import { getAuditLogs, saveAuditLogs } from "../state";

export type JsonRecord = Record<string, any>;

export type MockConsignmentRouteResult =
  { handled: false } | { handled: true; value: unknown };

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const text = (value: unknown) => String(value ?? "").trim();

export const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const currentRoles = (): AppRole[] =>
  mockUser().roles.map((role: any) =>
    typeof role === "string" ? role : role.role,
  );

export const requireSettlementRole = () => {
  if (
    !currentRoles().some((role) =>
      (["FINANCE", "ADMIN", "SUPER_ADMIN"] as AppRole[]).includes(role),
    )
  ) {
    throw new Error("仅财务或管理员可操作寄售应付与结算");
  }
};

export const requireReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 2 || reason.length > 300)
    throw new Error("操作原因长度必须为2-300个字符");
  return reason;
};

export const requireIdempotencyKey = (value: unknown) => {
  const idempotencyKey = text(value);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 100)
    throw new Error("幂等键长度必须为8-100个字符");
  return idempotencyKey;
};

export const requirePeriod = (startValue: unknown, endValue: unknown) => {
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

export const optionalPeriod = (startValue: unknown, endValue: unknown) => {
  if (!startValue && !endValue) return null;
  if (!startValue || !endValue)
    throw new Error("查询周期开始和结束时间必须同时填写");
  return requirePeriod(startValue, endValue);
};

export const actorSnapshot = () => ({
  id: mockUser().id,
  displayName: mockUser().displayName,
});

export const requireConsignmentRule = (supplier: JsonRecord) => {
  const settlementCycle = text(supplier.settlementRule?.settlementCycle);
  const commissionRateBps = Number(supplier.settlementRule?.commissionRateBps);
  if (!["PER_ORDER", "WEEKLY", "MONTHLY"].includes(settlementCycle))
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

export const appendAudit = (
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
