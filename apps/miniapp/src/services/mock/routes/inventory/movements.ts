import { mockUser } from "../../core";
import {
  getGoods,
  getInventoryLocations,
  getInventoryBalances,
  getInventoryOperations,
  saveGoods,
  saveInventoryBalances,
  saveInventoryOperations,
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
  mockInventoryOperationResponse,
} from "../../policies/inventory.js";
import { newOrderNo } from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryOperationsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/operations" && method === "GET") {
    requireInventoryRead();
    return {
      handled: true,
      value: ok(getInventoryOperations().map(mockInventoryOperationResponse)),
    };
  }
  return { handled: false };
}

export async function handleInventoryOperationsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/operations" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const item = getGoods().find(
      (entry) => entry.id === text(data.itemId) && entry.enabled !== false,
    );
    const locations = getInventoryLocations();
    const source = locations.find(
      (entry) =>
        entry.id === text(data.sourceLocationId) && entry.enabled !== false,
    );
    const target = locations.find(
      (entry) =>
        entry.id === text(data.targetLocationId) && entry.enabled !== false,
    );
    const type = text(data.type);
    const quantity = integer(data.quantity);
    if (
      !item ||
      !source ||
      !["TRANSFER", "LOSS"].includes(type) ||
      quantity < 1 ||
      text(data.reason).length < 2 ||
      (type === "TRANSFER" && (!target || target.id === source.id)) ||
      (type === "LOSS" && target)
    )
      throw new Error("调拨/报损单参数无效");
    const operation = {
      id: newId("inventory-op"),
      documentNo: newOrderNo(type === "TRANSFER" ? "TR" : "LS"),
      status: "DRAFT",
      type,
      itemId: item.id,
      item,
      quantity,
      sourceLocationId: source.id,
      sourceLocation: source,
      targetLocationId: target?.id || null,
      targetLocation: target || null,
      batchCode: text(data.batchCode) || "DEFAULT",
      reason: text(data.reason),
      referenceType: text(data.referenceType) || null,
      referenceId: text(data.referenceId) || null,
      createdById: mockUser().id,
      createdAt: new Date().toISOString(),
    };
    saveInventoryOperations([operation, ...getInventoryOperations()]);
    return {
      handled: true,
      value: ok(mockInventoryOperationResponse(operation)),
    };
  }
  return { handled: false };
}

export async function handleOperationActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const operationAction = url.match(
    /^\/inventory\/operations\/([^/]+)\/(submit|approve|post|cancel)$/,
  );
  if (operationAction && method === "POST") {
    const list = getInventoryOperations();
    const operation = list.find((entry) => entry.id === operationAction[1]);
    if (!operation) throw new Error("库存业务单不存在");
    const action = operationAction[2];
    if (action === "submit") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (!["DRAFT", "SUBMITTED"].includes(operation.status))
        throw new Error("业务单不能提交");
      Object.assign(operation, {
        status: "SUBMITTED",
        submittedAt: new Date().toISOString(),
      });
    } else if (action === "approve") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (!["SUBMITTED", "APPROVED"].includes(operation.status))
        throw new Error("业务单尚未提交");
      if (
        operation.status === "SUBMITTED" &&
        operation.createdById === mockUser().id
      )
        throw new Error("库存业务制单人与审批人不能为同一账号");
      Object.assign(operation, {
        status: "APPROVED",
        approvedById: mockUser().id,
        approvedAt: new Date().toISOString(),
      });
    } else if (action === "cancel") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (operation.status === "POSTED")
        throw new Error("已过账业务单不能取消");
      Object.assign(operation, {
        status: "CANCELLED",
        cancelReason: text(data.reason),
      });
    } else {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      const key = requireIdempotencyKey(
        data.idempotencyKey,
        "业务单过账幂等键",
      );
      if (operation.status === "POSTED") {
        if (operation.postIdempotencyKey !== key)
          throw new Error("业务单已过账");
        return {
          handled: true,
          value: ok(mockInventoryOperationResponse(operation)),
        };
      }
      if (operation.status !== "APPROVED") throw new Error("业务单尚未审批");
      const goods = getGoods();
      const item = goods.find((entry) => entry.id === operation.itemId);
      const locations = getInventoryLocations();
      const liveSource = locations.find(
        (entry) => entry.id === operation.sourceLocationId,
      );
      const liveTarget = operation.targetLocationId
        ? locations.find((entry) => entry.id === operation.targetLocationId)
        : null;
      if (
        item?.enabled === false ||
        liveSource?.enabled === false ||
        liveTarget?.enabled === false
      )
        throw new Error("商品或库位已停用，不能过账");
      const balances = getInventoryBalances();
      const source = balances.find(
        (entry) =>
          entry.itemId === operation.itemId &&
          entry.locationId === operation.sourceLocationId &&
          entry.batchCode === operation.batchCode,
      );
      if (!item || !source || source.quantity < operation.quantity)
        throw new Error("来源库位库存不足");
      source.quantity -= operation.quantity;
      if (operation.type === "TRANSFER") {
        let target = balances.find(
          (entry) =>
            entry.itemId === operation.itemId &&
            entry.locationId === operation.targetLocationId &&
            entry.batchCode === operation.batchCode,
        );
        if (!target) {
          target = {
            id: newId("balance"),
            itemId: operation.itemId,
            locationId: operation.targetLocationId,
            batchCode: operation.batchCode,
            quantity: 0,
          };
          balances.push(target);
        }
        target.quantity += operation.quantity;
      } else {
        item.stock -= operation.quantity;
      }
      Object.assign(operation, {
        status: "POSTED",
        postIdempotencyKey: key,
        postedById: mockUser().id,
        postedAt: new Date().toISOString(),
      });
      saveGoods(goods);
      saveInventoryBalances(balances);
    }
    saveInventoryOperations(list);
    return {
      handled: true,
      value: ok(mockInventoryOperationResponse(operation)),
    };
  }
  return { handled: false };
}
