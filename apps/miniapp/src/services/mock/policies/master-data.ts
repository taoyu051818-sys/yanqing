import { mockUser } from "../core";
import { getSystemParameters, getAuditLogs, saveAuditLogs } from "../state";
import {
  mockRoles,
  text,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "./common.js";

export const mockVersionedMasterView = (record: any) => {
  const {
    creationIdempotencyKey: _creationIdempotencyKey,
    creationCommandHash: _creationCommandHash,
    ...view
  } = record;
  return {
    ...view,
    transitions: (view.transitions || []).map((transition: any) => {
      const {
        idempotencyKey: _idempotencyKey,
        commandHash: _commandHash,
        ...transitionView
      } = transition;
      return transitionView;
    }),
  };
};

export const requireMasterReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 2 || reason.length > 300)
    throw new Error("变更原因长度必须为2-300个字符");
  return reason;
};

export const mockCommercialRange = (data: any, label: string) => {
  const effectiveFrom = new Date(text(data.effectiveFrom));
  const effectiveTo = text(data.effectiveTo)
    ? new Date(text(data.effectiveTo))
    : null;
  if (
    Number.isNaN(effectiveFrom.getTime()) ||
    (effectiveTo &&
      (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom))
  )
    throw new Error(`${label}有效期无效`);
  return { effectiveFrom, effectiveTo };
};

export const mockCommercialRangesOverlap = (left: any, right: any) => {
  const leftStart = new Date(left.effectiveFrom).getTime();
  const leftEnd = left.effectiveTo
    ? new Date(left.effectiveTo).getTime()
    : Number.POSITIVE_INFINITY;
  const rightStart = new Date(right.effectiveFrom).getTime();
  const rightEnd = right.effectiveTo
    ? new Date(right.effectiveTo).getTime()
    : Number.POSITIVE_INFINITY;
  return leftStart < rightEnd && rightStart < leftEnd;
};

export const mockCurrentlyEffective = (record: any, now = Date.now()) =>
  record.enabled === true &&
  new Date(record.effectiveFrom).getTime() <= now &&
  (!record.effectiveTo || new Date(record.effectiveTo).getTime() > now);

export const mockOperatingShareSnapshot = (
  businessType: string,
  at = new Date(),
) => {
  const included = [
    "VENUE",
    "GAME",
    "EVENT",
    "TRAINING",
    "GOODS",
    "MEMBERSHIP",
  ].includes(businessType);
  const parameter = included
    ? getSystemParameters()
        .filter(
          (item) =>
            item.key === "finance.operating_share_rate_bps" &&
            new Date(item.effectiveFrom) <= at &&
            (!item.effectiveTo || new Date(item.effectiveTo) > at),
        )
        .sort((left, right) =>
          String(right.effectiveFrom).localeCompare(String(left.effectiveFrom)),
        )[0]
    : null;
  const rateBps = included ? Number(parameter?.value ?? 1_500) : 0;
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000)
    throw new Error("经营分成比例配置无效");
  return {
    key: "finance.operating_share_rate_bps",
    parameterId: parameter?.id || null,
    rateBps,
    businessType,
    included,
    basis: "REALIZED_NET_REVENUE",
    effectiveFrom: parameter?.effectiveFrom || null,
    effectiveTo: parameter?.effectiveTo || null,
  };
};

export const requireMasterVersion = (current: any, value: unknown) => {
  const expected = text(value);
  if (
    !expected ||
    new Date(expected).getTime() !== new Date(current.updatedAt).getTime()
  )
    throw new Error("资料已被其他账号修改，请刷新后重试");
};

export const nextMockUpdatedAt = (current: any) =>
  new Date(
    Math.max(Date.now(), new Date(current.updatedAt || 0).getTime() + 1),
  ).toISOString();

export const replayMockMasterCommand = (
  action: string,
  objectType: string,
  idempotencyKey: unknown,
  command: unknown,
) => {
  const requestId = requireIdempotencyKey(idempotencyKey, "主数据幂等键");
  const commandHash = creationCommandHash(command);
  const audit = getAuditLogs().find(
    (entry) =>
      entry.action === action &&
      entry.objectType === objectType &&
      entry.requestId === requestId,
  );
  if (audit) {
    if (audit.actorId !== mockUser().id)
      throw new Error("主数据幂等键已由其他操作人使用");
    if (audit.newValue?.commandHash !== commandHash)
      throw new Error("主数据幂等键已用于其他变更指令");
    return { requestId, commandHash, objectId: audit.objectId };
  }
  return { requestId, commandHash, objectId: null };
};

export const saveMockMasterAudit = (input: {
  action: string;
  objectType: string;
  objectId: string;
  requestId: string;
  commandHash: string;
  oldValue: any;
  newValue: any;
  reason: string;
}) => {
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: mockUser().id,
      actorRole: mockRoles()[0],
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      requestId: input.requestId,
      oldValue: input.oldValue,
      newValue: { ...input.newValue, commandHash: input.commandHash },
      reason: input.reason,
      result: "SUCCESS",
      createdAt: new Date().toISOString(),
    },
    ...getAuditLogs(),
  ]);
};
