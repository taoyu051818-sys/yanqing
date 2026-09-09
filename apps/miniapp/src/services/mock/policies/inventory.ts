import {
  getGoods,
  getInventoryTransactions,
  getInventorySuppliers,
  getInventoryLocations,
  getInventoryBalances,
  getPurchaseOrders,
  getStocktakes,
  getInventoryOperations,
} from "../state";
import { requireMockRole, text, integer } from "./common.js";

export const requireInventoryRead = () =>
  requireMockRole("ADMIN", "SUPER_ADMIN");

export const mockSupplierRule = (type: string, value: any) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("供应商必须配置结算规则");
  if (!["PER_ORDER", "WEEKLY", "MONTHLY"].includes(text(value.settlementCycle)))
    throw new Error("结算周期必须为逐单、周结或月结");
  if (type === "CONSIGNMENT") {
    const rate = integer(value.commissionRateBps);
    if (!Number.isInteger(rate) || rate < 0 || rate > 10_000)
      throw new Error("寄售供应商必须配置0-10000的分成基点");
  } else {
    const days = integer(value.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365)
      throw new Error("自营采购供应商必须配置0-365天账期");
  }
};

export const applyMockInventoryDelta = (
  item: any,
  balances: any[],
  quantity: number,
) => {
  const locationId = text(item.defaultLocationId);
  const batchCode = text(item.batchCode) || "DEFAULT";
  if (!locationId) throw new Error(`${item.name} 未配置默认库位`);
  const balance = balances.find(
    (entry) =>
      entry.itemId === item.id &&
      entry.locationId === locationId &&
      (text(entry.batchCode) || "DEFAULT") === batchCode,
  );
  if (!balance) throw new Error(`${item.name} 默认库位余额未初始化`);
  const total = balances
    .filter((entry) => entry.itemId === item.id)
    .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  if (total !== Number(item.stock || 0))
    throw new Error(`${item.name} 库存总账与库位分账不一致，请先盘点`);
  const stockAfter = Number(item.stock || 0) + quantity;
  const balanceAfter = Number(balance.quantity || 0) + quantity;
  if (stockAfter < 0 || balanceAfter < 0)
    throw new Error(`${item.name} 库存不足`);
  const stockBefore = Number(item.stock || 0);
  item.stock = stockAfter;
  balance.quantity = balanceAfter;
  return { stockBefore, stockAfter, locationId, batchCode };
};

export const mockInventoryTransactionResponse = (transaction: any) =>
  Object.fromEntries(
    Object.entries({
      id: transaction.id,
      itemId: transaction.itemId,
      type: transaction.type,
      quantity: transaction.quantity,
      stockBefore: transaction.stockBefore,
      stockAfter: transaction.stockAfter,
      unitCostCents: transaction.unitCostCents,
      orderItemId: transaction.orderItemId,
      reason: transaction.reason,
      createdAt: transaction.createdAt,
    }).filter(([, value]) => value !== undefined),
  );

export const mockPurchaseReceiptResponse = (receipt: any) => {
  const {
    idempotencyKey: _idempotencyKey,
    operatorId: _operatorId,
    ...response
  } = receipt;
  return response;
};

export const mockPurchaseOrderResponse = (order: any) => ({
  ...order,
  receipts: Array.isArray(order.receipts)
    ? order.receipts.map(mockPurchaseReceiptResponse)
    : [],
});

export const mockStocktakeResponse = (stocktake: any) => {
  const { postIdempotencyKey: _postIdempotencyKey, ...response } = stocktake;
  return response;
};

export const mockInventoryOperationResponse = (operation: any) => {
  const {
    postIdempotencyKey: _postIdempotencyKey,
    sourceTransactionId: _sourceTransactionId,
    targetTransactionId: _targetTransactionId,
    ...response
  } = operation;
  return response;
};

export const mockInventoryItemContext = (item: any) => {
  const suppliers = getInventorySuppliers();
  const locations = getInventoryLocations();
  return {
    ...item,
    supplierRecord:
      suppliers.find((entry) => entry.id === item.supplierId) || null,
    defaultLocation:
      locations.find((entry) => entry.id === item.defaultLocationId) || null,
    stockBalances: getInventoryBalances()
      .filter((entry) => entry.itemId === item.id)
      .map((entry) => ({
        ...entry,
        location: locations.find(
          (location) => location.id === entry.locationId,
        ),
      })),
    transactions: getInventoryTransactions()
      .filter((entry) => entry.itemId === item.id)
      .slice(0, 20)
      .map(mockInventoryTransactionResponse),
    purchaseOrderLines: getPurchaseOrders()
      .flatMap((order) =>
        (order.lines || [])
          .filter((line: any) => line.itemId === item.id)
          .map((line: any) => ({
            ...line,
            purchaseOrder: mockPurchaseOrderResponse(order),
          })),
      )
      .slice(0, 10),
    inventoryDocuments: getInventoryOperations()
      .filter((entry) => entry.itemId === item.id)
      .slice(0, 10)
      .map(mockInventoryOperationResponse),
  };
};

export const mockSupplierContext = (supplier: any) => {
  const items = getGoods().filter((entry) => entry.supplierId === supplier.id);
  const purchaseOrders = getPurchaseOrders()
    .filter((entry) => entry.supplierId === supplier.id)
    .slice(0, 10)
    .map(mockPurchaseOrderResponse);
  return {
    ...supplier,
    items: items.map(mockInventoryItemContext),
    purchaseOrders,
    _count: { items: items.length, purchaseOrders: purchaseOrders.length },
  };
};

export const mockLocationContext = (location: any) => {
  const goods = getGoods();
  const balances = getInventoryBalances()
    .filter((entry) => entry.locationId === location.id)
    .map((entry) => ({
      ...entry,
      item: goods.find((item) => item.id === entry.itemId),
    }));
  const defaultItems = goods.filter(
    (entry) => entry.defaultLocationId === location.id,
  );
  const stocktakes = getStocktakes()
    .filter((entry) => entry.locationId === location.id)
    .slice(0, 10)
    .map(mockStocktakeResponse);
  const operations = getInventoryOperations();
  return {
    ...location,
    stockBalances: balances,
    defaultItems,
    stocktakes,
    sourceOperations: operations
      .filter((entry) => entry.sourceLocationId === location.id)
      .slice(0, 10)
      .map(mockInventoryOperationResponse),
    targetOperations: operations
      .filter((entry) => entry.targetLocationId === location.id)
      .slice(0, 10)
      .map(mockInventoryOperationResponse),
    _count: {
      stockBalances: balances.length,
      defaultItems: defaultItems.length,
      stocktakes: stocktakes.length,
      purchaseOrderLines: getPurchaseOrders()
        .flatMap((entry) => entry.lines || [])
        .filter((line: any) => line.locationId === location.id).length,
    },
  };
};
