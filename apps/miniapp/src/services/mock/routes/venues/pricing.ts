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
} from "../../policies/common.js";
import {
  mockVersionedMasterView,
  requireMasterReason,
  mockCommercialRange,
  mockCommercialRangesOverlap,
  saveMockMasterAudit,
} from "../../policies/master-data.js";
import { mockShanghaiBusinessDate } from "../../policies/front-desk.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleVenuesTimeSlotsManageGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/venues/time-slots/manage" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        availability(mockShanghaiBusinessDate()).slots.map(
          ({ price: _price, ...slot }: any, index: number) => ({
            ...slot,
            enabled: true,
            sortOrder: index + 1,
          }),
        ),
      ),
    };
  }
  return { handled: false };
}

export async function handleVenuesPriceRulesManageGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/venues/price-rules/manage" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const slots = availability(mockShanghaiBusinessDate()).slots;
    return {
      handled: true,
      value: ok(
        getPriceRules()
          .sort(
            (left, right) =>
              String(left.code).localeCompare(String(right.code)) ||
              Number(right.version) - Number(left.version),
          )
          .map((rule) => ({
            ...mockVersionedMasterView(rule),
            timeSlot: rule.timeSlotId
              ? slots.find((slot) => slot.id === rule.timeSlotId) || null
              : null,
          })),
      ),
    };
  }
  return { handled: false };
}

export async function handleVenuesPriceRulesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/venues/price-rules" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const rules = getPriceRules();
    const code = text(data.code);
    const name = text(data.name);
    const timeSlotId = text(data.timeSlotId) || null;
    const weekdayMask = integer(data.weekdayMask);
    const priceCents = integer(data.priceCents);
    const newcomerPriceCents =
      data.newcomerPriceCents === undefined ||
      data.newcomerPriceCents === null ||
      data.newcomerPriceCents === ""
        ? null
        : integer(data.newcomerPriceCents);
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "价格规则创建幂等键",
    );
    const { effectiveFrom, effectiveTo } = mockCommercialRange(
      data,
      "价格规则",
    );
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))
      throw new Error("价格规则编码格式无效");
    if (name.length < 2 || name.length > 80)
      throw new Error("价格规则名称长度必须为2-80个字符");
    const slots = availability(mockShanghaiBusinessDate()).slots;
    if (timeSlotId && !slots.some((slot) => slot.id === timeSlotId))
      throw new Error("计价时段不存在");
    if (!Number.isInteger(weekdayMask) || weekdayMask < 1 || weekdayMask > 127)
      throw new Error("星期范围必须为1-127的位掩码");
    if (
      !Number.isInteger(priceCents) ||
      priceCents < 0 ||
      priceCents > 10_000_000
    )
      throw new Error("普通价格无效");
    if (
      newcomerPriceCents !== null &&
      (!Number.isInteger(newcomerPriceCents) ||
        newcomerPriceCents < 0 ||
        newcomerPriceCents > priceCents)
    )
      throw new Error("新客价必须为非负数且不得高于普通价");
    const commandHash = creationCommandHash({
      sourceRuleId: null,
      code,
      name,
      timeSlotId,
      weekdayMask,
      priceCents,
      newcomerPriceCents,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      reason,
    });
    const replay = rules.find(
      (rule) => rule.creationIdempotencyKey === idempotencyKey,
    );
    if (replay) {
      if (
        replay.createdById !== mockUser().id ||
        replay.creationCommandHash !== commandHash
      )
        throw new Error("价格规则创建幂等键已用于其他命令或操作人");
      return { handled: true, value: ok(mockVersionedMasterView(replay)) };
    }
    if (rules.some((rule) => rule.code === code))
      throw new Error("价格规则编码已存在，请从已有版本创建新版本");
    const now = new Date().toISOString();
    const created = {
      id: newId("price-rule"),
      code,
      version: 1,
      name,
      timeSlotId,
      weekdayMask,
      priceCents,
      newcomerPriceCents,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      enabled: false,
      creationIdempotencyKey: idempotencyKey,
      creationCommandHash: commandHash,
      createdById: mockUser().id,
      createdBy: { id: mockUser().id, displayName: mockUser().displayName },
      transitions: [],
      createdAt: now,
      updatedAt: now,
    };
    savePriceRules([created, ...rules]);
    saveMockMasterAudit({
      action: "PRICE_RULE_VERSION_CREATED",
      objectType: "PriceRule",
      objectId: created.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: null,
      newValue: {
        code,
        version: 1,
        name,
        timeSlotId,
        weekdayMask,
        priceCents,
        newcomerPriceCents,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
        enabled: false,
      },
      reason,
    });
    return { handled: true, value: ok(mockVersionedMasterView(created)) };
  }
  return { handled: false };
}

export async function handlePriceRuleVersionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const priceRuleVersionMatch = url.match(
    /^\/venues\/price-rules\/([^/]+)\/versions$/,
  );
  if (priceRuleVersionMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const rules = getPriceRules();
    const source = rules.find((rule) => rule.id === priceRuleVersionMatch[1]);
    if (!source) throw new Error("价格规则源版本不存在");
    const name = text(data.name);
    const timeSlotId = text(data.timeSlotId) || null;
    const weekdayMask = integer(data.weekdayMask);
    const priceCents = integer(data.priceCents);
    const newcomerPriceCents =
      data.newcomerPriceCents === undefined ||
      data.newcomerPriceCents === null ||
      data.newcomerPriceCents === ""
        ? null
        : integer(data.newcomerPriceCents);
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "价格规则版本创建幂等键",
    );
    const { effectiveFrom, effectiveTo } = mockCommercialRange(
      data,
      "价格规则",
    );
    if (name.length < 2 || name.length > 80)
      throw new Error("价格规则名称长度必须为2-80个字符");
    const slots = availability(mockShanghaiBusinessDate()).slots;
    if (timeSlotId && !slots.some((slot) => slot.id === timeSlotId))
      throw new Error("计价时段不存在");
    if (!Number.isInteger(weekdayMask) || weekdayMask < 1 || weekdayMask > 127)
      throw new Error("星期范围必须为1-127的位掩码");
    if (
      !Number.isInteger(priceCents) ||
      priceCents < 0 ||
      priceCents > 10_000_000
    )
      throw new Error("普通价格无效");
    if (
      newcomerPriceCents !== null &&
      (!Number.isInteger(newcomerPriceCents) ||
        newcomerPriceCents < 0 ||
        newcomerPriceCents > priceCents)
    )
      throw new Error("新客价必须为非负数且不得高于普通价");
    const commandHash = creationCommandHash({
      sourceRuleId: source.id,
      code: source.code,
      name,
      timeSlotId,
      weekdayMask,
      priceCents,
      newcomerPriceCents,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      reason,
    });
    const replay = rules.find(
      (rule) => rule.creationIdempotencyKey === idempotencyKey,
    );
    if (replay) {
      if (
        replay.createdById !== mockUser().id ||
        replay.creationCommandHash !== commandHash
      )
        throw new Error("价格规则创建幂等键已用于其他命令或操作人");
      return { handled: true, value: ok(mockVersionedMasterView(replay)) };
    }
    const version =
      Math.max(
        ...rules
          .filter((rule) => rule.code === source.code)
          .map((rule) => Number(rule.version)),
      ) + 1;
    const now = new Date().toISOString();
    const created = {
      id: newId("price-rule"),
      code: source.code,
      version,
      name,
      timeSlotId,
      weekdayMask,
      priceCents,
      newcomerPriceCents,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      enabled: false,
      creationIdempotencyKey: idempotencyKey,
      creationCommandHash: commandHash,
      createdById: mockUser().id,
      createdBy: { id: mockUser().id, displayName: mockUser().displayName },
      transitions: [],
      createdAt: now,
      updatedAt: now,
    };
    savePriceRules([created, ...rules]);
    saveMockMasterAudit({
      action: "PRICE_RULE_VERSION_CREATED",
      objectType: "PriceRule",
      objectId: created.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: null,
      newValue: {
        sourceRuleId: source.id,
        code: source.code,
        version,
        name,
        timeSlotId,
        weekdayMask,
        priceCents,
        newcomerPriceCents,
        effectiveFrom: created.effectiveFrom,
        effectiveTo: created.effectiveTo,
        enabled: false,
      },
      reason,
    });
    return { handled: true, value: ok(mockVersionedMasterView(created)) };
  }
  return { handled: false };
}

export async function handlePriceRuleStatusPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const priceRuleStatusMatch = url.match(
    /^\/venues\/price-rules\/([^/]+)\/status$/,
  );
  if (priceRuleStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    if (typeof data.enabled !== "boolean")
      throw new Error("价格规则状态必须为布尔值");
    const priceRuleId = priceRuleStatusMatch[1];
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "价格规则状态幂等键",
    );
    const commandHash = creationCommandHash({
      priceRuleId,
      enabled: data.enabled,
      reason,
    });
    const rules = getPriceRules();
    const replay = rules
      .flatMap((rule) =>
        (rule.transitions || []).map((transition: any) => ({
          rule,
          transition,
        })),
      )
      .find(({ transition }) => transition.idempotencyKey === idempotencyKey);
    if (replay) {
      if (
        replay.rule.id !== priceRuleId ||
        replay.transition.actorId !== mockUser().id ||
        replay.transition.commandHash !== commandHash
      )
        throw new Error("价格规则状态幂等键已用于其他命令或操作人");
      return {
        handled: true,
        value: ok({
          ...mockVersionedMasterView(replay.rule),
          enabled: replay.transition.newEnabled,
          transition: mockVersionedMasterView({
            transitions: [replay.transition],
          }).transitions[0],
          idempotent: true,
        }),
      };
    }
    const rule = rules.find((candidate) => candidate.id === priceRuleId);
    if (!rule) throw new Error("价格规则不存在");
    if (rule.enabled === data.enabled)
      throw new Error(data.enabled ? "价格规则已启用" : "价格规则已停用");
    if (data.enabled) {
      const overlappingVersion = rules.find(
        (candidate) =>
          candidate.id !== rule.id &&
          candidate.code === rule.code &&
          candidate.enabled === true &&
          mockCommercialRangesOverlap(candidate, rule),
      );
      if (overlappingVersion)
        throw new Error(
          `同编码 v${overlappingVersion.version} 的有效期与当前版本重叠`,
        );
      const competing = rules.find(
        (candidate) =>
          candidate.id !== rule.id &&
          candidate.timeSlotId === rule.timeSlotId &&
          candidate.enabled === true &&
          mockCommercialRangesOverlap(candidate, rule) &&
          (Number(candidate.weekdayMask) & Number(rule.weekdayMask)) !== 0,
      );
      if (competing)
        throw new Error(
          `相同计价时段与星期范围已有 ${competing.code} v${competing.version} 生效，不能产生不确定价格`,
        );
    }
    const transition = {
      id: newId("price-rule-transition"),
      priceRuleId: rule.id,
      oldEnabled: rule.enabled,
      newEnabled: data.enabled,
      reason,
      actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      idempotencyKey,
      commandHash,
      createdAt: new Date().toISOString(),
    };
    rule.enabled = data.enabled;
    rule.transitions = [transition, ...(rule.transitions || [])];
    rule.updatedAt = transition.createdAt;
    savePriceRules(rules);
    saveMockMasterAudit({
      action: "PRICE_RULE_STATUS_SET",
      objectType: "PriceRule",
      objectId: rule.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: { enabled: transition.oldEnabled },
      newValue: { enabled: transition.newEnabled, version: rule.version },
      reason,
    });
    return {
      handled: true,
      value: ok({
        ...mockVersionedMasterView(rule),
        transition: mockVersionedMasterView({ transitions: [transition] })
          .transitions[0],
        idempotent: false,
      }),
    };
  }
  return { handled: false };
}
