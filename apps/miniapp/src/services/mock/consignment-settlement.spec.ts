import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMockGoodsOrderItemSnapshot,
  recordMockConsignmentRefund,
  recordMockConsignmentSale,
} from "./consignment-settlement";
import { mockRequest } from "./router";
import {
  getAuditLogs,
  getConsignmentPayableEntries,
  getGoods,
  getInventorySuppliers,
  resetCatalogState,
  saveGoods,
  saveInventoryTransactions,
  saveInventorySuppliers,
} from "./state";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);

const login = (role: string) =>
  request("POST", "/auth/dev-login", { role });

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

describe("mock consignment payable and settlement workflow", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("FINANCE");
  });

  it("records only consignment lines and appends an exact idempotent refund reversal", () => {
    const goods = getGoods();
    const consignment = goods.find((item) => item.mode === "CONSIGNMENT")!;
    const owned = goods.find((item) => item.mode === "PURCHASE")!;
    const now = new Date().toISOString();
    const order: any = {
      id: "order-consignment-mixed",
      orderNo: "GD-CONSIGN-MIXED",
      businessType: "GOODS",
      status: "PAID",
      paidAt: now,
      paidCents: 19_100,
      refundedCents: 0,
      items: [
        {
          id: "order-item-consignment",
          itemId: consignment.id,
          name: consignment.name,
          quantity: 2,
          unitPriceCents: consignment.salePriceCents,
          amountCents: consignment.salePriceCents * 2,
          metadata: buildMockGoodsOrderItemSnapshot(consignment),
        },
        {
          id: "order-item-owned",
          itemId: owned.id,
          name: owned.name,
          quantity: 2,
          unitPriceCents: owned.salePriceCents,
          amountCents: owned.salePriceCents * 2,
          metadata: buildMockGoodsOrderItemSnapshot(owned),
        },
      ],
    };
    saveInventoryTransactions([
      {
        id: "sale-out-consignment",
        type: "SALE_OUT",
        orderItemId: "order-item-consignment",
        quantity: -2,
      },
      {
        id: "sale-out-owned",
        type: "SALE_OUT",
        orderItemId: "order-item-owned",
        quantity: -2,
      },
    ]);

    const first = recordMockConsignmentSale(order);
    const replay = recordMockConsignmentSale(order);
    expect(first).toHaveLength(1);
    expect(replay).toEqual(first);
    expect(first[0]).toMatchObject({
      type: "SALE",
      orderId: order.id,
      itemId: consignment.id,
      quantity: 2,
      grossSaleCents: 3_000,
      commissionRateBps: 2_500,
      commissionCents: 750,
      payableCents: 2_250,
    });
    expect(
      getConsignmentPayableEntries().filter(
        (entry) => entry.orderId === order.id,
      ),
    ).toHaveLength(1);
    expect(order.completedAt).toBe(now);

    order.status = "REFUNDED";
    order.refundedCents = order.paidCents;
    const refund = {
      id: "refund-consignment-mixed",
      refundNo: "RF-CONSIGN-MIXED",
      status: "SUCCEEDED",
      completedAt: new Date().toISOString(),
      reason: "整单退货并完成入库",
    };
    const reversed = recordMockConsignmentRefund(order, refund);
    const reversedReplay = recordMockConsignmentRefund(order, refund);
    expect(reversedReplay).toEqual(reversed);
    expect(reversed).toEqual([
      expect.objectContaining({
        type: "REFUND_REVERSAL",
        refundId: refund.id,
        reversalOfId: first[0].id,
        quantity: -2,
        grossSaleCents: -3_000,
        commissionCents: -750,
        payableCents: -2_250,
      }),
    ]);
    expect(
      getConsignmentPayableEntries().filter(
        (entry) => entry.orderId === order.id,
      ),
    ).toHaveLength(2);
    expect(
      getAuditLogs().filter((entry) =>
        String(entry.action).startsWith("CONSIGNMENT_PAYABLE_"),
      ),
    ).toHaveLength(2);
  });

  it("connects goods payment and full refund terminals to the payable ledger", async () => {
    await login("MEMBER");
    const goods = getGoods();
    const consignment = goods.find((item) => item.mode === "CONSIGNMENT")!;
    const owned = goods.find((item) => item.mode === "PURCHASE")!;
    const order = await request("POST", "/goods/orders", {
      items: [
        { itemId: consignment.id, quantity: 2 },
        { itemId: owned.id, quantity: 1 },
      ],
      creationIdempotencyKey: "mock-consignment-order-create-1",
    });
    expect(
      order.items.find((item: any) => item.itemId === consignment.id)?.metadata,
    ).toMatchObject({
      inventorySnapshotVersion: 1,
      mode: "CONSIGNMENT",
      supplierId: "supplier-consignment",
      supplierCode: "CONSIGN-01",
      supplierName: "合作品牌寄售",
      settlementRule: {
        settlementCycle: "MONTHLY",
        commissionRateBps: 2_500,
      },
    });

    const suppliers = getInventorySuppliers();
    const originalSupplier = suppliers.find(
      (item) => item.id === "supplier-consignment",
    )!;
    originalSupplier.settlementRule = {
      settlementCycle: "WEEKLY",
      commissionRateBps: 8_000,
    };
    saveInventorySuppliers(suppliers);
    consignment.mode = "PURCHASE";
    consignment.supplierId = "supplier-owned";
    consignment.supplier = "金羽自营采购";
    saveGoods(goods);

    const paymentCommand = {
      channel: "WECHAT",
      idempotencyKey: "mock-consignment-order-payment-1",
    };
    await request("POST", `/orders/${order.id}/pay`, paymentCommand);
    await expect(
      request("POST", `/orders/${order.id}/pay`, paymentCommand),
    ).resolves.toMatchObject({ status: "SUCCESS", idempotent: true });
    let orderEntries = getConsignmentPayableEntries().filter(
      (entry) => entry.orderId === order.id,
    );
    expect(orderEntries).toEqual([
      expect.objectContaining({
        type: "SALE",
        itemId: consignment.id,
        quantity: 2,
        grossSaleCents: 3_000,
        payableCents: 2_250,
      }),
    ]);
    await login("FINANCE");
    const paidSnapshot = await request<any>(
      "GET",
      `/reconciliation/periods/${shanghaiDate()}`,
    );
    expect(paidSnapshot.totals.consignmentPayableCents).toBe(2_250);

    await login("MEMBER");
    const refund = await request("POST", `/orders/${order.id}/refunds`, {
      amountCents: order.payableCents,
      reason: "混合商品整单原样退回",
      idempotencyKey: "mock-consignment-order-refund-1",
    });
    await login("FINANCE");
    const approved = await request(
      "POST",
      `/orders/refunds/${refund.id}/approve`,
      { reason: "确认全部商品完成退货入库" },
    );
    await expect(
      request("POST", `/orders/refunds/${refund.id}/approve`, {
        reason: "重复回调不得再次反冲应付",
      }),
    ).resolves.toEqual(approved);
    orderEntries = getConsignmentPayableEntries().filter(
      (entry) => entry.orderId === order.id,
    );
    expect(orderEntries).toHaveLength(2);
    expect(orderEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "SALE", payableCents: 2_250 }),
        expect.objectContaining({
          type: "REFUND_REVERSAL",
          refundId: refund.id,
          quantity: -2,
          grossSaleCents: -3_000,
          commissionCents: -750,
          payableCents: -2_250,
        }),
      ]),
    );
    const refundedSnapshot = await request<any>(
      "GET",
      `/reconciliation/periods/${shanghaiDate()}`,
    );
    expect(refundedSnapshot.totals.consignmentPayableCents).toBe(0);
  });

  it("runs void/versioning, dispute, return and maker-checker settlement states", async () => {
    const periodStart = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const periodEnd = new Date(Date.now() + 86_400_000).toISOString();
    const createCommand = {
      supplierId: "supplier-consignment",
      periodStart,
      periodEnd,
      reason: "核对寄售供应商周期应付",
      idempotencyKey: "mock-consignment-create-1",
    };
    const firstDraft = await request(
      "POST",
      "/inventory/consignment/settlements",
      createCommand,
    );
    await expect(
      request("POST", "/inventory/consignment/settlements", createCommand),
    ).resolves.toEqual(firstDraft);
    expect(firstDraft).toMatchObject({
      status: "DRAFT",
      version: 1,
      entryCount: 1,
      payableCents: 2_250,
      createdById: "user-finance",
    });
    expect(
      (
        await request<any[]>("GET", "/work-items")
      ).some(
        (item) =>
          item.kind === "CONSIGNMENT_SETTLEMENT" &&
          item.objectId === firstDraft.id,
      ),
    ).toBe(true);

    const voided = await request(
      "POST",
      `/inventory/consignment/settlements/${firstDraft.id}/void`,
      {
        reason: "演练作废后重建版本",
        idempotencyKey: "mock-consignment-void-1",
      },
    );
    expect(voided).toMatchObject({ status: "VOID" });
    expect(voided.lines.every((line: any) => Boolean(line.releasedAt))).toBe(
      true,
    );

    const draft = await request(
      "POST",
      "/inventory/consignment/settlements",
      {
        ...createCommand,
        reason: "作废旧版后重新冻结应付明细",
        idempotencyKey: "mock-consignment-create-2",
      },
    );
    expect(draft).toMatchObject({ status: "DRAFT", version: 2 });
    const payablePage = await request<any>(
      "GET",
      "/inventory/consignment/payables",
      { supplierId: "supplier-consignment" },
    );
    expect(payablePage.items[0].settlementLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          settlement: expect.objectContaining({
            id: draft.id,
            status: "DRAFT",
          }),
        }),
      ]),
    );

    const submitted = await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/submit`,
      {
        reason: "应付明细与合同佣金核对完成",
        idempotencyKey: "mock-consignment-submit-1",
      },
    );
    expect(submitted.status).toBe("PENDING_CONFIRMATION");
    await expect(
      request(
        "POST",
        `/inventory/consignment/settlements/${draft.id}/confirm`,
        {
          reason: "制单人尝试自行复核",
          idempotencyKey: "mock-consignment-confirm-self",
        },
      ),
    ).rejects.toThrow("制单人不能");

    await login("ADMIN");
    const disputed = await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/dispute`,
      {
        reason: "供应商要求补充销售明细凭证",
        idempotencyKey: "mock-consignment-dispute-1",
      },
    );
    expect(disputed.status).toBe("DRAFT");

    await login("FINANCE");
    await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/submit`,
      {
        reason: "已补齐供应商对账凭证",
        idempotencyKey: "mock-consignment-submit-2",
      },
    );
    await login("ADMIN");
    const confirmed = await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/confirm`,
      {
        reason: "复核明细与供应商确认一致",
        idempotencyKey: "mock-consignment-confirm-1",
      },
    );
    expect(confirmed.status).toBe("CONFIRMED");
    const returned = await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/return`,
      {
        reason: "付款前发现凭证编号待更正",
        idempotencyKey: "mock-consignment-return-1",
      },
    );
    expect(returned.status).toBe("DRAFT");

    await login("FINANCE");
    await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/submit`,
      {
        reason: "付款凭证编号已经更正",
        idempotencyKey: "mock-consignment-submit-3",
      },
    );
    await login("ADMIN");
    await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/confirm`,
      {
        reason: "二次复核通过等待付款",
        idempotencyKey: "mock-consignment-confirm-2",
      },
    );
    const settlementCommand = {
      reason: "银行付款回单已复核",
      paymentReference: "BANK-CONSIGN-20260830-01",
      idempotencyKey: "mock-consignment-settle-1",
    };
    const settled = await request(
      "POST",
      `/inventory/consignment/settlements/${draft.id}/settle`,
      settlementCommand,
    );
    expect(settled).toMatchObject({
      status: "SETTLED",
      paymentReference: "BANK-CONSIGN-20260830-01",
    });
    await expect(
      request(
        "POST",
        `/inventory/consignment/settlements/${draft.id}/settle`,
        settlementCommand,
      ),
    ).resolves.toMatchObject({ status: "SETTLED" });
    expect(
      (
        await request<any[]>("GET", "/work-items")
      ).some((item) => item.objectId === draft.id),
    ).toBe(false);

    await login("MEMBER");
    await expect(
      request("GET", "/inventory/consignment/payables"),
    ).rejects.toThrow("仅财务或管理员");
  });
});
