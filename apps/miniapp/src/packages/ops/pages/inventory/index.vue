<script setup lang="ts">
import { useInventoryLoadingActions } from "./actions/loading.js";

import StockUsage from "./sections/StockUsage.vue";
import Purchasing from "./sections/Purchasing.vue";
import Stocktaking from "./sections/Stocktaking.vue";
import StockMovements from "./sections/StockMovements.vue";
import InventoryCatalog from "./sections/InventoryCatalog.vue";

import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import MetricCard from "../../../../components/MetricCard.vue";
import OperationsFrame from "../../components/OperationsFrame.vue";
import OperationTask from "../../components/OperationTask.vue";
import { useOperationTask, reasonField } from "../../components/operation-task";
import { hasOperationsAccess } from "../../../../config/operations";
import { endpoints } from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import { idempotencyKey, money } from "../../../../utils/format";
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from "../../../../utils/work-item-deep-link";
import type { Tab, MasterType, MovementType, UsageType } from "./page-types.js";
import { useInventoryCatalogActions } from "./actions/catalog.js";
import { useInventoryUsageActions } from "./actions/usage.js";
import { useInventoryPurchasingActions } from "./actions/purchasing.js";
import { useInventoryStocktakingActions } from "./actions/stocktaking.js";
import { useInventoryMovementsActions } from "./actions/movements.js";
const task = useOperationTask();

const session = useSessionStore();

const tab = ref<Tab>("STOCK");

const loading = ref(false);

const saving = ref(false);

const errorMessage = ref("");

const deepLinkQuery = ref<OpsDeepLinkQuery>({});

const deepLinkHandled = ref(false);

const focusedRecord = ref("");

const items = ref<any[]>([]);

const suppliers = ref<any[]>([]);

const locations = ref<any[]>([]);

const purchaseOrders = ref<any[]>([]);

const stocktakes = ref<any[]>([]);

const operations = ref<any[]>([]);

const trainingSessions = ref<any[]>([]);

const events = ref<any[]>([]);

const masterType = ref<MasterType>("ITEM");

const masterSearch = ref("");

const masterStatus = ref<"ALL" | "ACTIVE" | "DISABLED">("ALL");

const showMasterForm = ref(false);

const editingMaster = ref<any>(null);

const detailId = ref("");

const masterDetail = ref<any>(null);

const masterForm = ref<any>({});

const showPurchaseForm = ref(false);

const purchaseForm = ref({
  supplierId: "",
  itemId: "",
  locationId: "",
  quantity: "",
});

const showStocktakeForm = ref(false);

const stocktakeForm = ref({ locationId: "", reason: "" });

const showMovementForm = ref(false);

const movementType = ref<MovementType>("TRANSFER");

const movementForm = ref({
  itemId: "",
  sourceLocationId: "",
  targetLocationId: "",
  quantity: "",
  reason: "",
});

const showUsageForm = ref(false);

const usageForm = ref({
  type: "TRAINING_USAGE" as UsageType,
  itemId: "",
  referenceId: "",
  quantity: "",
});

const isAdmin = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);

const canOperate = computed(() => isAdmin.value);

const canUseForTraining = computed(() => isAdmin.value);

const canUseForEvent = computed(() => isAdmin.value);

const inventoryTabs = computed<Array<[Tab, string]>>(() =>
  isAdmin.value
    ? [
        ["STOCK", "库存"],
        ["PURCHASE", "采购收货"],
        ["STOCKTAKE", "盘点"],
        ["MOVEMENT", "调拨报损"],
        ["MASTER", "基础资料"],
      ]
    : [["STOCK", "低库存"]],
);

const lowStock = computed(() =>
  items.value.filter(
    (item) =>
      item.enabled !== false && Number(item.stock) <= Number(item.safeStock),
  ),
);

const activeItems = computed(() =>
  items.value.filter((entry) => entry.enabled !== false),
);

const activeSuppliers = computed(() =>
  suppliers.value.filter((entry) => entry.enabled !== false),
);

const activeLocations = computed(() =>
  locations.value.filter((entry) => entry.enabled !== false),
);

const purchaseItems = computed(() => {
  const supplier = activeSuppliers.value.find(
    (entry) => entry.id === purchaseForm.value.supplierId,
  );
  if (!supplier) return [];
  return activeItems.value.filter(
    (entry) =>
      entry.supplierId === supplier.id &&
      ((supplier.type === "CONSIGNMENT" && entry.mode === "CONSIGNMENT") ||
        (supplier.type === "OWNED" && entry.mode === "PURCHASE")),
  );
});

const movementTargetLocations = computed(() =>
  activeLocations.value.filter(
    (entry) => entry.id !== movementForm.value.sourceLocationId,
  ),
);

const metrics = computed(() =>
  isAdmin.value
    ? [
        [
          "库存 SKU",
          String(items.value.length),
          `低库存 ${lowStock.value.length}`,
        ],
        [
          "待审批采购",
          String(
            purchaseOrders.value.filter((item) => item.status === "SUBMITTED")
              .length,
          ),
          "制单与审批分离",
        ],
        [
          "待复核盘点",
          String(
            stocktakes.value.filter((item) => item.status === "REVIEW").length,
          ),
          "差异过账",
        ],
        [
          "待过账单据",
          String(
            operations.value.filter((item) => item.status === "APPROVED")
              .length,
          ),
          "调拨 / 报损",
        ],
      ]
    : [
        ["低库存 SKU", String(items.value.length), "仅展示安全库存预警"],
        ["当前权限", "只读", "采购与主数据由管理员处理"],
      ],
);

const masterRecords = computed(() => {
  const source =
    masterType.value === "ITEM"
      ? items.value
      : masterType.value === "SUPPLIER"
        ? suppliers.value
        : locations.value;
  const keyword = masterSearch.value.trim().toLowerCase();
  return source.filter((entry) => {
    if (masterStatus.value === "ACTIVE" && entry.enabled === false)
      return false;
    if (masterStatus.value === "DISABLED" && entry.enabled !== false)
      return false;
    if (!keyword) return true;
    return [entry.code, entry.sku, entry.name, entry.category, entry.supplier]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });
});

const supplierNames = computed(() =>
  activeSuppliers.value.map(
    (entry) =>
      `${entry.name}（${entry.type === "CONSIGNMENT" ? "寄售" : "自营"}）`,
  ),
);

const locationNames = computed(() =>
  activeLocations.value.map((entry) => `${entry.code} · ${entry.name}`),
);

const activeItemNames = computed(() =>
  activeItems.value.map((entry) => `${entry.sku} · ${entry.name}`),
);

const purchaseItemNames = computed(() =>
  purchaseItems.value.map((entry) => `${entry.sku} · ${entry.name}`),
);

const movementTargetLocationNames = computed(() =>
  movementTargetLocations.value.map((entry) => `${entry.code} · ${entry.name}`),
);

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "待审批",
  APPROVED: "已审批",
  PARTIAL_RECEIVED: "部分收货",
  RECEIVED: "已收货",
  CANCELLED: "已取消",
  COUNTING: "盘点录数",
  REVIEW: "待复核",
  POSTED: "已过账",
};

function stockItemContext(item: any) {
  const parts = [item.sku];
  if (isAdmin.value) {
    parts.push(item.mode === "CONSIGNMENT" ? "寄售" : "自营");
  }
  parts.push(`安全线 ${item.safeStock}`);
  return parts.join(" · ");
}

async function run(action: () => Promise<unknown>, message: string) {
  try {
    await action();
    uni.showToast({ title: message, icon: "success" });
    await load();
    return true;
  } catch (cause: any) {
    uni.showModal({
      title: "操作未完成",
      content: cause.message || "请检查单据状态",
      showCancel: false,
    });
    return false;
  }
}

const eligibleUsageReferences = computed(() =>
  (usageForm.value.type === "TRAINING_USAGE"
    ? trainingSessions.value
    : events.value
  ).filter((entry: any) =>
    usageForm.value.type === "TRAINING_USAGE"
      ? ["SCHEDULED", "IN_PROGRESS"].includes(entry.status)
      : ["OPEN", "FULL", "IN_PROGRESS"].includes(entry.status),
  ),
);

const usageReferenceNames = computed(() =>
  eligibleUsageReferences.value.map((entry: any) =>
    usageReferenceLabel(usageForm.value.type, entry),
  ),
);

function validationError(title: string) {
  uni.showToast({ title, icon: "none" });
  return null;
}

function formPositiveInteger(value: string, emptyMessage = "请输入数量") {
  if (!String(value).trim()) return validationError(emptyMessage);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    return validationError("数量必须为正整数");
  return parsed;
}

const {
  selectMasterType,
  openMasterForm,
  inventoryItemPayload,
  supplierPayload,
  submitMasterForm,
  loadMasterDetail,
  toggleMasterStatus,
} = useInventoryCatalogActions({
  masterType,
  showMasterForm,
  detailId,
  masterDetail,
  isAdmin,
  editingMaster,
  masterForm,
  saving,
  load: (...args: Parameters<typeof load>) => load(...args),
  task,
});

const {
  usageReferenceLabel,
  openUsageForm,
  selectUsageReference,
  submitUsage,
} = useInventoryUsageActions({
  usageForm,
  showUsageForm,
  eligibleUsageReferences,
  activeItems,
  validationError: (...args: Parameters<typeof validationError>) =>
    validationError(...args),
  formPositiveInteger: (...args: Parameters<typeof formPositiveInteger>) =>
    formPositiveInteger(...args),
  saving,
  run: (...args: Parameters<typeof run>) => run(...args),
});

const {
  openPurchaseForm,
  selectPurchaseSupplier,
  selectPurchaseItem,
  selectPurchaseLocation,
  submitPurchaseOrder,
  purchaseAction,
  purchaseActionLabel,
} = useInventoryPurchasingActions({
  purchaseForm,
  showPurchaseForm,
  activeSuppliers,
  purchaseItems,
  activeLocations,
  validationError: (...args: Parameters<typeof validationError>) =>
    validationError(...args),
  formPositiveInteger: (...args: Parameters<typeof formPositiveInteger>) =>
    formPositiveInteger(...args),
  saving,
  run: (...args: Parameters<typeof run>) => run(...args),
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
  isAdmin,
});

const {
  openStocktakeForm,
  selectStocktakeLocation,
  submitStocktake,
  stocktakeAction,
} = useInventoryStocktakingActions({
  stocktakeForm,
  showStocktakeForm,
  activeLocations,
  validationError: (...args: Parameters<typeof validationError>) =>
    validationError(...args),
  saving,
  run: (...args: Parameters<typeof run>) => run(...args),
  task,
  load: (...args: Parameters<typeof load>) => load(...args),
});

const {
  openMovementForm,
  selectMovementItem,
  selectMovementSource,
  selectMovementTarget,
  submitMovement,
  movementAction,
  movementActionLabel,
} = useInventoryMovementsActions({
  movementType,
  movementForm,
  showMovementForm,
  activeItems,
  activeLocations,
  movementTargetLocations,
  validationError: (...args: Parameters<typeof validationError>) =>
    validationError(...args),
  formPositiveInteger: (...args: Parameters<typeof formPositiveInteger>) =>
    formPositiveInteger(...args),
  saving,
  run: (...args: Parameters<typeof run>) => run(...args),
  isAdmin,
});

const { load, applyInventoryDeepLink } = useInventoryLoadingActions({
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
});

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options);
  const focus = deepLinkQuery.value.focus;
  if (focus === "purchase") tab.value = "PURCHASE";
  else if (focus === "stocktake") tab.value = "STOCKTAKE";
  else if (focus === "movement") tab.value = "MOVEMENT";
  else if (focus === "master") tab.value = "MASTER";
  else if (focus) tab.value = "STOCK";
});

onShow(load);
</script>

<template>
  <OperationsFrame
    access="inventory"
    icon="inventory"
    title="库存作业中心"
    eyebrow="INVENTORY OPERATIONS"
    role="前台预警 / 管理员作业"
    description="前台仅查看低库存预警；完整库存、进价、供应商与采购作业仅向管理员开放。"
  >
    <OperationTask :task="task" />
    <view class="metric-grid"
      ><MetricCard
        v-for="metric in metrics"
        :key="metric[0]"
        :label="metric[0]"
        :value="metric[1]"
        :note="metric[2]"
    /></view>
    <scroll-view scroll-x class="tabs"
      ><view class="tab-row"
        ><button
          v-for="entry in inventoryTabs"
          :key="entry[0]"
          class="tab"
          :class="{ active: tab === entry[0] }"
          @tap="tab = entry[0] as Tab"
        >
          {{ entry[1] }}
        </button></view
      ></scroll-view
    >

    <view v-if="errorMessage" class="card state-card error-state">
      <text>{{ errorMessage }}</text>
      <button class="secondary state-action" @tap="load">重新加载</button>
    </view>
    <view v-else-if="loading" class="card state-card"
      >正在加载库存资料与作业单…</view
    >

    <StockUsage
      v-if="!errorMessage && tab === 'STOCK'"
      :errorMessage="errorMessage"
      :tab="tab"
      v-model:showUsageForm="showUsageForm"
      :usageForm="usageForm"
      :activeItems="activeItems"
      :usageReferenceNames="usageReferenceNames"
      :selectUsageReference="selectUsageReference"
      :eligibleUsageReferences="eligibleUsageReferences"
      :usageReferenceLabel="usageReferenceLabel"
      :saving="saving"
      :submitUsage="submitUsage"
      :loading="loading"
      :items="items"
      :isAdmin="isAdmin"
      :focusedRecord="focusedRecord"
      :stockItemContext="stockItemContext"
      :canUseForTraining="canUseForTraining"
      :canUseForEvent="canUseForEvent"
      :openUsageForm="openUsageForm"
    />

    <Purchasing
      v-else-if="!errorMessage && tab === 'PURCHASE'"
      :errorMessage="errorMessage"
      :tab="tab"
      :canOperate="canOperate"
      :openPurchaseForm="openPurchaseForm"
      v-model:showPurchaseForm="showPurchaseForm"
      :supplierNames="supplierNames"
      :selectPurchaseSupplier="selectPurchaseSupplier"
      :activeSuppliers="activeSuppliers"
      :purchaseForm="purchaseForm"
      :purchaseItemNames="purchaseItemNames"
      :selectPurchaseItem="selectPurchaseItem"
      :purchaseItems="purchaseItems"
      :locationNames="locationNames"
      :selectPurchaseLocation="selectPurchaseLocation"
      :activeLocations="activeLocations"
      :saving="saving"
      :submitPurchaseOrder="submitPurchaseOrder"
      :loading="loading"
      :purchaseOrders="purchaseOrders"
      :focusedRecord="focusedRecord"
      :statusLabel="statusLabel"
      :purchaseActionLabel="purchaseActionLabel"
      :purchaseAction="purchaseAction"
    />

    <Stocktaking
      v-else-if="!errorMessage && tab === 'STOCKTAKE'"
      :errorMessage="errorMessage"
      :tab="tab"
      :canOperate="canOperate"
      :openStocktakeForm="openStocktakeForm"
      v-model:showStocktakeForm="showStocktakeForm"
      :locationNames="locationNames"
      :selectStocktakeLocation="selectStocktakeLocation"
      :activeLocations="activeLocations"
      :stocktakeForm="stocktakeForm"
      :saving="saving"
      :submitStocktake="submitStocktake"
      :loading="loading"
      :stocktakes="stocktakes"
      :focusedRecord="focusedRecord"
      :statusLabel="statusLabel"
      :isAdmin="isAdmin"
      :stocktakeAction="stocktakeAction"
    />

    <StockMovements
      v-else-if="!errorMessage && tab === 'MOVEMENT'"
      :errorMessage="errorMessage"
      :tab="tab"
      :canOperate="canOperate"
      :openMovementForm="openMovementForm"
      v-model:showMovementForm="showMovementForm"
      :movementType="movementType"
      :activeItemNames="activeItemNames"
      :selectMovementItem="selectMovementItem"
      :activeItems="activeItems"
      :movementForm="movementForm"
      :locationNames="locationNames"
      :selectMovementSource="selectMovementSource"
      :activeLocations="activeLocations"
      :movementTargetLocationNames="movementTargetLocationNames"
      :selectMovementTarget="selectMovementTarget"
      :movementTargetLocations="movementTargetLocations"
      :saving="saving"
      :submitMovement="submitMovement"
      :loading="loading"
      :operations="operations"
      :focusedRecord="focusedRecord"
      :statusLabel="statusLabel"
      :movementActionLabel="movementActionLabel"
      :movementAction="movementAction"
    />
    <InventoryCatalog
      v-else-if="!errorMessage && tab === 'MASTER'"
      :errorMessage="errorMessage"
      :tab="tab"
      :masterType="masterType"
      :selectMasterType="selectMasterType"
      v-model:masterSearch="masterSearch"
      v-model:masterStatus="masterStatus"
      :isAdmin="isAdmin"
      :saving="saving"
      :openMasterForm="openMasterForm"
      v-model:showMasterForm="showMasterForm"
      :editingMaster="editingMaster"
      :masterForm="masterForm"
      :supplierNames="supplierNames"
      :activeSuppliers="activeSuppliers"
      :suppliers="suppliers"
      :locationNames="locationNames"
      :activeLocations="activeLocations"
      :locations="locations"
      :submitMasterForm="submitMasterForm"
      :masterRecords="masterRecords"
      :focusedRecord="focusedRecord"
      :detailId="detailId"
      :loadMasterDetail="loadMasterDetail"
      :toggleMasterStatus="toggleMasterStatus"
      :masterDetail="masterDetail"
      :loading="loading"
    />
    <view
      v-if="
        !loading &&
        ((tab === 'PURCHASE' && !purchaseOrders.length) ||
          (tab === 'STOCKTAKE' && !stocktakes.length) ||
          (tab === 'MOVEMENT' && !operations.length))
      "
      class="card empty"
      >暂无单据，从上方建立第一张作业单。</view
    >
  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>
