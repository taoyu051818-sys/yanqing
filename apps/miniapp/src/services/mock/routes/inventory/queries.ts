import { getGoods } from "../../state";
import { ok, requireMockRole } from "../../policies/common.js";
import {
  requireInventoryRead,
  mockInventoryItemContext,
} from "../../policies/inventory.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory" && method === "GET") {
    requireInventoryRead();
    return {
      handled: true,
      value: ok(getGoods().map(mockInventoryItemContext)),
    };
  }
  return { handled: false };
}

export async function handleInventoryAwardOptionsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/award-options" && method === "GET") {
    requireMockRole("FRONT_DESK", "EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        getGoods()
          .filter((item) => item.enabled !== false)
          .map((item) => ({
            id: item.id,
            sku: item.sku,
            name: item.name,
            stock: item.stock,
            enabled: item.enabled !== false,
          })),
      ),
    };
  }
  return { handled: false };
}

export async function handleInventoryLowStockGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/low-stock" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        getGoods()
          .filter(
            (item) => item.enabled !== false && item.stock <= item.safeStock,
          )
          .map((item) => ({
            id: item.id,
            sku: item.sku,
            name: item.name,
            mode: item.mode,
            stock: item.stock,
            safeStock: item.safeStock,
          })),
      ),
    };
  }
  return { handled: false };
}

export async function handleItemDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const itemDetailMatch = url.match(/^\/inventory\/items\/([^/]+)$/);
  if (itemDetailMatch && method === "GET") {
    requireInventoryRead();
    const item = getGoods().find((entry) => entry.id === itemDetailMatch[1]);
    if (!item) throw new Error("库存商品不存在");
    return { handled: true, value: ok(mockInventoryItemContext(item)) };
  }
  return { handled: false };
}
