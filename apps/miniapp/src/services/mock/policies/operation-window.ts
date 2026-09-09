import { mockUser } from "../core";
import { getAuditLogs, saveAuditLogs } from "../state";
import { hasMockRole, text, activeMockParameter, newId } from "./common.js";

export const mockOperationWindow = (
  parameterKey: string,
  defaults: { earlyMinutes: number; lateMinutes: number },
  at = new Date(),
) => {
  const parameter = activeMockParameter(parameterKey, at);
  const configured = parameter?.value as any;
  const valid =
    configured?.version === 1 &&
    Number.isInteger(configured.earlyMinutes) &&
    configured.earlyMinutes >= 0 &&
    configured.earlyMinutes <= 240 &&
    Number.isInteger(configured.lateMinutes) &&
    configured.lateMinutes >= 0 &&
    configured.lateMinutes <= 240;
  return {
    parameterId: valid ? parameter?.id || null : null,
    parameterKey,
    source: valid
      ? "SYSTEM_PARAMETER"
      : parameter
        ? "DEFAULT_INVALID_PARAMETER"
        : "DEFAULT_MISSING_PARAMETER",
    earlyMinutes: valid ? configured.earlyMinutes : defaults.earlyMinutes,
    lateMinutes: valid ? configured.lateMinutes : defaults.lateMinutes,
  };
};

export const assertMockOperationWindow = (options: {
  parameterKey: string;
  defaults: { earlyMinutes: number; lateMinutes: number };
  startsAt: unknown;
  endsAt: unknown;
  action: string;
  objectType: string;
  objectId: string;
  overrideReason?: unknown;
}) => {
  const observedAt = new Date();
  const startsAt = new Date(String(options.startsAt || ""));
  const endsAt = new Date(String(options.endsAt || ""));
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime())
  )
    throw new Error("业务时间无效，不能执行现场操作");
  const policy = mockOperationWindow(
    options.parameterKey,
    options.defaults,
    observedAt,
  );
  const earliestAt = new Date(
    startsAt.getTime() - policy.earlyMinutes * 60_000,
  );
  const latestAt = new Date(endsAt.getTime() + policy.lateMinutes * 60_000);
  const snapshot = {
    ...policy,
    scheduledStartsAt: startsAt.toISOString(),
    scheduledEndsAt: endsAt.toISOString(),
    earliestAt: earliestAt.toISOString(),
    latestAt: latestAt.toISOString(),
    observedAt: observedAt.toISOString(),
  };
  if (observedAt < earliestAt)
    throw new Error(
      `未到允许操作窗口，最早可于 ${earliestAt.toISOString()} 执行`,
    );
  if (observedAt <= latestAt) return { ...snapshot, decision: "WITHIN_WINDOW" };
  if (!hasMockRole("ADMIN", "SUPER_ADMIN"))
    throw new Error("已超过允许操作窗口，仅管理员可历史补录");
  const reason = text(options.overrideReason);
  if (reason.length < 2 || reason.length > 300)
    throw new Error("管理员历史补录必须填写2-300个字符的原因");
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: mockUser().primaryRole,
      action: `${options.action}_HISTORICAL_OVERRIDE`,
      objectType: options.objectType,
      objectId: options.objectId,
      reason,
      result: "SUCCESS",
      newValue: { ...snapshot, decision: "ADMIN_HISTORICAL_OVERRIDE" },
      createdAt: observedAt.toISOString(),
    },
    ...getAuditLogs(),
  ]);
  return { ...snapshot, decision: "ADMIN_HISTORICAL_OVERRIDE" };
};
