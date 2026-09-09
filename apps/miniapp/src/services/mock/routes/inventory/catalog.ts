import { getOrders } from "../../venue";
import {
  getGoods,
  getInventorySuppliers,
  getInventoryLocations,
  getInventoryBalances,
  getPurchaseOrders,
  getStocktakes,
  getInventoryOperations,
  saveGoods,
  saveInventoryBalances,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  newId,
} from "../../policies/common.js";
import {
  requireMasterReason,
  requireMasterVersion,
  nextMockUpdatedAt,
  replayMockMasterCommand,
  saveMockMasterAudit,
} from "../../policies/master-data.js";
import { mockInventoryItemContext } from "../../policies/inventory.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const reason = requireMasterReason(data.reason);
    const mode = text(data.mode);
    const sku = text(data.sku).toUpperCase();
    const name = text(data.name);
    const category = text(data.category);
    const supplier = getInventorySuppliers().find(
      (entry) => entry.id === text(data.supplierId) && entry.enabled !== false,
    );
    const location = getInventoryLocations().find(
      (entry) =>
        entry.id === text(data.defaultLocationId) && entry.enabled !== false,
    );
    const purchasePriceCents = integer(data.purchasePriceCents);
    const salePriceCents = integer(data.salePriceCents);
    const safeStock = integer(data.safeStock ?? 0);
    const batchCode = text(data.batchCode) || "DEFAULT";
    const expiresAt = text(data.expiresAt) || null;
    const command = {
      action: "create",
      sku,
      name,
      category,
      mode,
      supplierId: supplier?.id,
      defaultLocationId: location?.id,
      purchasePriceCents,
      salePriceCents,
      safeStock,
      batchCode,
      expiresAt,
      reason,
    };
    const replay = replayMockMasterCommand(
      "INVENTORY_ITEM_CREATED",
      "InventoryItem",
      data.idempotencyKey,
      command,
    );
    if (replay.objectId) {
      const existing = getGoods().find((entry) => entry.id === replay.objectId);
      if (!existing) throw new Error("幂等指令对应的商品不存在");
      return { handled: true, value: ok(mockInventoryItemContext(existing)) };
    }
    if (
      !sku ||
      sku.length > 60 ||
      !name ||
      name.length > 120 ||
      !category ||
      category.length > 80 ||
      !["PURCHASE", "CONSIGNMENT"].includes(mode)
    )
      throw new Error("SKU、名称、分类或经营模式无效");
    if (!supplier || !location)
      throw new Error("供应商或默认库位不存在或已停用");
    if (
      (mode === "CONSIGNMENT" && supplier.type !== "CONSIGNMENT") ||
      (mode === "PURCHASE" && supplier.type !== "OWNED")
    )
      throw new Error("SKU 经营模式与供应商类型不一致");
    if (
      [purchasePriceCents, salePriceCents, safeStock].some(
        (value) => !Number.isInteger(value) || value < 0,
      )
    )
      throw new Error("进价、售价和安全库存必须为非负整数");
    if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime()))
      throw new Error("批次效期无效");
    const goods = getGoods();
    if (goods.some((entry) => text(entry.sku).toUpperCase() === sku))
      throw new Error("SKU 编码已存在");
    const timestamp = new Date().toISOString();
    const item = {
      id: newId("goods"),
      sku,
      name,
      category,
      mode,
      supplier: supplier.name,
      supplierId: supplier.id,
      defaultLocationId: location.id,
      purchasePriceCents,
      salePriceCents,
      stock: 0,
      safeStock,
      batchCode,
      expiresAt,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const existingBalances = getInventoryBalances();
    saveGoods([item, ...goods]);
    saveInventoryBalances([
      {
        id: newId("balance"),
        itemId: item.id,
        locationId: location.id,
        batchCode,
        expiresAt,
        quantity: 0,
      },
      ...existingBalances,
    ]);
    saveMockMasterAudit({
      action: "INVENTORY_ITEM_CREATED",
      objectType: "InventoryItem",
      objectId: item.id,
      requestId: replay.requestId,
      commandHash: replay.commandHash,
      oldValue: null,
      newValue: item,
      reason,
    });
    return { handled: true, value: ok(mockInventoryItemContext(item)) };
  }
  return { handled: false };
}

export async function handleItemMasterActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const itemMasterAction = url.match(
    /^\/inventory\/items\/([^/]+)\/(update|status)$/,
  );
  if (itemMasterAction && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const goods = getGoods();
    const item = goods.find((entry) => entry.id === itemMasterAction[1]);
    if (!item) throw new Error("库存商品不存在");
    const action = itemMasterAction[2];
    const reason = requireMasterReason(data.reason);
    const command = {
      action,
      id: item.id,
      expectedUpdatedAt: text(data.expectedUpdatedAt),
      reason,
      ...(action === "status"
        ? { enabled: data.enabled }
        : {
            sku: data.sku,
            name: data.name,
            category: data.category,
            mode: data.mode,
            supplierId: data.supplierId,
            defaultLocationId: data.defaultLocationId,
            purchasePriceCents: data.purchasePriceCents,
            salePriceCents: data.salePriceCents,
            safeStock: data.safeStock,
            batchCode: data.batchCode,
            expiresAt: data.expiresAt,
          }),
    };
    const auditAction =
      action === "status"
        ? "INVENTORY_ITEM_STATUS_CHANGED"
        : "INVENTORY_ITEM_UPDATED";
    const replay = replayMockMasterCommand(
      auditAction,
      "InventoryItem",
      data.idempotencyKey,
      command,
    );
    if (replay.objectId)
      return { handled: true, value: ok(mockInventoryItemContext(item)) };
    requireMasterVersion(item, data.expectedUpdatedAt);
    const oldValue = ok(item);
    if (action === "status") {
      if (typeof data.enabled !== "boolean") throw new Error("商品状态无效");
      if (item.enabled === data.enabled)
        throw new Error(data.enabled ? "商品已经启用" : "商品已经停用");
      if (!data.enabled) {
        const openPurchaseLines = getPurchaseOrders()
          .flatMap((order) =>
            ["DRAFT", "SUBMITTED", "APPROVED", "PARTIAL_RECEIVED"].includes(
              order.status,
            )
              ? order.lines || []
              : [],
          )
          .filter((line: any) => line.itemId === item.id).length;
        const openStocktakes = getStocktakes().filter(
          (entry) =>
            ["DRAFT", "COUNTING", "REVIEW"].includes(entry.status) &&
            (entry.lines || []).some((line: any) => line.itemId === item.id),
        ).length;
        const openOperations = getInventoryOperations().filter(
          (entry) =>
            entry.itemId === item.id &&
            ["DRAFT", "SUBMITTED", "APPROVED"].includes(entry.status),
        ).length;
        const pendingOrders = getOrders().filter(
          (order) =>
            order.businessType === "GOODS" &&
            order.status === "PENDING" &&
            (order.items || []).some((line: any) => line.itemId === item.id),
        ).length;
        const blockers = [
          Number(item.stock || 0) !== 0 ? `现存库存 ${item.stock}` : "",
          openPurchaseLines ? `未完采购明细 ${openPurchaseLines}` : "",
          openStocktakes ? `未完盘点单 ${openStocktakes}` : "",
          openOperations ? `未过账库存单 ${openOperations}` : "",
          pendingOrders ? `待支付商品订单 ${pendingOrders}` : "",
        ].filter(Boolean);
        if (blockers.length)
          throw new Error(`商品暂不能停用：${blockers.join("、")}`);
      } else {
        const supplier = getInventorySuppliers().find(
          (entry) => entry.id === item.supplierId && entry.enabled !== false,
        );
        const location = getInventoryLocations().find(
          (entry) =>
            entry.id === item.defaultLocationId && entry.enabled !== false,
        );
        if (!supplier || !location)
          throw new Error("供应商或默认库位已停用，不能启用商品");
      }
      item.enabled = data.enabled;
    } else {
      const mutableKeys = [
        "sku",
        "name",
        "category",
        "mode",
        "supplierId",
        "defaultLocationId",
        "purchasePriceCents",
        "salePriceCents",
        "safeStock",
        "batchCode",
        "expiresAt",
      ];
      if (mutableKeys.every((key) => data[key] === undefined))
        throw new Error("至少填写一个需要修改的商品字段");
      const nextMode = data.mode === undefined ? item.mode : text(data.mode);
      const nextSupplierId =
        data.supplierId === undefined ? item.supplierId : text(data.supplierId);
      const nextLocationId =
        data.defaultLocationId === undefined
          ? item.defaultLocationId
          : text(data.defaultLocationId);
      const supplier = getInventorySuppliers().find(
        (entry) => entry.id === nextSupplierId && entry.enabled !== false,
      );
      const location = getInventoryLocations().find(
        (entry) => entry.id === nextLocationId && entry.enabled !== false,
      );
      if (!supplier || !location)
        throw new Error("供应商或默认库位不存在或已停用");
      if (
        (nextMode === "CONSIGNMENT" && supplier.type !== "CONSIGNMENT") ||
        (nextMode === "PURCHASE" && supplier.type !== "OWNED")
      )
        throw new Error("SKU 经营模式与供应商类型不一致");
      const nextBatch =
        data.batchCode === undefined
          ? item.batchCode
          : text(data.batchCode) || "DEFAULT";
      const nextExpiresAt =
        data.expiresAt === undefined
          ? item.expiresAt
          : text(data.expiresAt) || null;
      if (
        Number(item.stock || 0) !== 0 &&
        (nextLocationId !== item.defaultLocationId ||
          nextBatch !== (item.batchCode || "DEFAULT") ||
          nextExpiresAt !== item.expiresAt)
      )
        throw new Error("有库存时不能变更默认库位、批次或效期，请先清零");
      if (data.sku !== undefined) {
        const sku = text(data.sku).toUpperCase();
        if (
          !sku ||
          sku.length > 60 ||
          goods.some((entry) => entry.id !== item.id && entry.sku === sku)
        )
          throw new Error("SKU 编码为空或已存在");
        item.sku = sku;
      }
      if (data.name !== undefined) {
        const name = text(data.name);
        if (!name || name.length > 120) throw new Error("商品名称无效");
        item.name = name;
      }
      if (data.category !== undefined) {
        const category = text(data.category);
        if (!category || category.length > 80) throw new Error("商品分类无效");
        item.category = category;
      }
      if (data.mode !== undefined) item.mode = nextMode;
      if (data.supplierId !== undefined) {
        item.supplierId = supplier.id;
        item.supplier = supplier.name;
      }
      if (data.defaultLocationId !== undefined)
        item.defaultLocationId = location.id;
      for (const key of ["purchasePriceCents", "salePriceCents", "safeStock"]) {
        if (data[key] === undefined) continue;
        const value = integer(data[key]);
        if (!Number.isInteger(value) || value < 0)
          throw new Error("价格与安全库存必须为非负整数");
        item[key] = value;
      }
      if (data.batchCode !== undefined) item.batchCode = nextBatch;
      if (data.expiresAt !== undefined) {
        if (
          nextExpiresAt &&
          !Number.isFinite(new Date(nextExpiresAt).getTime())
        )
          throw new Error("批次效期无效");
        item.expiresAt = nextExpiresAt;
      }
      if (
        Number(item.stock || 0) === 0 &&
        (nextLocationId !== oldValue.defaultLocationId ||
          nextBatch !== oldValue.batchCode ||
          nextExpiresAt !== oldValue.expiresAt)
      ) {
        saveInventoryBalances([
          {
            id: newId("balance"),
            itemId: item.id,
            locationId: nextLocationId,
            batchCode: nextBatch,
            expiresAt: nextExpiresAt,
            quantity: 0,
          },
          ...getInventoryBalances().filter(
            (entry) =>
              entry.itemId !== item.id || Number(entry.quantity || 0) !== 0,
          ),
        ]);
      }
    }
    item.updatedAt = nextMockUpdatedAt(oldValue);
    saveGoods(goods);
    saveMockMasterAudit({
      action: auditAction,
      objectType: "InventoryItem",
      objectId: item.id,
      requestId: replay.requestId,
      commandHash: replay.commandHash,
      oldValue,
      newValue: item,
      reason,
    });
    return { handled: true, value: ok(mockInventoryItemContext(item)) };
  }
  return { handled: false };
}
