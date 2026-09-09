import {
  getGoods,
  getInventorySuppliers,
  getPurchaseOrders,
  saveGoods,
  saveInventorySuppliers,
} from "../../state";
import { ok, requireMockRole, text, newId } from "../../policies/common.js";
import {
  requireInventoryRead,
  mockSupplierRule,
  mockSupplierContext,
} from "../../policies/inventory.js";
import {
  requireMasterReason,
  requireMasterVersion,
  nextMockUpdatedAt,
  replayMockMasterCommand,
  saveMockMasterAudit,
} from "../../policies/master-data.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventorySuppliersGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/suppliers" && method === "GET") {
    requireInventoryRead();
    return {
      handled: true,
      value: ok(getInventorySuppliers().map(mockSupplierContext)),
    };
  }
  return { handled: false };
}

export async function handleInventorySuppliersPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/inventory/suppliers" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const reason = requireMasterReason(data.reason);
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const type = text(data.type);
    const contactName = text(data.contactName) || null;
    const contactPhone = text(data.contactPhone) || null;
    const settlementRule = data.settlementRule;
    const command = {
      action: "create",
      code,
      name,
      type,
      contactName,
      contactPhone,
      settlementRule,
      reason,
    };
    const replay = replayMockMasterCommand(
      "SUPPLIER_CREATED",
      "Supplier",
      data.idempotencyKey,
      command,
    );
    if (replay.objectId) {
      const existing = getInventorySuppliers().find(
        (entry) => entry.id === replay.objectId,
      );
      if (!existing) throw new Error("幂等指令对应的供应商不存在");
      return { handled: true, value: ok(mockSupplierContext(existing)) };
    }
    if (
      code.length < 2 ||
      code.length > 40 ||
      name.length < 2 ||
      name.length > 120 ||
      !["OWNED", "CONSIGNMENT"].includes(type)
    )
      throw new Error("供应商编码、名称或类型无效");
    mockSupplierRule(type, settlementRule);
    const suppliers = getInventorySuppliers();
    if (suppliers.some((entry) => text(entry.code).toUpperCase() === code))
      throw new Error("供应商编码已存在");
    const timestamp = new Date().toISOString();
    const supplier = {
      id: newId("supplier"),
      code,
      name,
      type,
      contactName,
      contactPhone,
      settlementRule,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    saveInventorySuppliers([supplier, ...suppliers]);
    saveMockMasterAudit({
      action: "SUPPLIER_CREATED",
      objectType: "Supplier",
      objectId: supplier.id,
      requestId: replay.requestId,
      commandHash: replay.commandHash,
      oldValue: null,
      newValue: supplier,
      reason,
    });
    return { handled: true, value: ok(mockSupplierContext(supplier)) };
  }
  return { handled: false };
}

export async function handleSupplierDetailGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const supplierDetailMatch = url.match(/^\/inventory\/suppliers\/([^/]+)$/);
  if (supplierDetailMatch && method === "GET") {
    requireInventoryRead();
    const supplier = getInventorySuppliers().find(
      (entry) => entry.id === supplierDetailMatch[1],
    );
    if (!supplier) throw new Error("供应商不存在");
    return { handled: true, value: ok(mockSupplierContext(supplier)) };
  }
  return { handled: false };
}

export async function handleSupplierMasterActionPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const supplierMasterAction = url.match(
    /^\/inventory\/suppliers\/([^/]+)\/(update|status)$/,
  );
  if (supplierMasterAction && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const suppliers = getInventorySuppliers();
    const supplier = suppliers.find(
      (entry) => entry.id === supplierMasterAction[1],
    );
    if (!supplier) throw new Error("供应商不存在");
    const action = supplierMasterAction[2];
    const reason = requireMasterReason(data.reason);
    const command = {
      action,
      id: supplier.id,
      expectedUpdatedAt: text(data.expectedUpdatedAt),
      reason,
      ...(action === "status"
        ? { enabled: data.enabled }
        : {
            code: data.code,
            name: data.name,
            type: data.type,
            contactName: data.contactName,
            contactPhone: data.contactPhone,
            settlementRule: data.settlementRule,
          }),
    };
    const auditAction =
      action === "status" ? "SUPPLIER_STATUS_CHANGED" : "SUPPLIER_UPDATED";
    const replay = replayMockMasterCommand(
      auditAction,
      "Supplier",
      data.idempotencyKey,
      command,
    );
    if (replay.objectId)
      return { handled: true, value: ok(mockSupplierContext(supplier)) };
    requireMasterVersion(supplier, data.expectedUpdatedAt);
    const oldValue = ok(supplier);
    if (action === "status") {
      if (typeof data.enabled !== "boolean") throw new Error("供应商状态无效");
      if (supplier.enabled === data.enabled)
        throw new Error(data.enabled ? "供应商已经启用" : "供应商已经停用");
      if (!data.enabled) {
        const openOrders = getPurchaseOrders().filter(
          (entry) =>
            entry.supplierId === supplier.id &&
            ["DRAFT", "SUBMITTED", "APPROVED", "PARTIAL_RECEIVED"].includes(
              entry.status,
            ),
        ).length;
        const enabledItems = getGoods().filter(
          (entry) =>
            entry.supplierId === supplier.id && entry.enabled !== false,
        ).length;
        const blockers = [
          enabledItems ? `仍启用 SKU ${enabledItems}` : "",
          openOrders ? `未完采购单 ${openOrders}` : "",
        ].filter(Boolean);
        if (blockers.length)
          throw new Error(`供应商暂不能停用：${blockers.join("、")}`);
      }
      supplier.enabled = data.enabled;
    } else {
      const mutableKeys = [
        "code",
        "name",
        "type",
        "contactName",
        "contactPhone",
        "settlementRule",
      ];
      if (mutableKeys.every((key) => data[key] === undefined))
        throw new Error("至少填写一个需要修改的供应商字段");
      const nextCode =
        data.code === undefined ? supplier.code : text(data.code).toUpperCase();
      const nextName =
        data.name === undefined ? supplier.name : text(data.name);
      const nextType =
        data.type === undefined ? supplier.type : text(data.type);
      const nextRule =
        data.settlementRule === undefined
          ? supplier.settlementRule
          : data.settlementRule;
      if (
        nextCode.length < 2 ||
        nextCode.length > 40 ||
        nextName.length < 2 ||
        nextName.length > 120 ||
        !["OWNED", "CONSIGNMENT"].includes(nextType)
      )
        throw new Error("供应商编码、名称或类型无效");
      mockSupplierRule(nextType, nextRule);
      if (
        suppliers.some(
          (entry) =>
            entry.id !== supplier.id &&
            text(entry.code).toUpperCase() === nextCode,
        )
      )
        throw new Error("供应商编码已存在");
      if (nextType !== supplier.type) {
        const expectedMode =
          nextType === "CONSIGNMENT" ? "CONSIGNMENT" : "PURCHASE";
        const incompatible = getGoods().filter(
          (entry) =>
            entry.supplierId === supplier.id && entry.mode !== expectedMode,
        ).length;
        if (incompatible)
          throw new Error(`仍有 ${incompatible} 个 SKU 与新供应商类型不一致`);
      }
      Object.assign(supplier, {
        code: nextCode,
        name: nextName,
        type: nextType,
        settlementRule: nextRule,
        ...(data.contactName !== undefined
          ? { contactName: text(data.contactName) || null }
          : {}),
        ...(data.contactPhone !== undefined
          ? { contactPhone: text(data.contactPhone) || null }
          : {}),
      });
      if (nextName !== oldValue.name) {
        const goods = getGoods();
        for (const item of goods.filter(
          (entry) => entry.supplierId === supplier.id,
        ))
          item.supplier = nextName;
        saveGoods(goods);
      }
    }
    supplier.updatedAt = nextMockUpdatedAt(oldValue);
    saveInventorySuppliers(suppliers);
    saveMockMasterAudit({
      action: auditAction,
      objectType: "Supplier",
      objectId: supplier.id,
      requestId: replay.requestId,
      commandHash: replay.commandHash,
      oldValue,
      newValue: supplier,
      reason,
    });
    return { handled: true, value: ok(mockSupplierContext(supplier)) };
  }
  return { handled: false };
}
