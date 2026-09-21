import { mockUser } from "../../core";
import { availability } from "../../venue";
import { getPriceRules, savePriceRules } from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  requireIdempotencyKey,
  newId,
  creationCommandHash,
} from "../../policies/common";
import {
  mockCommercialRange,
  mockCommercialRangesOverlap,
  mockVersionedMasterView,
  requireMasterReason,
  saveMockMasterAudit,
} from "../../policies/master-data";
import { mockShanghaiBusinessDate } from "../../policies/front-desk";
import type { MockRouteOptions, MockRouteResult } from "../route-contract";

export async function handleApplyVenuePrice(
  method: string,
  url: string,
  data: any,
  _options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (method !== "POST" || url !== "/venues/price-rules/apply")
    return { handled: false };
  requireMockRole("ADMIN", "SUPER_ADMIN");
  const rules = getPriceRules(),
    actor = mockUser();
  const reason = requireMasterReason(data.reason),
    idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "价格修改幂等键",
    );
  const range = mockCommercialRange(data, "价格");
  if ((+range.effectiveFrom + 8 * 3_600_000) % 86_400_000 !== 0)
    throw new Error("请选择北京时间的营业日期");
  const command = {
    operation: "APPLY_PRICE",
    sourceRuleId: text(data.sourceRuleId) || null,
    sourceRevision: text(data.sourceRevision) || null,
    name: text(data.name),
    timeSlotId: text(data.timeSlotId) || null,
    weekdayMask: integer(data.weekdayMask),
    priceCents: integer(data.priceCents),
    newcomerPriceCents:
      data.newcomerPriceCents == null ? null : integer(data.newcomerPriceCents),
    effectiveFrom: range.effectiveFrom.toISOString(),
    effectiveTo: range.effectiveTo?.toISOString() || null,
    reason,
  };
  const hash = creationCommandHash(command);
  const replay = rules.find((r) => r.creationIdempotencyKey === idempotencyKey);
  if (replay) {
    if (replay.createdById !== actor.id || replay.creationCommandHash !== hash)
      throw new Error("价格修改幂等键已用于其他命令或操作人");
    return { handled: true, value: ok(mockVersionedMasterView(replay)) };
  }
  if (command.name.length < 2 || command.name.length > 80)
    throw new Error("价格名称需为 2–80 个字");
  if (
    !Number.isInteger(command.weekdayMask) ||
    command.weekdayMask < 1 ||
    command.weekdayMask > 127
  )
    throw new Error("适用星期无效");
  if (
    !Number.isInteger(command.priceCents) ||
    command.priceCents < 0 ||
    command.priceCents > 10_000_000
  )
    throw new Error("普通价格无效");
  if (
    command.newcomerPriceCents !== null &&
    (!Number.isInteger(command.newcomerPriceCents) ||
      command.newcomerPriceCents < 0 ||
      command.newcomerPriceCents > command.priceCents)
  )
    throw new Error("新客价不得高于普通价");
  const source = rules.find((r) => r.id === command.sourceRuleId);
  if (command.sourceRuleId && !source) throw new Error("原价格不存在");
  if (source) {
    if (!command.sourceRevision || source.updatedAt !== command.sourceRevision)
      throw new Error("价格已被其他操作修改，请返回列表刷新后重试");
    if (
      source.timeSlotId !== command.timeSlotId ||
      source.weekdayMask !== command.weekdayMask
    )
      throw new Error("调整价格时保留原时段和星期范围；其他范围请新增价格");
    if (
      source.enabled &&
      (+range.effectiveFrom < +new Date(source.effectiveFrom) ||
        (source.effectiveTo &&
          +range.effectiveFrom >= +new Date(source.effectiveTo)))
    )
      throw new Error("请选择原价格有效期内的生效日期");
    if (
      source.enabled &&
      (source.effectiveTo
        ? new Date(source.effectiveTo).toISOString()
        : null) !== command.effectiveTo
    )
      throw new Error("调整价格时保留原结束日期");
  }
  const slots = availability(mockShanghaiBusinessDate(), true).slots;
  if (
    command.timeSlotId &&
    !slots.some((s) => s.id === command.timeSlotId && s.enabled)
  )
    throw new Error("所选计价时段已停售");
  const competing = rules.find(
    (r) =>
      r.id !== source?.id &&
      r.enabled &&
      mockCommercialRangesOverlap(r, command) &&
      ((source && r.code === source.code) ||
        (r.timeSlotId === command.timeSlotId &&
          (r.weekdayMask & command.weekdayMask) !== 0)),
  );
  if (competing)
    throw new Error(`与“${competing.name}”的适用范围重叠，请从该价格进入修改`);
  const before = source ? { ...source } : null;
  const now = new Date(
    Math.max(Date.now(), source ? +new Date(source.updatedAt) + 1 : 0),
  ).toISOString();
  const code = source?.code || newId("PRICE").toUpperCase();
  const created = {
    ...command,
    id: newId("price-rule"),
    code,
    version:
      Math.max(
        0,
        ...rules.filter((r) => r.code === code).map((r) => Number(r.version)),
      ) + 1,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    createdById: actor.id,
    createdBy: { id: actor.id, displayName: actor.displayName },
    transitions: [],
    creationIdempotencyKey: idempotencyKey,
    creationCommandHash: hash,
  };
  if (source?.enabled) {
    if (+range.effectiveFrom > +new Date(source.effectiveFrom))
      source.effectiveTo = command.effectiveFrom;
    else source.enabled = false;
    source.updatedAt = now;
  }
  savePriceRules([created, ...rules]);
  saveMockMasterAudit({
    action: "PRICE_CHANGE_APPLIED",
    objectType: "PriceRule",
    objectId: created.id,
    requestId: idempotencyKey,
    commandHash: hash,
    oldValue: before,
    newValue: created,
    reason,
  });
  return { handled: true, value: ok(mockVersionedMasterView(created)) };
}
