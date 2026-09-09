import { mockUser } from "../../core";
import {
  getGoods,
  getInventoryLocations,
  getInventoryBalances,
  getStocktakes,
  saveGoods,
  saveInventoryBalances,
  saveStocktakes,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import {
  requireInventoryRead,
  mockStocktakeResponse,
} from "../../policies/inventory.js";
import { newOrderNo } from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryStocktakesGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/stocktakes" && method === "GET") {
    requireInventoryRead();
    return {
      handled: true,
      value: ok(getStocktakes().map(mockStocktakeResponse)),
    };
  }
  return { handled: false };
}

export async function handleInventoryStocktakesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/stocktakes" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const location = getInventoryLocations().find(
      (entry) => entry.id === text(data.locationId) && entry.enabled !== false,
    );
    if (!location || text(data.reason).length < 2)
      throw new Error("盘点库位或原因无效");
    const stocktake = {
      id: newId("stocktake"),
      stocktakeNo: newOrderNo("ST"),
      status: "DRAFT",
      locationId: location.id,
      location,
      reason: text(data.reason),
      lines: [],
      createdById: mockUser().id,
      createdAt: new Date().toISOString(),
    };
    saveStocktakes([stocktake, ...getStocktakes()]);
    return { handled: true, value: ok(mockStocktakeResponse(stocktake)) };
  }
  return { handled: false };
}

export async function handleStocktakeCountPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const stocktakeCount = url.match(
    /^\/inventory\/stocktakes\/([^/]+)\/lines\/([^/]+)\/count$/,
  );
  if (stocktakeCount && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const list = getStocktakes();
    const stocktake = list.find((entry) => entry.id === stocktakeCount[1]);
    const line = stocktake?.lines.find(
      (entry: any) => entry.id === stocktakeCount[2],
    );
    const counted = integer(data.countedQuantity);
    if (!stocktake || stocktake.status !== "COUNTING" || !line || counted < 0)
      throw new Error("盘点单不在录数状态或数量无效");
    Object.assign(line, {
      countedQuantity: counted,
      difference: counted - line.bookQuantity,
    });
    saveStocktakes(list);
    return { handled: true, value: ok(line) };
  }
  return { handled: false };
}

export async function handleStocktakeActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const stocktakeAction = url.match(
    /^\/inventory\/stocktakes\/([^/]+)\/(start|submit|post)$/,
  );
  if (stocktakeAction && method === "POST") {
    const list = getStocktakes();
    const stocktake = list.find((entry) => entry.id === stocktakeAction[1]);
    if (!stocktake) throw new Error("盘点单不存在");
    const action = stocktakeAction[2];
    if (action === "start") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING")
        throw new Error("当前盘点单不能开始");
      if (stocktake.status === "DRAFT") {
        const balances = getInventoryBalances();
        const goods = getGoods().filter((item) => item.enabled !== false);
        stocktake.lines = goods.flatMap((item) => {
          const itemBalances = balances.filter(
            (entry) =>
              entry.itemId === item.id &&
              entry.locationId === stocktake.locationId,
          );
          const snapshots = itemBalances.length
            ? itemBalances
            : [{ batchCode: "DEFAULT", quantity: 0, expiresAt: null }];
          return snapshots.map((balance) => ({
            id: newId("stocktake-line"),
            itemId: item.id,
            item,
            batchCode: balance.batchCode || "DEFAULT",
            expiresAt: balance.expiresAt || null,
            bookQuantity: Number(balance.quantity || 0),
            countedQuantity: null,
            difference: null,
          }));
        });
        Object.assign(stocktake, {
          status: "COUNTING",
          startedAt: new Date().toISOString(),
        });
      }
    } else if (action === "submit") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (
        stocktake.status !== "COUNTING" ||
        stocktake.lines.some((line: any) => line.countedQuantity === null)
      )
        throw new Error("仍有盘点明细未录入");
      Object.assign(stocktake, {
        status: "REVIEW",
        submittedById: mockUser().id,
        submittedAt: new Date().toISOString(),
      });
    } else {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      const key = requireIdempotencyKey(data.idempotencyKey, "盘点过账幂等键");
      if (stocktake.status === "POSTED") {
        if (stocktake.postIdempotencyKey !== key)
          throw new Error("盘点单已过账");
        return { handled: true, value: ok(mockStocktakeResponse(stocktake)) };
      }
      if (stocktake.status !== "REVIEW") throw new Error("盘点单尚未提交复核");
      if (
        stocktake.createdById === mockUser().id ||
        stocktake.submittedById === mockUser().id
      )
        throw new Error("盘点制单/提交人与过账审批人不能为同一账号");
      const goods = getGoods();
      const balances = getInventoryBalances();
      for (const line of stocktake.lines) {
        const balance = balances.find(
          (entry) =>
            entry.itemId === line.itemId &&
            entry.locationId === stocktake.locationId &&
            entry.batchCode === line.batchCode,
        );
        if (Number(balance?.quantity || 0) !== line.bookQuantity)
          throw new Error("盘点期间库存已变化");
        const item = goods.find((entry) => entry.id === line.itemId);
        const difference = line.countedQuantity - line.bookQuantity;
        if (!item || Number(item.stock) + difference < 0)
          throw new Error("盘点差异会导致库存为负");
        item.stock += difference;
        if (balance) balance.quantity = line.countedQuantity;
      }
      Object.assign(stocktake, {
        status: "POSTED",
        postIdempotencyKey: key,
        reviewedById: mockUser().id,
        postedById: mockUser().id,
        postedAt: new Date().toISOString(),
      });
      saveGoods(goods);
      saveInventoryBalances(balances);
    }
    saveStocktakes(list);
    return { handled: true, value: ok(mockStocktakeResponse(stocktake)) };
  }
  return { handled: false };
}
