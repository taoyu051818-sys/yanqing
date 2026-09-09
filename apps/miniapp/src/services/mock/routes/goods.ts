import { mockUser } from "../core";
import { buildMockGoodsOrderItemSnapshot } from "../consignment-settlement";
import { getOrders, saveOrders } from "../venue";
import { getGoods } from "../state";
import { ok, text, integer, newId } from "../policies/common.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../policies/orders.js";
import { mockOperatingShareSnapshot } from "../policies/master-data.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleGoodsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/goods")
    return {
      handled: true,
      value: ok(
        getGoods()
          .filter((item) => item.enabled !== false)
          .map((item) => ({
            id: item.id,
            sku: item.sku,
            name: item.name,
            category: item.category,
            salePriceCents: item.salePriceCents,
            stock: item.stock,
          })),
      ),
    };
  return { handled: false };
}

export async function handleGoodsOrdersPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/goods/orders" && method === "POST") {
    if (!Array.isArray(data.items) || !data.items.length)
      throw new Error("商品订单不能为空");
    const quantities = new Map<string, number>();
    for (const rawItem of data.items) {
      const itemId = text(rawItem?.itemId);
      const quantity = integer(rawItem?.quantity);
      if (
        !itemId ||
        !Number.isFinite(quantity) ||
        quantity < 1 ||
        quantity > 100
      )
        throw new Error("商品和数量无效");
      quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
    }
    const commandItems = [...quantities.entries()]
      .map(([itemId, quantity]) => ({ itemId, quantity }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "GOODS_ORDER",
      items: commandItems,
    });
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const products = getGoods().filter(
      (item) => quantities.has(item.id) && item.enabled !== false,
    );
    if (products.length !== quantities.size)
      throw new Error("部分商品不存在或已下架");
    const items = products.map((product) => {
      const quantity = quantities.get(product.id)!;
      if (Number(product.stock || 0) < quantity)
        throw new Error(`${product.name} 库存不足`);
      return {
        id: newId("order-item"),
        itemType: "INVENTORY_GOODS",
        itemId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.salePriceCents,
        amountCents: product.salePriceCents * quantity,
        metadata: buildMockGoodsOrderItemSnapshot(product),
      };
    });
    const amount = items.reduce((sum, item) => sum + item.amountCents, 0);
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("GD"),
      title: `场馆商品 ${items.length} 种`,
      status: "PENDING",
      businessType: "GOODS",
      listAmountCents: amount,
      payableCents: amount,
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      items,
      parameterSnapshot: {
        pricing: "SERVER_SNAPSHOT",
        itemCount: items.length,
        operatingShare: mockOperatingShareSnapshot("GOODS"),
      },
    };
    saveOrders([order, ...getOrders()]);
    return { handled: true, value: finishMockOrderCreation(creation, order) };
  }
  return { handled: false };
}
