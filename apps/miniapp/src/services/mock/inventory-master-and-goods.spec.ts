import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getGoods,
  getInventoryTransactions,
  resetCatalogState,
} from "./state";
import { getOrders } from "./venue";

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

const login = (role: string) => request("POST", "/auth/dev-login", { role });

describe("inventory master data and goods stock equivalence", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("ADMIN");
  });

  it("operates supplier, location and SKU through versioned audited commands", async () => {
    const supplierCommand = {
      code: "consign-new",
      name: "北方品牌寄售",
      type: "CONSIGNMENT",
      contactName: "张经理",
      contactPhone: "13800000009",
      settlementRule: {
        settlementCycle: "MONTHLY",
        commissionRateBps: 2800,
      },
      reason: "新增寄售合作方",
      idempotencyKey: "mock-supplier-create-1",
    };
    const supplier = await request(
      "POST",
      "/inventory/suppliers",
      supplierCommand,
    );
    await expect(
      request("POST", "/inventory/suppliers", supplierCommand),
    ).resolves.toEqual(supplier);
    await login("SUPER_ADMIN");
    await expect(
      request("POST", "/inventory/suppliers", supplierCommand),
    ).rejects.toThrow("其他操作人");
    await login("ADMIN");

    const location = await request("POST", "/inventory/locations", {
      code: "POPUP",
      name: "活动临时仓",
      reason: "增加活动库存库位",
      idempotencyKey: "mock-location-create-1",
    });
    const item = await request("POST", "/inventory", {
      sku: "GRIP-POPUP-1",
      name: "活动寄售手胶",
      category: "手胶",
      mode: "CONSIGNMENT",
      supplierId: supplier.id,
      defaultLocationId: location.id,
      purchasePriceCents: 900,
      salePriceCents: 1600,
      safeStock: 5,
      batchCode: "DEFAULT",
      reason: "配置活动寄售 SKU",
      idempotencyKey: "mock-item-create-1",
    });
    expect(item).toMatchObject({
      enabled: true,
      supplierRecord: { id: supplier.id },
      defaultLocation: { id: location.id },
      stockBalances: [expect.objectContaining({ quantity: 0 })],
    });

    const updated = await request(
      "POST",
      `/inventory/items/${item.id}/update`,
      {
        salePriceCents: 1800,
        safeStock: 8,
        expectedUpdatedAt: item.updatedAt,
        reason: "调整活动售价和安全库存",
        idempotencyKey: "mock-item-update-1",
      },
    );
    expect(updated).toMatchObject({ salePriceCents: 1800, safeStock: 8 });
    await expect(
      request("POST", `/inventory/items/${item.id}/update`, {
        name: "   ",
        expectedUpdatedAt: updated.updatedAt,
        reason: "尝试写入空白名称",
        idempotencyKey: "mock-item-update-blank-1",
      }),
    ).rejects.toThrow("商品名称无效");
    await expect(
      request("POST", `/inventory/items/${item.id}/update`, {
        salePriceCents: 1900,
        expectedUpdatedAt: item.updatedAt,
        reason: "使用过期版本修改",
        idempotencyKey: "mock-item-update-stale-1",
      }),
    ).rejects.toThrow("已被其他账号修改");

    const disabled = await request(
      "POST",
      `/inventory/items/${item.id}/status`,
      {
        enabled: false,
        expectedUpdatedAt: updated.updatedAt,
        reason: "活动结束停止经营",
        idempotencyKey: "mock-item-disable-1",
      },
    );
    expect(disabled.enabled).toBe(false);
    const publicGoods = await request<any[]>("GET", "/goods");
    expect(publicGoods.some((entry) => entry.id === item.id)).toBe(false);

    await login("FINANCE");
    await expect(
      request("GET", `/inventory/items/${item.id}`),
    ).rejects.toThrow("当前角色无权");
    await expect(
      request("POST", `/inventory/items/${item.id}/status`, {
        enabled: true,
        expectedUpdatedAt: disabled.updatedAt,
        reason: "财务越权启用",
        idempotencyKey: "mock-item-finance-enable-1",
      }),
    ).rejects.toThrow("当前角色无权");
  });

  it("prevents deactivation while business documents or balances still depend on master data", async () => {
    await login("ADMIN");
    const [item] = await request<any[]>("GET", "/inventory");
    const supplier = item.supplierRecord;
    const location = item.defaultLocation;
    const purchaseOrder = await request("POST", "/inventory/purchase-orders", {
      supplierId: supplier.id,
      lines: [
        {
          itemId: item.id,
          locationId: location.id,
          orderedQuantity: 2,
          unitCostCents: item.purchasePriceCents,
          batchCode: item.batchCode,
        },
      ],
    });
    expect(purchaseOrder.status).toBe("DRAFT");

    await login("ADMIN");
    const currentSupplier = await request(
      "GET",
      `/inventory/suppliers/${supplier.id}`,
    );
    await expect(
      request("POST", `/inventory/suppliers/${supplier.id}/status`, {
        enabled: false,
        expectedUpdatedAt: currentSupplier.updatedAt,
        reason: "尝试停用未完采购供应商",
        idempotencyKey: "mock-supplier-disable-block-1",
      }),
    ).rejects.toThrow("未完采购单");

    const currentLocation = await request(
      "GET",
      `/inventory/locations/${location.id}`,
    );
    await expect(
      request("POST", `/inventory/locations/${location.id}/status`, {
        enabled: false,
        expectedUpdatedAt: currentLocation.updatedAt,
        reason: "尝试停用仍有库存库位",
        idempotencyKey: "mock-location-disable-block-1",
      }),
    ).rejects.toThrow("库位暂不能停用");
  });

  it("posts exactly one SALE_OUT on payment and exactly one full return on refund", async () => {
    await login("MEMBER");
    const [product] = await request<any[]>("GET", "/goods");
    const stockBefore = Number(product.stock);
    const order = await request("POST", "/goods/orders", {
      items: [{ itemId: product.id, quantity: 2 }],
      creationIdempotencyKey: "mock-goods-order-create-1",
    });
    expect(getGoods().find((entry) => entry.id === product.id)?.stock).toBe(
      stockBefore,
    );

    const paymentCommand = {
      channel: "WECHAT",
      idempotencyKey: "mock-goods-payment-1",
    };
    const payment = await request(
      "POST",
      `/orders/${order.id}/pay`,
      paymentCommand,
    );
    await expect(
      request("POST", `/orders/${order.id}/pay`, paymentCommand),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(getGoods().find((entry) => entry.id === product.id)?.stock).toBe(
      stockBefore - 2,
    );
    expect(
      getInventoryTransactions().filter(
        (entry) =>
          entry.type === "SALE_OUT" && entry.metadata?.orderId === order.id,
      ),
    ).toHaveLength(1);
    expect(payment.status).toBe("SUCCEEDED");

    await expect(
      request("POST", `/orders/${order.id}/refunds`, {
        amountCents: order.payableCents / 2,
        reason: "尝试金额型部分退货",
        idempotencyKey: "mock-goods-partial-refund-1",
      }),
    ).rejects.toThrow("整单退货");
    expect(getGoods().find((entry) => entry.id === product.id)?.stock).toBe(
      stockBefore - 2,
    );
    const refund = await request("POST", `/orders/${order.id}/refunds`, {
      amountCents: order.payableCents,
      reason: "商品原样退回",
      idempotencyKey: "mock-goods-full-refund-1",
    });

    await login("FINANCE");
    const approved = await request(
      "POST",
      `/orders/refunds/${refund.id}/approve`,
      { reason: "确认商品可二次销售" },
    );
    await expect(
      request("POST", `/orders/refunds/${refund.id}/approve`, {
        reason: "重复审批不重复回库",
      }),
    ).resolves.toEqual(approved);
    expect(approved).toMatchObject({
      status: "SUCCEEDED",
    });
    expect(approved).not.toHaveProperty("returnDisposition");
    expect(
      getOrders()
        .find((item) => item.id === order.id)
        ?.refunds?.find((item: any) => item.id === refund.id),
    ).toMatchObject({ returnDisposition: "RESALABLE_RETURN" });
    expect(getGoods().find((entry) => entry.id === product.id)?.stock).toBe(
      stockBefore,
    );
    const returns = getInventoryTransactions().filter(
      (entry) =>
        entry.type === "ADJUSTMENT" && entry.metadata?.refundId === refund.id,
    );
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({
      quantity: 2,
      orderItemId: order.items[0].id,
    });
  });
});
