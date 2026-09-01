import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getGovernanceUsers,
  getMemberAccounts,
  getMemberAccountTransactions,
  resetCatalogState,
} from "./state";
import { getOrders } from "./venue";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const login = (role: string) =>
  mockRequest<any>("POST", "/auth/dev-login", { role });
const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);

const shanghaiDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

describe("miniapp financial P0 hardening", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("MEMBER");
  });

  it("seeds exactly one account for each of the five member account types", () => {
    const accounts = getMemberAccounts()["member-1"];
    const types = accounts.map((account) => account.type);
    expect(accounts).toHaveLength(5);
    expect(new Set(types).size).toBe(5);
    expect(types.sort()).toEqual(
      [
        "BADMINTON_COIN",
        "CASH_PRINCIPAL",
        "EVENT_POINTS",
        "GIFT_BALANCE",
        "GROWTH_POINTS",
      ].sort(),
    );
  });

  it.each([
    "VENUE",
    "GAME",
    "EVENT",
    "TRAINING",
    "GOODS",
    "MEMBERSHIP",
    "RECHARGE",
    "ALLIANCE",
  ])("rejects COUPON for %s before any mock state changes", async (businessType) => {
    const order = {
      id: `coupon-order-${businessType.toLowerCase()}`,
      orderNo: `COUPON-${businessType}`,
      memberId: "user-member",
      status: "PENDING",
      businessType,
      payableCents: 10_000,
      paidCents: 0,
      refundedCents: 0,
      parameterSnapshot: {},
      createdAt: new Date().toISOString(),
    };
    storage.set("yanqing_mock_orders", [order]);
    const before = JSON.stringify([...storage.entries()]);

    await expect(request("POST", `/orders/${order.id}/pay`, {
      channel: "COUPON",
      idempotencyKey: `coupon-block-${businessType.toLowerCase()}`,
    })).rejects.toThrow("不能作为支付渠道");

    expect(JSON.stringify([...storage.entries()])).toBe(before);
  });

  it("rejects legacy client amounts and derives the complete recharge snapshot from a plan", async () => {
    const ordersBefore = await request<any>("GET", "/orders");
    await expect(request("POST", "/memberships/recharge", {
      planId: "recharge-plan-mock-500",
      principalCents: 100,
      giftCents: 9_999_999,
      creationIdempotencyKey: "legacy-recharge-fields",
    })).rejects.toThrow("只能由服务端充值计划决定");
    expect((await request<any>("GET", "/orders")).total).toBe(ordersBefore.total);

    const order = await request<any>("POST", "/memberships/recharge", {
      planId: "recharge-plan-mock-500",
      creationIdempotencyKey: "server-plan-recharge-order",
    });
    expect(order).toMatchObject({
      title: "充值500元赠25元",
      listAmountCents: 50_000,
      payableCents: 50_000,
    });
    expect(order).not.toHaveProperty("parameterSnapshot");
    expect(
      getOrders().find((item) => item.id === order.id)?.parameterSnapshot,
    ).toMatchObject({
      rechargePlanId: "recharge-plan-mock-500",
      rechargePlanCode: "RECHARGE_500",
      rechargePlanVersion: 1,
      principalCents: 50_000,
      giftCents: 2_500,
    });
  });

  it("instantly activates membership and reverses the subscription on a full refund", async () => {
    const order = await request<any>("POST", "/memberships/purchase", {
      productId: "member-regular",
      creationIdempotencyKey: "membership-instant-order",
    });
    const payment = {
      channel: "WECHAT",
      idempotencyKey: "membership-instant-payment",
    };
    await request("POST", `/orders/${order.id}/pay`, payment);
    await expect(request("POST", `/orders/${order.id}/pay`, payment)).resolves
      .toMatchObject({ status: "SUCCEEDED" });

    let stored = getOrders().find((item: any) => item.id === order.id);
    expect(stored).toMatchObject({
      status: "COMPLETED",
      paymentStatus: "SUCCEEDED",
      fulfillmentOutcome: "ACTIVATED",
      membership: { status: "ACTIVE" },
    });
    expect(stored.completedAt).toBe(stored.paidAt);
    expect(
      getGovernanceUsers().find((item) => item.id === "user-member")
        ?.memberProfile,
    ).toMatchObject({ level: "REGULAR" });

    const refund = await request<any>("POST", `/orders/${order.id}/refunds`, {
      amountCents: order.payableCents,
      reason: "会员权益未使用退费",
      idempotencyKey: "membership-instant-refund",
    });
    await login("FINANCE");
    await request("POST", `/orders/refunds/${refund.id}/approve`, {
      reason: "核对权益未使用",
    });
    stored = getOrders().find((item: any) => item.id === order.id);
    expect(stored).toMatchObject({
      status: "REFUNDED",
      paymentStatus: "REFUNDED",
      membership: { status: "CANCELLED" },
    });
    expect(
      getGovernanceUsers().find((item) => item.id === "user-member")
        ?.memberProfile,
    ).toMatchObject({ level: "EXPERIENCE", membershipExpiresAt: null });
  });

  it("credits recharge accounts once, reconciles persisted payment, and reverses once", async () => {
    const order = await request<any>("POST", "/memberships/recharge", {
      planId: "recharge-plan-mock-500",
      creationIdempotencyKey: "recharge-instant-order",
    });
    const payment = {
      channel: "WECHAT",
      idempotencyKey: "recharge-instant-payment",
    };
    await request("POST", `/orders/${order.id}/pay`, payment);
    await request("POST", `/orders/${order.id}/pay`, payment);
    const accountsAfterPay = getMemberAccounts()["user-member"];
    expect(
      accountsAfterPay.find((item) => item.type === "CASH_PRINCIPAL")?.balance,
    ).toBe(178_000);
    expect(
      accountsAfterPay.find((item) => item.type === "GIFT_BALANCE")?.balance,
    ).toBe(22_500);
    expect(
      getMemberAccountTransactions().filter(
        (item) => item.orderId === order.id && item.reasonCode === "MEMBER_RECHARGE",
      ),
    ).toHaveLength(2);

    await login("FINANCE");
    const reconciliation = await request<any>(
      "GET",
      `/reconciliation/periods/${shanghaiDate()}`,
    );
    expect(reconciliation.totals).toMatchObject({
      orderPaidCents: 50_000,
      successfulPaymentCents: 50_000,
      completedRefundCents: 0,
    });

    await login("MEMBER");
    const refund = await request<any>("POST", `/orders/${order.id}/refunds`, {
      amountCents: order.payableCents,
      reason: "充值原路退回",
      idempotencyKey: "recharge-instant-refund",
    });
    await login("FINANCE");
    const approved = await request<any>(
      "POST",
      `/orders/refunds/${refund.id}/approve`,
      { reason: "余额完整可冲正" },
    );
    await request("POST", `/orders/refunds/${refund.id}/approve`, {
      reason: "重复回放",
    });
    expect(approved.status).toBe("SUCCEEDED");
    const accountsAfterRefund = getMemberAccounts()["user-member"];
    expect(
      accountsAfterRefund.find((item) => item.type === "CASH_PRINCIPAL")?.balance,
    ).toBe(128_000);
    expect(
      accountsAfterRefund.find((item) => item.type === "GIFT_BALANCE")?.balance,
    ).toBe(20_000);
    expect(
      getMemberAccountTransactions().filter(
        (item) => item.orderId === order.id && item.reasonCode === "RECHARGE_REFUND",
      ),
    ).toHaveLength(2);
  });

  it.each(["GAME_CANCEL:", "EVENT_CANCEL:", "EVENT_LATE_PAYMENT:"])(
    "does not expose generic rejection for forced refund prefix %s",
    async (prefix) => {
      const refund = {
        id: `forced-refund-${prefix}`,
        orderId: "forced-order",
        requestedById: "user-member",
        status: "REQUESTED",
        amountCents: 10_000,
        reason: "系统取消退款",
        originalOrderStatus: "PAID",
        idempotencyKey: `${prefix}fixture`,
        requestedAt: new Date().toISOString(),
      };
      storage.set("yanqing_mock_orders", [
        {
          id: "forced-order",
          orderNo: "FORCED-ORDER",
          memberId: "user-member",
          status: "REFUND_PENDING",
          businessType: "GAME",
          paidCents: 10_000,
          refundedCents: 0,
          refunds: [refund],
        },
      ]);
      await login("FINANCE");
      await expect(
        request("POST", `/orders/refunds/${refund.id}/reject`, {
          reason: "尝试驳回",
        }),
      ).rejects.toThrow("系统强制退款不可驳回");
    },
  );

  it("supports audited, idempotent admin plan creation and activation", async () => {
    await login("ADMIN");
    const command = {
      code: "RECHARGE_200",
      name: "充值200元赠10元",
      principalCents: 20_000,
      giftCents: 1_000,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2099-01-01T00:00:00.000Z",
      reason: "新增200元充值档位",
      idempotencyKey: "mock-recharge-plan-create",
    };
    const created = await request<any>(
      "POST",
      "/memberships/recharge-plans",
      command,
    );
    const replay = await request<any>(
      "POST",
      "/memberships/recharge-plans",
      command,
    );
    expect(replay).toEqual(created);
    expect(created).toMatchObject({
      code: command.code,
      version: 1,
      enabled: false,
      principalCents: command.principalCents,
      giftCents: command.giftCents,
    });
    expect(created).not.toHaveProperty("creationIdempotencyKey");
    expect(created).not.toHaveProperty("creationCommandHash");

    const statusCommand = {
      enabled: true,
      reason: "批准新档位上线",
      idempotencyKey: "mock-recharge-plan-enable",
    };
    const enabled = await request<any>(
      "POST",
      `/memberships/recharge-plans/${created.id}/status`,
      statusCommand,
    );
    const enabledReplay = await request<any>(
      "POST",
      `/memberships/recharge-plans/${created.id}/status`,
      statusCommand,
    );
    expect(enabled).toMatchObject({ enabled: true, idempotent: false });
    expect(enabledReplay).toMatchObject({ enabled: true, idempotent: true });
    expect(enabled.transition).not.toHaveProperty("idempotencyKey");
    expect(enabled.transition).not.toHaveProperty("commandHash");

    await login("MEMBER");
    expect(
      (await request<any[]>("GET", "/memberships/recharge-plans")).some(
        (plan) => plan.id === created.id,
      ),
    ).toBe(true);
  });

  it("blocks unsafe gifts and stopping the final currently-effective plan", async () => {
    await login("ADMIN");
    await expect(request("POST", "/memberships/recharge-plans", {
      code: "RECHARGE_UNSAFE",
      name: "不安全赠送计划",
      principalCents: 100,
      giftCents: 101,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2099-01-01T00:00:00.000Z",
      reason: "边界测试",
      idempotencyKey: "mock-recharge-plan-unsafe",
    })).rejects.toThrow("不得超过充值本金");

    const plans = await request<any[]>("GET", "/memberships/recharge-plans/manage");
    for (const [index, plan] of plans.slice(0, -1).entries()) {
      await request("POST", `/memberships/recharge-plans/${plan.id}/status`, {
        enabled: false,
        reason: "停用旧充值档位",
        idempotencyKey: `disable-recharge-plan-${index}`,
      });
    }
    const last = plans.at(-1)!;
    await expect(request("POST", `/memberships/recharge-plans/${last.id}/status`, {
      enabled: false,
      reason: "尝试关闭全部充值",
      idempotencyKey: "disable-final-recharge-plan",
    })).rejects.toThrow("最后一个当前有效充值计划");
  });

  it.each([
    ["PAID", null, 0, "PAID"],
    ["CHECKED_IN", null, 0, "CHECKED_IN"],
    ["COMPLETED", "2026-08-30T08:00:00.000Z", 0, "COMPLETED"],
    [
      "PARTIALLY_REFUNDED",
      "2026-08-30T08:00:00.000Z",
      1_000,
      "PARTIALLY_REFUNDED",
    ],
  ])("restores exact refund origin %s without changing completedAt", async (
    originalStatus,
    completedAt,
    refundedCents,
    expectedStatus,
  ) => {
    const order = {
      id: `refund-origin-${String(originalStatus).toLowerCase()}`,
      orderNo: `RF-ORIGIN-${originalStatus}`,
      memberId: "user-member",
      status: originalStatus,
      businessType: "VENUE",
      payableCents: 10_000,
      paidCents: 10_000,
      refundedCents,
      completedAt,
      refunds: [],
      parameterSnapshot: {},
      createdAt: new Date().toISOString(),
    };
    storage.set("yanqing_mock_orders", [order]);
    const refund = await request<any>("POST", `/orders/${order.id}/refunds`, {
      amountCents: 1_000,
      reason: "退款原状态测试",
      idempotencyKey: `mock-refund-origin-${String(originalStatus).toLowerCase()}`,
    });
    const storedRefund = getOrders()[0].refunds.find(
      (item: any) => item.id === refund.id,
    );
    expect(storedRefund.originalOrderStatus).toBe(originalStatus);

    await login("FINANCE");
    await request("POST", `/orders/refunds/${refund.id}/reject`, {
      reason: "证据不足驳回",
    });
    const restored = (await request<any>("GET", "/orders/admin/all")).items[0];
    expect(restored.status).toBe(expectedStatus);
    expect(restored.completedAt ?? null).toBe(completedAt);
  });
});
