import { beforeEach, expect, it, vi } from "vitest";
import { mockRequest } from "./router";
import {
  getGames,
  saveGames,
  getEvents,
  getEventDetail,
  saveEventDetail,
  getMemberAccounts,
  getMemberAccountTransactions,
  getGoods,
  getInventoryBalances,
  getStocktakes,
  getTrainingSettlements,
  getConsignmentSettlements,
  saveConsignmentSettlements,
  getAuditLogs,
  saveStocktakes,
  saveTrainingSettlements,
  resetCatalogState,
} from "./state";
import { getOrders, saveOrders } from "./venue";
const storage = new Map<string, unknown>();
vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) || "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});
const request = (method: string, url: string, data: any = {}) =>
  mockRequest<any>(method, url, data);
beforeEach(() => {
  storage.clear();
  resetCatalogState();
});
it.each(["ADMIN", "SUPER_ADMIN"])(
  "%s adjusts an account once without a second approval screen",
  async (role) => {
    await request("POST", "/auth/dev-login", { role });
    const accounts = getMemberAccounts();
    const memberId = Object.keys(accounts)[0];
    const account = accounts[memberId].find(
      (row: any) => row.type === "CASH_PRINCIPAL",
    )!;
    const before = account.balance;
    const count = getMemberAccountTransactions().length;
    const dto = {
      accountType: account.type,
      amount: 100,
      reason: "补录现金凭证",
      idempotencyKey: "account-direct-execution",
    };
    const first = await request(
      "POST",
      `/members/${memberId}/accounts/adjust`,
      dto,
    );
    expect(first.status).toBe("POSTED");
    expect(
      (await request("POST", `/members/${memberId}/accounts/adjust`, dto)).id,
    ).toBe(first.id);
    expect(
      getMemberAccounts()[memberId].find((row: any) => row.id === account.id)
        ?.balance,
    ).toBe(before + 100);
    expect(getMemberAccountTransactions()).toHaveLength(count + 1);
  },
);

it("rejects empty consignment payment evidence before changing a draft", async () => {
  await request("POST", "/auth/dev-login", { role: "ADMIN" });
  saveConsignmentSettlements([
    { id: "atomic", status: "DRAFT", transitions: [] },
  ]);
  await expect(
    request("POST", "/inventory/consignment/settlements/atomic/settle", {
      reason: "核对付款",
      idempotencyKey: "atomic-command",
      paymentReference: "   ",
    }),
  ).rejects.toThrow("付款凭证");
  expect(getConsignmentSettlements()[0]).toMatchObject({
    status: "DRAFT",
    transitions: [],
  });
});

it("rolls back consignment intermediate transitions and audit when the final command conflicts", async () => {
  await request("POST", "/auth/dev-login", { role: "ADMIN" });
  const actor = await request("GET", "/auth/me");
  const draft = {
    id: "atomic",
    status: "DRAFT",
    createdById: actor.id,
    supplierId: "isolated",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-02",
    entryCount: 1,
    netQuantity: 1,
    grossSaleCents: 1000,
    commissionCents: 200,
    payableCents: 800,
    lines: [
      {
        payableEntryId: "isolated-entry",
        quantity: 1,
        grossSaleCents: 1000,
        commissionCents: 200,
        payableCents: 800,
      },
    ],
    transitions: [],
  };
  saveConsignmentSettlements([
    draft,
    {
      id: "other",
      transitions: [{ idempotencyKey: "already-used-final-key" }],
    },
  ]);
  const auditBefore = getAuditLogs();
  await expect(
    request("POST", "/inventory/consignment/settlements/atomic/settle", {
      reason: "核对付款",
      idempotencyKey: "already-used-final-key",
      paymentReference: "BANK-001",
    }),
  ).rejects.toThrow("幂等键");
  expect(getConsignmentSettlements()[0]).toEqual(draft);
  expect(getAuditLogs()).toEqual(auditBefore);
});

it("rolls back training intermediate phases on a final idempotency conflict", async () => {
  await request("POST", "/auth/dev-login", { role: "ADMIN" });
  const actor = await request("GET", "/auth/me");
  const draft = {
    id: "atomic-training",
    status: "DRAFT",
    createdById: actor.id,
    periodStart: "2026-07-01T00:00:00Z",
    periodEnd: "2026-07-02T00:00:00Z",
    workflowHistory: [],
    processedIdempotencyKeys: {
      "already-used-final-key": "TRAINING_SETTLEMENT_RETURNED",
    },
  };
  saveTrainingSettlements([draft] as any);
  await expect(
    request("POST", "/training/settlements/atomic-training/settle", {
      reason: "核对付款",
      idempotencyKey: "already-used-final-key",
    }),
  ).rejects.toThrow("幂等键");
  expect(getTrainingSettlements()[0]).toEqual(draft);
});
it("finance still submits an account adjustment for another authorized reviewer", async () => {
  await request("POST", "/auth/dev-login", { role: "FINANCE" });
  const accounts = getMemberAccounts(),
    id = Object.keys(accounts)[0];
  const account = accounts[id][0];
  const result = await request("POST", `/members/${id}/accounts/adjust`, {
    accountType: account.type,
    amount: 100,
    reason: "补录凭证",
    idempotencyKey: "finance-request-key",
  });
  expect(result.status).toBe("REQUESTED");
  await expect(
    request("POST", `/members/account-adjustments/${result.id}/approve`, {
      reason: "自行复核",
    }),
  ).rejects.toThrow("不能是同一账号");
});
it.each(["ADMIN", "SUPER_ADMIN"])(
  "%s counts and posts its own stocktake without posting twice on retry",
  async (role) => {
    await request("POST", "/auth/dev-login", { role });
    const balance = getInventoryBalances().find(
      (row: any) => row.quantity > 0,
    )!;
    const item = getGoods().find((row: any) => row.id === balance.itemId)!;
    const stock = item.stock;
    const actorId = (await request("GET", "/auth/me")).id;
    saveStocktakes([
      {
        id: "counted",
        stocktakeNo: "COUNTED",
        status: "COUNTING",
        locationId: balance.locationId,
        createdById: actorId,
        lines: [
          {
            id: "line",
            itemId: item.id,
            batchCode: balance.batchCode,
            bookQuantity: balance.quantity,
            countedQuantity: balance.quantity - 1,
          },
        ],
      },
    ] as any);
    expect(
      (await request("POST", "/inventory/stocktakes/counted/submit")).status,
    ).toBe("POSTED");
    expect(
      (await request("POST", "/inventory/stocktakes/counted/submit")).status,
    ).toBe("POSTED");
    expect(getGoods().find((row: any) => row.id === item.id)?.stock).toBe(
      stock - 1,
    );
    expect(getStocktakes()[0].status).toBe("POSTED");
  },
);
it.each(["ADMIN", "SUPER_ADMIN"])(
  "%s directly settles its own training draft and keeps three history records",
  async (role) => {
    await request("POST", "/auth/dev-login", { role });
    const actor = await request("GET", "/auth/me");
    saveTrainingSettlements([
      {
        id: "direct-settlement",
        status: "DRAFT",
        createdById: actor.id,
        periodStart: "2026-07-01T00:00:00Z",
        periodEnd: "2026-07-02T00:00:00Z",
        workflowHistory: [],
      },
    ] as any);
    const dto = {
      reason: "已核对账期凭证",
      idempotencyKey: "direct-training-key",
    };
    expect(
      (
        await request(
          "POST",
          "/training/settlements/direct-settlement/settle",
          dto,
        )
      ).status,
    ).toBe("SETTLED");
    expect(
      (
        await request(
          "POST",
          "/training/settlements/direct-settlement/settle",
          dto,
        )
      ).status,
    ).toBe("SETTLED");
    expect(getTrainingSettlements()[0].workflowHistory).toHaveLength(3);
  },
);

it.each(["games", "events"])(
  "administrator cancellation of %s refunds new and existing pending amounts without touching unrelated orders",
  async (kind) => {
    await request("POST", "/auth/dev-login", { role: "ADMIN" });
    const source =
      kind === "games" ? getGames()[0] : getEventDetail(getEvents()[0].id);
    const activity = {
      ...source,
      id: String(source.id),
      status: "OPEN",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const participant = {
      id: "paid-entry",
      status: "PAID",
      orderId: "activity-order",
      captainId: "user-member",
      memberId: "user-member",
    };
    if (kind === "games")
      saveGames([{ ...activity, registrations: [participant] }] as any);
    else saveEventDetail({ ...activity, teams: [participant] } as any);
    const oldRefund = {
      id: "previous-refund",
      orderId: "activity-order",
      amountCents: 1000,
      status: "REQUESTED",
      originalOrderStatus: "PAID",
      idempotencyKey: "ordinary-member-request",
    };
    saveOrders([
      {
        id: "activity-order",
        memberId: "user-member",
        businessType: kind === "games" ? "GAME" : "EVENT",
        status: "REFUND_PENDING",
        paidCents: 5000,
        payableCents: 5000,
        refundedCents: 0,
        refunds: [oldRefund],
        items: [],
      },
      {
        id: "unrelated",
        memberId: "user-member",
        businessType: "VENUE",
        status: "PAID",
        paidCents: 5000,
        refundedCents: 0,
        refunds: [],
        items: [],
      },
    ]);
    const dto = {
      reason: "场馆临时停电",
      idempotencyKey: "cancel-activity-direct",
    };
    await request("POST", `/${kind}/${activity.id}/cancel`, dto);
    await request("POST", `/${kind}/${activity.id}/cancel`, dto);
    const orders = getOrders();
    expect(orders[0]).toMatchObject({
      status: "REFUNDED",
      refundedCents: 5000,
    });
    expect(orders[0].refunds).toHaveLength(2);
    expect(
      orders[0].refunds.every((row: any) => row.status === "SUCCEEDED"),
    ).toBe(true);
    expect(orders[1]).toMatchObject({ status: "PAID", refundedCents: 0 });
  },
);
