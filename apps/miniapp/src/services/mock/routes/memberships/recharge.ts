import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import { getRechargePlans, saveRechargePlans } from "../../state";
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
  mockOperatingShareSnapshot,
  saveMockMasterAudit,
} from "../../policies/master-data.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleMembershipsRechargePlansGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/recharge-plans" && method === "GET") {
    const now = Date.now();
    return {
      handled: true,
      value: ok(
        getRechargePlans()
          .filter(
            (plan) =>
              plan.enabled === true &&
              new Date(plan.effectiveFrom).getTime() <= now &&
              (!plan.effectiveTo || new Date(plan.effectiveTo).getTime() > now),
          )
          .sort(
            (left, right) =>
              Number(left.principalCents) - Number(right.principalCents) ||
              Number(right.version) - Number(left.version),
          )
          .map((plan) => {
            const { transitions: _transitions, ...view } =
              mockVersionedMasterView(plan);
            return view;
          }),
      ),
    };
  }
  return { handled: false };
}

export async function handleMembershipsRechargePlansManageGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/recharge-plans/manage" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        getRechargePlans()
          .sort(
            (left, right) =>
              String(left.code).localeCompare(String(right.code)) ||
              Number(right.version) - Number(left.version),
          )
          .map(mockVersionedMasterView),
      ),
    };
  }
  return { handled: false };
}

export async function handleMembershipsRechargePlansPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/recharge-plans" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code);
    const name = text(data.name);
    const principalCents = integer(data.principalCents);
    const giftCents = integer(data.giftCents);
    const effectiveFrom = new Date(text(data.effectiveFrom));
    const effectiveTo = text(data.effectiveTo)
      ? new Date(text(data.effectiveTo))
      : null;
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "充值计划创建幂等键",
    );
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))
      throw new Error("充值计划编码格式无效");
    if (name.length < 2 || name.length > 50)
      throw new Error("充值计划名称长度必须为2-50个字符");
    if (
      !Number.isInteger(principalCents) ||
      principalCents < 100 ||
      principalCents > 10_000_000
    )
      throw new Error("充值本金必须为1元至10万元");
    if (
      !Number.isInteger(giftCents) ||
      giftCents < 0 ||
      giftCents > principalCents
    )
      throw new Error("赠送金额必须为非负数且不得超过充值本金");
    if (
      Number.isNaN(effectiveFrom.getTime()) ||
      (effectiveTo &&
        (Number.isNaN(effectiveTo.getTime()) || effectiveTo <= effectiveFrom))
    )
      throw new Error("充值计划有效期无效");
    const commandHash = creationCommandHash({
      code,
      name,
      principalCents,
      giftCents,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() || null,
      reason,
    });
    const plans = getRechargePlans();
    const existing = plans.find(
      (plan) => plan.creationIdempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (
        existing.createdById !== mockUser().id ||
        existing.creationCommandHash !== commandHash
      )
        throw new Error("充值计划创建幂等键已用于其他命令或操作人");
      return { handled: true, value: ok(mockVersionedMasterView(existing)) };
    }
    const version =
      Math.max(
        0,
        ...plans
          .filter((plan) => plan.code === code)
          .map((plan) => Number(plan.version || 0)),
      ) + 1;
    const now = new Date().toISOString();
    const created = {
      id: newId("recharge-plan"),
      code,
      version,
      name,
      principalCents,
      giftCents,
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
    saveRechargePlans([created, ...plans]);
    saveMockMasterAudit({
      action: "RECHARGE_PLAN_VERSION_CREATED",
      objectType: "RechargePlan",
      objectId: created.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: null,
      newValue: {
        code,
        version,
        name,
        principalCents,
        giftCents,
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

export async function handleRechargePlanStatusPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const rechargePlanStatusMatch = url.match(
    /^\/memberships\/recharge-plans\/([^/]+)\/status$/,
  );
  if (rechargePlanStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    if (typeof data.enabled !== "boolean")
      throw new Error("充值计划状态必须为布尔值");
    const planId = rechargePlanStatusMatch[1];
    const reason = requireMasterReason(data.reason);
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "充值计划状态幂等键",
    );
    const commandHash = creationCommandHash({
      planId,
      enabled: data.enabled,
      reason,
    });
    const plans = getRechargePlans();
    const replay = plans
      .flatMap((plan) =>
        (plan.transitions || []).map((transition: any) => ({
          plan,
          transition,
        })),
      )
      .find(({ transition }) => transition.idempotencyKey === idempotencyKey);
    if (replay) {
      if (
        replay.plan.id !== planId ||
        replay.transition.actorId !== mockUser().id ||
        replay.transition.commandHash !== commandHash
      )
        throw new Error("充值计划状态幂等键已用于其他命令或操作人");
      return {
        handled: true,
        value: ok({
          ...mockVersionedMasterView(replay.plan),
          enabled: replay.transition.newEnabled,
          transition: mockVersionedMasterView({
            transitions: [replay.transition],
          }).transitions[0],
          idempotent: true,
        }),
      };
    }
    const plan = plans.find((item) => item.id === planId);
    if (!plan) throw new Error("充值计划不存在");
    if (plan.enabled === data.enabled)
      throw new Error(data.enabled ? "充值计划已启用" : "充值计划已停用");
    if (data.enabled) {
      const targetStart = new Date(plan.effectiveFrom).getTime();
      const targetEnd = plan.effectiveTo
        ? new Date(plan.effectiveTo).getTime()
        : Number.POSITIVE_INFINITY;
      const overlapping = plans.find((item) => {
        if (item.id === plan.id || item.code !== plan.code || !item.enabled)
          return false;
        const itemStart = new Date(item.effectiveFrom).getTime();
        const itemEnd = item.effectiveTo
          ? new Date(item.effectiveTo).getTime()
          : Number.POSITIVE_INFINITY;
        return itemStart < targetEnd && itemEnd > targetStart;
      });
      if (overlapping)
        throw new Error(
          `同编码 v${overlapping.version} 的有效期与当前版本重叠，请先调整版本有效期`,
        );
    } else {
      const now = Date.now();
      const activeNow =
        new Date(plan.effectiveFrom).getTime() <= now &&
        (!plan.effectiveTo || new Date(plan.effectiveTo).getTime() > now);
      if (
        activeNow &&
        !plans.some(
          (item) =>
            item.id !== plan.id &&
            item.enabled === true &&
            new Date(item.effectiveFrom).getTime() <= now &&
            (!item.effectiveTo || new Date(item.effectiveTo).getTime() > now),
        )
      )
        throw new Error("不能停用最后一个当前有效充值计划，请先启用替代计划");
    }
    const transition = {
      id: newId("recharge-plan-transition"),
      planId: plan.id,
      oldEnabled: plan.enabled,
      newEnabled: data.enabled,
      reason,
      actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      idempotencyKey,
      commandHash,
      createdAt: new Date().toISOString(),
    };
    plan.enabled = data.enabled;
    plan.transitions = [transition, ...(plan.transitions || [])];
    plan.updatedAt = transition.createdAt;
    saveRechargePlans(plans);
    saveMockMasterAudit({
      action: "RECHARGE_PLAN_STATUS_SET",
      objectType: "RechargePlan",
      objectId: plan.id,
      requestId: idempotencyKey,
      commandHash,
      oldValue: { enabled: transition.oldEnabled },
      newValue: { enabled: transition.newEnabled, version: plan.version },
      reason,
    });
    return {
      handled: true,
      value: ok({
        ...mockVersionedMasterView(plan),
        transition: mockVersionedMasterView({ transitions: [transition] })
          .transitions[0],
        idempotent: false,
      }),
    };
  }
  return { handled: false };
}

export async function handleMembershipsRechargePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/memberships/recharge" && method === "POST") {
    if ("principalCents" in data || "giftCents" in data)
      throw new Error("充值金额与赠送金额只能由服务端充值计划决定");
    const planId = text(data.planId);
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "RECHARGE",
      planId,
    });
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const now = new Date();
    const plan = getRechargePlans().find(
      (item) =>
        item.id === planId &&
        item.enabled === true &&
        new Date(item.effectiveFrom) <= now &&
        (!item.effectiveTo || new Date(item.effectiveTo) > now),
    );
    if (!plan) throw new Error("充值计划不存在、未生效或已停用");
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("RC"),
      title: plan.name,
      status: "PENDING",
      businessType: "RECHARGE",
      listAmountCents: plan.principalCents,
      payableCents: plan.principalCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt: now.toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: {
        rechargePlanId: plan.id,
        rechargePlanCode: plan.code,
        rechargePlanVersion: plan.version,
        rechargePlanName: plan.name,
        principalCents: plan.principalCents,
        giftCents: plan.giftCents,
        effectiveFrom: plan.effectiveFrom,
        effectiveTo: plan.effectiveTo || null,
        operatingShare: mockOperatingShareSnapshot("RECHARGE", now),
      },
      items: [
        {
          id: newId("order-item"),
          itemType: "RECHARGE",
          itemId: plan.id,
          name: plan.name,
          quantity: 1,
          unitPriceCents: plan.principalCents,
          amountCents: plan.principalCents,
          metadata: {
            rechargePlanCode: plan.code,
            rechargePlanVersion: plan.version,
            giftCents: plan.giftCents,
          },
        },
      ],
    };
    saveOrders([order, ...getOrders()]);
    return { handled: true, value: finishMockOrderCreation(creation, order) };
  }
  return { handled: false };
}
