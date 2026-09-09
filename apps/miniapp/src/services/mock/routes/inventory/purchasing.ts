import { mockUser } from "../../core";
import {
  getGoods,
  getInventorySuppliers,
  getInventoryLocations,
  getInventoryBalances,
  getPurchaseOrders,
  saveGoods,
  saveInventoryBalances,
  savePurchaseOrders,
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
  mockPurchaseReceiptResponse,
  mockPurchaseOrderResponse,
} from "../../policies/inventory.js";
import { newOrderNo } from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryPurchaseOrdersGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/purchase-orders" && method === "GET") {
    requireInventoryRead();
    return {
      handled: true,
      value: ok(getPurchaseOrders().map(mockPurchaseOrderResponse)),
    };
  }
  return { handled: false };
}

export async function handleInventoryPurchaseOrdersPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/purchase-orders" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const supplier = getInventorySuppliers().find(
      (entry) => entry.id === text(data.supplierId) && entry.enabled !== false,
    );
    const inputLines = Array.isArray(data.lines) ? data.lines : [];
    if (!supplier || !inputLines.length)
      throw new Error("供应商不存在或采购明细为空");
    const goods = getGoods();
    const locations = getInventoryLocations();
    const lines = inputLines.map((line: any) => {
      const item = goods.find(
        (entry) =>
          entry.id === text(line.itemId) &&
          entry.enabled !== false &&
          entry.supplierId === supplier.id &&
          ((supplier.type === "CONSIGNMENT" && entry.mode === "CONSIGNMENT") ||
            (supplier.type === "OWNED" && entry.mode === "PURCHASE")),
      );
      const location = locations.find(
        (entry) =>
          entry.id === text(line.locationId) && entry.enabled !== false,
      );
      const quantity = integer(line.orderedQuantity);
      if (!item || !location || quantity < 1)
        throw new Error("采购商品、库位或数量无效");
      return {
        id: newId("po-line"),
        itemId: item.id,
        item,
        locationId: location.id,
        location,
        orderedQuantity: quantity,
        receivedQuantity: 0,
        unitCostCents: integer(line.unitCostCents),
        batchCode: text(line.batchCode) || "DEFAULT",
        expiresAt: line.expiresAt || null,
      };
    });
    const keys = lines.map(
      (line: any) => `${line.itemId}:${line.locationId}:${line.batchCode}`,
    );
    if (new Set(keys).size !== keys.length) throw new Error("采购明细不能重复");
    const order = {
      id: newId("po"),
      orderNo: newOrderNo("PO"),
      status: "DRAFT",
      supplierId: supplier.id,
      supplier,
      lines,
      receipts: [],
      createdById: mockUser().id,
      createdAt: new Date().toISOString(),
      remark: text(data.remark) || null,
    };
    savePurchaseOrders([order, ...getPurchaseOrders()]);
    return { handled: true, value: ok(mockPurchaseOrderResponse(order)) };
  }
  return { handled: false };
}

export async function handlePurchaseActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const purchaseAction = url.match(
    /^\/inventory\/purchase-orders\/([^/]+)\/(submit|approve|receive|cancel)$/,
  );
  if (purchaseAction && method === "POST") {
    const orders = getPurchaseOrders();
    const order = orders.find((entry) => entry.id === purchaseAction[1]);
    if (!order) throw new Error("采购单不存在");
    const action = purchaseAction[2];
    if (action === "submit") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (order.status !== "DRAFT" && order.status !== "SUBMITTED")
        throw new Error("当前采购单不能提交");
      Object.assign(order, {
        status: "SUBMITTED",
        submittedById: mockUser().id,
        submittedAt: new Date().toISOString(),
      });
    } else if (action === "approve") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (order.status !== "SUBMITTED" && order.status !== "APPROVED")
        throw new Error("只有已提交采购单可以审批");
      if (
        order.status === "SUBMITTED" &&
        (order.createdById === mockUser().id ||
          order.submittedById === mockUser().id)
      )
        throw new Error("采购制单/提交人与审批人不能为同一账号");
      Object.assign(order, {
        status: "APPROVED",
        approvedById: mockUser().id,
        approvedAt: new Date().toISOString(),
      });
    } else if (action === "cancel") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (
        !["DRAFT", "SUBMITTED", "APPROVED", "CANCELLED"].includes(order.status)
      )
        throw new Error("已收货采购单不能取消");
      Object.assign(order, {
        status: "CANCELLED",
        cancelReason: text(data.reason),
        cancelledAt: new Date().toISOString(),
      });
    } else {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (!["APPROVED", "PARTIAL_RECEIVED"].includes(order.status))
        throw new Error("采购单未审批或已完成，不能收货");
      const key = requireIdempotencyKey(data.idempotencyKey, "收货幂等键");
      const previous = (order.receipts || []).find(
        (entry: any) => entry.idempotencyKey === key,
      );
      if (previous)
        return {
          handled: true,
          value: ok(mockPurchaseReceiptResponse(previous)),
        };
      const receiptLines = Array.isArray(data.lines) ? data.lines : [];
      if (
        !receiptLines.length ||
        new Set(receiptLines.map((entry: any) => entry.lineId)).size !==
          receiptLines.length
      )
        throw new Error("收货明细为空或重复");
      const liveSupplier = getInventorySuppliers().find(
        (entry) => entry.id === order.supplierId,
      );
      if (liveSupplier?.enabled === false)
        throw new Error("供应商已停用，不能继续收货");
      const goods = getGoods();
      const locations = getInventoryLocations();
      const balances = getInventoryBalances();
      for (const input of receiptLines) {
        const line = order.lines.find(
          (entry: any) => entry.id === text(input.lineId),
        );
        const quantity = integer(input.quantity);
        if (
          !line ||
          quantity < 1 ||
          quantity > line.orderedQuantity - line.receivedQuantity
        )
          throw new Error("收货数量超过采购未收数量");
        const item = goods.find((entry) => entry.id === line.itemId);
        const location = locations.find(
          (entry) => entry.id === line.locationId,
        );
        if (!item || item.enabled === false || location?.enabled === false)
          throw new Error("采购商品或收货库位不存在或已停用");
        let balance = balances.find(
          (entry) =>
            entry.itemId === line.itemId &&
            entry.locationId === line.locationId &&
            entry.batchCode === line.batchCode,
        );
        if (!balance) {
          balance = {
            id: newId("balance"),
            itemId: line.itemId,
            locationId: line.locationId,
            batchCode: line.batchCode,
            quantity: 0,
          };
          balances.push(balance);
        }
        item.stock = Number(item.stock || 0) + quantity;
        balance.quantity += quantity;
        line.receivedQuantity += quantity;
      }
      const receipt = {
        id: newId("receipt"),
        receiptNo: newOrderNo("PR"),
        purchaseOrderId: order.id,
        lines: receiptLines,
        idempotencyKey: key,
        operatorId: mockUser().id,
        receivedAt: new Date().toISOString(),
      };
      order.receipts = [receipt, ...(order.receipts || [])];
      order.status = order.lines.every(
        (line: any) => line.receivedQuantity >= line.orderedQuantity,
      )
        ? "RECEIVED"
        : "PARTIAL_RECEIVED";
      saveGoods(goods);
      saveInventoryBalances(balances);
      savePurchaseOrders(orders);
      return { handled: true, value: ok(mockPurchaseReceiptResponse(receipt)) };
    }
    savePurchaseOrders(orders);
    return { handled: true, value: ok(mockPurchaseOrderResponse(order)) };
  }
  return { handled: false };
}
