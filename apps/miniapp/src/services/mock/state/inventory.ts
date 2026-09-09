import { goods as seedGoods } from "../catalog";
import { type JsonRecord, KEYS, read, write } from "./storage.js";

export function getGoods(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.goods,
    (seedGoods as JsonRecord[]).map((item) => ({
      ...item,
      supplierId:
        item.mode === "CONSIGNMENT" ? "supplier-consignment" : "supplier-owned",
      defaultLocationId: "inventory-location-main",
      batchCode: "DEFAULT",
      expiresAt: null,
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    })),
  );
}

export function saveGoods(value: JsonRecord[]) {
  return write(KEYS.goods, value);
}

export function getInventoryTransactions() {
  return read<JsonRecord[]>(KEYS.inventoryTransactions, []);
}

export function saveInventoryTransactions(value: JsonRecord[]) {
  return write(KEYS.inventoryTransactions, value);
}

export function getInventorySuppliers() {
  return read<JsonRecord[]>(KEYS.inventorySuppliers, [
    {
      id: "supplier-owned",
      code: "OWNED-01",
      name: "金羽自营采购",
      type: "OWNED",
      contactName: "采购经理",
      contactPhone: "13800000001",
      settlementRule: {
        settlementCycle: "MONTHLY",
        paymentTermsDays: 30,
      },
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    {
      id: "supplier-consignment",
      code: "CONSIGN-01",
      name: "合作品牌寄售",
      type: "CONSIGNMENT",
      contactName: "品牌经理",
      contactPhone: "13800000002",
      settlementRule: {
        settlementCycle: "MONTHLY",
        commissionRateBps: 2500,
      },
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ]);
}

export function saveInventorySuppliers(value: JsonRecord[]) {
  return write(KEYS.inventorySuppliers, value);
}

export function getInventoryLocations() {
  return read<JsonRecord[]>(KEYS.inventoryLocations, [
    {
      id: "inventory-location-main",
      code: "MAIN",
      name: "主仓",
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    {
      id: "inventory-location-front",
      code: "FRONT",
      name: "前台展示仓",
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ]);
}

export function saveInventoryLocations(value: JsonRecord[]) {
  return write(KEYS.inventoryLocations, value);
}

export function getInventoryBalances() {
  return read<JsonRecord[]>(
    KEYS.inventoryBalances,
    getGoods().map((item) => ({
      id: `balance-${item.id}-main`,
      itemId: item.id,
      locationId: "inventory-location-main",
      batchCode: "DEFAULT",
      quantity: Number(item.stock || 0),
    })),
  );
}

export function saveInventoryBalances(value: JsonRecord[]) {
  return write(KEYS.inventoryBalances, value);
}

export function getPurchaseOrders() {
  return read<JsonRecord[]>(KEYS.purchaseOrders, []);
}

export function savePurchaseOrders(value: JsonRecord[]) {
  return write(KEYS.purchaseOrders, value);
}

export function getStocktakes() {
  return read<JsonRecord[]>(KEYS.stocktakes, []);
}

export function saveStocktakes(value: JsonRecord[]) {
  return write(KEYS.stocktakes, value);
}

export function getInventoryOperations() {
  return read<JsonRecord[]>(KEYS.inventoryOperations, []);
}

export function saveInventoryOperations(value: JsonRecord[]) {
  return write(KEYS.inventoryOperations, value);
}
