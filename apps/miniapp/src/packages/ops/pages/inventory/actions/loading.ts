import type { Ref, ComputedRef } from "vue";
import { nextTick } from "vue";
import { hasOperationsAccess } from "../../../../../config/operations";
import { endpoints } from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  type OpsDeepLinkQuery,
} from "../../../../../utils/work-item-deep-link";
import type { Tab, MasterType } from "../page-types.js";

interface ActionContext {
  session: ReturnType<typeof useSessionStore>;
  loading: Ref<boolean, boolean>;
  errorMessage: Ref<string, string>;
  isAdmin: ComputedRef<boolean>;
  tab: Ref<Tab, Tab>;
  items: Ref<any[], any[]>;
  suppliers: Ref<any[], any[]>;
  locations: Ref<any[], any[]>;
  purchaseOrders: Ref<any[], any[]>;
  stocktakes: Ref<any[], any[]>;
  operations: Ref<any[], any[]>;
  trainingSessions: Ref<any[], any[]>;
  events: Ref<any[], any[]>;
  canUseForTraining: ComputedRef<boolean>;
  canUseForEvent: ComputedRef<boolean>;
  deepLinkHandled: Ref<boolean, boolean>;
  deepLinkQuery: Ref<
    {
      focus?: string | undefined;
      id?: string | undefined;
      orderId?: string | undefined;
      eventId?: string | undefined;
      gameId?: string | undefined;
      sessionId?: string | undefined;
      attendanceId?: string | undefined;
      userId?: string | undefined;
      round?: string | undefined;
    },
    | OpsDeepLinkQuery
    | {
        focus?: string | undefined;
        id?: string | undefined;
        orderId?: string | undefined;
        eventId?: string | undefined;
        gameId?: string | undefined;
        sessionId?: string | undefined;
        attendanceId?: string | undefined;
        userId?: string | undefined;
        round?: string | undefined;
      }
  >;
  masterType: Ref<MasterType, MasterType>;
  focusedRecord: Ref<string, string>;
}

export function useInventoryLoadingActions({
  session,
  loading,
  errorMessage,
  isAdmin,
  tab,
  items,
  suppliers,
  locations,
  purchaseOrders,
  stocktakes,
  operations,
  trainingSessions,
  events,
  canUseForTraining,
  canUseForEvent,
  deepLinkHandled,
  deepLinkQuery,
  masterType,
  focusedRecord,
}: ActionContext) {
  async function load() {
    await session.hydrate();
    if (!hasOperationsAccess(session.roles, "inventory")) return;
    loading.value = true;
    errorMessage.value = "";
    try {
      if (!isAdmin.value) {
        tab.value = "STOCK";
        items.value = await endpoints.lowStock();
        suppliers.value = [];
        locations.value = [];
        purchaseOrders.value = [];
        stocktakes.value = [];
        operations.value = [];
        trainingSessions.value = [];
        events.value = [];
      } else {
        const result = await Promise.all([
          endpoints.inventory(),
          endpoints.inventorySuppliers(),
          endpoints.inventoryLocations(),
          endpoints.purchaseOrders(),
          endpoints.stocktakes(),
          endpoints.inventoryOperations(),
        ]);
        [
          items.value,
          suppliers.value,
          locations.value,
          purchaseOrders.value,
          stocktakes.value,
          operations.value,
        ] = result;
        const usageReferences = await Promise.allSettled([
          canUseForTraining.value
            ? endpoints.trainingSessions()
            : Promise.resolve([]),
          canUseForEvent.value
            ? endpoints.managedEvents()
            : Promise.resolve([]),
        ]);
        trainingSessions.value =
          usageReferences[0].status === "fulfilled"
            ? usageReferences[0].value
            : [];
        events.value =
          usageReferences[1].status === "fulfilled"
            ? usageReferences[1].value
            : [];
      }
    } catch (cause: any) {
      errorMessage.value = cause.message || "库存工作台加载失败";
      uni.showToast({
        title: errorMessage.value,
        icon: "none",
      });
    } finally {
      loading.value = false;
    }
    await applyInventoryDeepLink();
  }

  async function applyInventoryDeepLink() {
    if (deepLinkHandled.value || !deepLinkQuery.value.focus) return;
    const focus = deepLinkQuery.value.focus;
    let record: any = null;
    let prefix = "";
    let label = "库存记录";
    if (focus === "low-stock" || focus === "stock") {
      tab.value = "STOCK";
      record = findOpsDeepLinkRecord(items.value, deepLinkQuery.value, [
        "id",
        "sku",
      ]);
      prefix = "inventory-item";
      label = "库存商品";
    } else if (focus === "purchase") {
      tab.value = "PURCHASE";
      record = findOpsDeepLinkRecord(
        purchaseOrders.value,
        deepLinkQuery.value,
        ["id", "orderNo"],
      );
      prefix = "inventory-purchase";
      label = "采购单";
    } else if (focus === "stocktake") {
      tab.value = "STOCKTAKE";
      record = findOpsDeepLinkRecord(stocktakes.value, deepLinkQuery.value, [
        "id",
        "stocktakeNo",
      ]);
      prefix = "inventory-stocktake";
      label = "盘点单";
    } else if (focus === "movement") {
      tab.value = "MOVEMENT";
      record = findOpsDeepLinkRecord(operations.value, deepLinkQuery.value, [
        "id",
        "documentNo",
      ]);
      prefix = "inventory-movement";
      label = "库存作业单";
    } else if (focus === "master") {
      tab.value = "MASTER";
      const records = [...items.value, ...suppliers.value, ...locations.value];
      record = findOpsDeepLinkRecord(records, deepLinkQuery.value, [
        "id",
        "sku",
        "code",
      ]);
      prefix = "inventory-master";
      label = "库存基础资料";
      if (record) {
        masterType.value = items.value.some((item) => item.id === record.id)
          ? "ITEM"
          : suppliers.value.some((item) => item.id === record.id)
            ? "SUPPLIER"
            : "LOCATION";
      }
    } else {
      deepLinkHandled.value = true;
      uni.showToast({ title: `无法识别库存待办类型：${focus}`, icon: "none" });
      return;
    }
    deepLinkHandled.value = true;
    if (!record) {
      uni.showToast({
        title: `未找到待办对应的${label}，可能已处理或无权查看`,
        icon: "none",
      });
      return;
    }
    focusedRecord.value = `${prefix}:${record.id}`;
    await nextTick();
    uni.pageScrollTo({
      selector: `#${opsDeepLinkDomId(prefix, record.id)}`,
      duration: 250,
    });
  }
  return { load, applyInventoryDeepLink };
}
