import {
  getGoods,
  getInventoryLocations,
  getInventoryBalances,
  getPurchaseOrders,
  getStocktakes,
  getInventoryOperations,
  saveInventoryLocations,
} from "../../state";
import { ok, requireMockRole, text, newId } from "../../policies/common.js";
import {
  requireInventoryRead,
  mockLocationContext,
} from "../../policies/inventory.js";
import {
  requireMasterReason,
  requireMasterVersion,
  nextMockUpdatedAt,
  replayMockMasterCommand,
  saveMockMasterAudit,
} from "../../policies/master-data.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryLocationsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/locations" && method === "GET") {
    requireInventoryRead();
    return {
      handled: true,
      value: ok(getInventoryLocations().map(mockLocationContext)),
    };
  }
  return { handled: false };
}

export async function handleInventoryLocationsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/locations" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const reason = requireMasterReason(data.reason);
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const command = { action: "create", code, name, reason };
    const replay = replayMockMasterCommand(
      "INVENTORY_LOCATION_CREATED",
      "InventoryLocation",
      data.idempotencyKey,
      command,
    );
    if (replay.objectId) {
      const existing = getInventoryLocations().find(
        (entry) => entry.id === replay.objectId,
      );
      if (!existing) throw new Error("幂等指令对应的库位不存在");
      return { handled: true, value: ok(mockLocationContext(existing)) };
    }
    if (
      code.length < 2 ||
      code.length > 40 ||
      name.length < 2 ||
      name.length > 80
    )
      throw new Error("库位编码或名称无效");
    const locations = getInventoryLocations();
    if (locations.some((entry) => text(entry.code).toUpperCase() === code))
      throw new Error("库位编码已存在");
    const timestamp = new Date().toISOString();
    const location = {
      id: newId("inventory-location"),
      code,
      name,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    saveInventoryLocations([location, ...locations]);
    saveMockMasterAudit({
      action: "INVENTORY_LOCATION_CREATED",
      objectType: "InventoryLocation",
      objectId: location.id,
      requestId: replay.requestId,
      commandHash: replay.commandHash,
      oldValue: null,
      newValue: location,
      reason,
    });
    return { handled: true, value: ok(mockLocationContext(location)) };
  }
  return { handled: false };
}

export async function handleLocationDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const locationDetailMatch = url.match(/^\/inventory\/locations\/([^/]+)$/);
  if (locationDetailMatch && method === "GET") {
    requireInventoryRead();
    const location = getInventoryLocations().find(
      (entry) => entry.id === locationDetailMatch[1],
    );
    if (!location) throw new Error("库位不存在");
    return { handled: true, value: ok(mockLocationContext(location)) };
  }
  return { handled: false };
}

export async function handleLocationMasterActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const locationMasterAction = url.match(
    /^\/inventory\/locations\/([^/]+)\/(update|status)$/,
  );
  if (locationMasterAction && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const locations = getInventoryLocations();
    const location = locations.find(
      (entry) => entry.id === locationMasterAction[1],
    );
    if (!location) throw new Error("库位不存在");
    const action = locationMasterAction[2];
    const reason = requireMasterReason(data.reason);
    const command = {
      action,
      id: location.id,
      expectedUpdatedAt: text(data.expectedUpdatedAt),
      reason,
      ...(action === "status"
        ? { enabled: data.enabled }
        : { code: data.code, name: data.name }),
    };
    const auditAction =
      action === "status"
        ? "INVENTORY_LOCATION_STATUS_CHANGED"
        : "INVENTORY_LOCATION_UPDATED";
    const replay = replayMockMasterCommand(
      auditAction,
      "InventoryLocation",
      data.idempotencyKey,
      command,
    );
    if (replay.objectId)
      return { handled: true, value: ok(mockLocationContext(location)) };
    requireMasterVersion(location, data.expectedUpdatedAt);
    const oldValue = ok(location);
    if (action === "status") {
      if (typeof data.enabled !== "boolean") throw new Error("库位状态无效");
      if (location.enabled === data.enabled)
        throw new Error(data.enabled ? "库位已经启用" : "库位已经停用");
      if (!data.enabled) {
        const stock = getInventoryBalances()
          .filter((entry) => entry.locationId === location.id)
          .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
        const defaultItems = getGoods().filter(
          (entry) =>
            entry.defaultLocationId === location.id && entry.enabled !== false,
        ).length;
        const purchaseLines = getPurchaseOrders()
          .flatMap((order) =>
            ["DRAFT", "SUBMITTED", "APPROVED", "PARTIAL_RECEIVED"].includes(
              order.status,
            )
              ? order.lines || []
              : [],
          )
          .filter((line: any) => line.locationId === location.id).length;
        const stocktakes = getStocktakes().filter(
          (entry) =>
            entry.locationId === location.id &&
            ["DRAFT", "COUNTING", "REVIEW"].includes(entry.status),
        ).length;
        const operations = getInventoryOperations().filter(
          (entry) =>
            (entry.sourceLocationId === location.id ||
              entry.targetLocationId === location.id) &&
            ["DRAFT", "SUBMITTED", "APPROVED"].includes(entry.status),
        ).length;
        const blockers = [
          stock ? `现存数量 ${stock}` : "",
          defaultItems ? `启用商品默认库位 ${defaultItems}` : "",
          purchaseLines ? `未完采购明细 ${purchaseLines}` : "",
          stocktakes ? `未完盘点单 ${stocktakes}` : "",
          operations ? `未过账库存单 ${operations}` : "",
        ].filter(Boolean);
        if (blockers.length)
          throw new Error(`库位暂不能停用：${blockers.join("、")}`);
      }
      location.enabled = data.enabled;
    } else {
      if (data.code === undefined && data.name === undefined)
        throw new Error("至少填写一个需要修改的库位字段");
      const nextCode =
        data.code === undefined ? location.code : text(data.code).toUpperCase();
      const nextName =
        data.name === undefined ? location.name : text(data.name);
      if (
        nextCode.length < 2 ||
        nextCode.length > 40 ||
        nextName.length < 2 ||
        nextName.length > 80
      )
        throw new Error("库位编码或名称无效");
      if (
        locations.some(
          (entry) =>
            entry.id !== location.id &&
            text(entry.code).toUpperCase() === nextCode,
        )
      )
        throw new Error("库位编码已存在");
      location.code = nextCode;
      location.name = nextName;
    }
    location.updatedAt = nextMockUpdatedAt(oldValue);
    saveInventoryLocations(locations);
    saveMockMasterAudit({
      action: auditAction,
      objectType: "InventoryLocation",
      objectId: location.id,
      requestId: replay.requestId,
      commandHash: replay.commandHash,
      oldValue,
      newValue: location,
      reason,
    });
    return { handled: true, value: ok(mockLocationContext(location)) };
  }
  return { handled: false };
}
