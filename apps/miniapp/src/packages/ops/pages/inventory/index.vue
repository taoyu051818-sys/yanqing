<script setup lang="ts">
import { withPendingCreationKey } from "../../../../utils/pending-creation-key"
import { computed, nextTick, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import MetricCard from "../../../../components/MetricCard.vue";
import OperationsFrame from '../../components/OperationsFrame.vue'
import OperationTask from '../../components/OperationTask.vue'
import { useOperationTask, reasonField } from '../../components/operation-task'
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

type Tab = "STOCK" | "PURCHASE" | "STOCKTAKE" | "MOVEMENT" | "MASTER";
type MasterType = "ITEM" | "SUPPLIER" | "LOCATION";
type MovementType = "TRANSFER" | "LOSS";
type UsageType = "TRAINING_USAGE" | "EVENT_USAGE";

const task = useOperationTask()
const session = useSessionStore()
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
        canUseForEvent.value ? endpoints.managedEvents() : Promise.resolve([]),
      ]);
      trainingSessions.value =
        usageReferences[0].status === "fulfilled" ? usageReferences[0].value : [];
      events.value =
        usageReferences[1].status === "fulfilled" ? usageReferences[1].value : [];
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
    record = findOpsDeepLinkRecord(items.value, deepLinkQuery.value, ["id", "sku"]);
    prefix = "inventory-item";
    label = "库存商品";
  } else if (focus === "purchase") {
    tab.value = "PURCHASE";
    record = findOpsDeepLinkRecord(purchaseOrders.value, deepLinkQuery.value, ["id", "orderNo"]);
    prefix = "inventory-purchase";
    label = "采购单";
  } else if (focus === "stocktake") {
    tab.value = "STOCKTAKE";
    record = findOpsDeepLinkRecord(stocktakes.value, deepLinkQuery.value, ["id", "stocktakeNo"]);
    prefix = "inventory-stocktake";
    label = "盘点单";
  } else if (focus === "movement") {
    tab.value = "MOVEMENT";
    record = findOpsDeepLinkRecord(operations.value, deepLinkQuery.value, ["id", "documentNo"]);
    prefix = "inventory-movement";
    label = "库存作业单";
  } else if (focus === "master") {
    tab.value = "MASTER";
    const records = [...items.value, ...suppliers.value, ...locations.value];
    record = findOpsDeepLinkRecord(records, deepLinkQuery.value, ["id", "sku", "code"]);
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
    uni.showToast({ title: `未找到待办对应的${label}，可能已处理或无权查看`, icon: "none" });
    return;
  }
  focusedRecord.value = `${prefix}:${record.id}`;
  await nextTick();
  uni.pageScrollTo({ selector: `#${opsDeepLinkDomId(prefix, record.id)}`, duration: 250 });
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

function selectMasterType(value: MasterType) {
  masterType.value = value;
  showMasterForm.value = false;
  detailId.value = "";
  masterDetail.value = null;
}

function openMasterForm(record?: any) {
  if (!isAdmin.value) return;
  editingMaster.value = record || null;
  const base = {
    reason: "",
    commandKey: idempotencyKey(
      `master-${masterType.value.toLowerCase()}-${record ? "update" : "create"}`,
    ),
  };
  if (masterType.value === "SUPPLIER") {
    masterForm.value = {
      ...base,
      code: record?.code || "",
      name: record?.name || "",
      type: record?.type || "OWNED",
      contactName: record?.contactName || "",
      contactPhone: record?.contactPhone || "",
      settlementCycle: record?.settlementRule?.settlementCycle || "MONTHLY",
      paymentTermsDays: String(record?.settlementRule?.paymentTermsDays ?? 30),
      commissionRatePercent: String(
        Number(record?.settlementRule?.commissionRateBps ?? 2500) / 100,
      ),
    };
  } else if (masterType.value === "LOCATION") {
    masterForm.value = {
      ...base,
      code: record?.code || "",
      name: record?.name || "",
    };
  } else {
    masterForm.value = {
      ...base,
      sku: record?.sku || "",
      name: record?.name || "",
      category: record?.category || "",
      mode: record?.mode || "PURCHASE",
      supplierId: record?.supplierId || "",
      defaultLocationId: record?.defaultLocationId || "",
      purchasePriceYuan: String(Number(record?.purchasePriceCents || 0) / 100),
      salePriceYuan: String(Number(record?.salePriceCents || 0) / 100),
      safeStock: String(record?.safeStock ?? 0),
      batchCode: record?.batchCode || "DEFAULT",
      expiresAt: record?.expiresAt
        ? new Date(record.expiresAt).toISOString().slice(0, 10)
        : "",
    };
  }
  showMasterForm.value = true;
}

function inventoryItemPayload(form: any) {
  if (!form.supplierId) throw new Error("请选择供应商");
  if (!form.defaultLocationId) throw new Error("请选择默认库位");
  const purchasePriceCents = Math.round(Number(form.purchasePriceYuan) * 100);
  const salePriceCents = Math.round(Number(form.salePriceYuan) * 100);
  const safeStock = Number(form.safeStock);
  if (
    !Number.isInteger(purchasePriceCents) ||
    purchasePriceCents < 0 ||
    !Number.isInteger(salePriceCents) ||
    salePriceCents < 0 ||
    !Number.isInteger(safeStock) ||
    safeStock < 0
  ) {
    throw new Error("进价、售价和安全库存必须为非负数");
  }
  return {
    sku: form.sku,
    name: form.name,
    category: form.category,
    mode: form.mode,
    supplierId: form.supplierId,
    defaultLocationId: form.defaultLocationId,
    purchasePriceCents,
    salePriceCents,
    safeStock,
    batchCode: form.batchCode || "DEFAULT",
    expiresAt: form.expiresAt
      ? `${form.expiresAt}T23:59:59+08:00`
      : editingMaster.value
        ? null
        : undefined,
  };
}

function supplierPayload(form: any) {
  const settlementRule =
    form.type === "CONSIGNMENT"
      ? {
          settlementCycle: form.settlementCycle,
          commissionRateBps: Math.round(
            Number(form.commissionRatePercent) * 100,
          ),
        }
      : {
          settlementCycle: form.settlementCycle,
          paymentTermsDays: Number(form.paymentTermsDays),
        };
  return {
    code: form.code,
    name: form.name,
    type: form.type,
    contactName: form.contactName,
    contactPhone: form.contactPhone,
    settlementRule,
  };
}

async function submitMasterForm() {
  const form = masterForm.value;
  if (!String(form.reason || "").trim())
    return uni.showToast({ title: "请填写变更原因", icon: "none" });
  const confirm = await uni.showModal({
    title: editingMaster.value ? "确认保存资料" : "确认新增资料",
    content: `${form.reason}\n关键变更将写入审计日志。`,
  });
  if (!confirm.confirm) return;
  saving.value = true;
  try {
    const command = {
      reason: String(form.reason).trim(),
      idempotencyKey: form.commandKey,
    };
    if (masterType.value === "ITEM") {
      const payload = { ...inventoryItemPayload(form), ...command };
      if (editingMaster.value) {
        await endpoints.updateInventoryItem(editingMaster.value.id, {
          ...payload,
          expectedUpdatedAt: editingMaster.value.updatedAt,
        });
      } else await endpoints.createInventoryItem(payload);
    } else if (masterType.value === "SUPPLIER") {
      const payload = { ...supplierPayload(form), ...command };
      if (editingMaster.value) {
        await endpoints.updateInventorySupplier(editingMaster.value.id, {
          ...payload,
          expectedUpdatedAt: editingMaster.value.updatedAt,
        });
      } else await endpoints.createInventorySupplier(payload);
    } else {
      const payload = { code: form.code, name: form.name, ...command };
      if (editingMaster.value) {
        await endpoints.updateInventoryLocation(editingMaster.value.id, {
          ...payload,
          expectedUpdatedAt: editingMaster.value.updatedAt,
        });
      } else await endpoints.createInventoryLocation(payload);
    }
    showMasterForm.value = false;
    uni.showToast({ title: "资料已保存", icon: "success" });
    await load();
  } catch (cause: any) {
    uni.showModal({
      title: "资料未保存",
      content: cause.message || "请核对字段和当前版本",
      showCancel: false,
    });
  } finally {
    saving.value = false;
  }
}

async function loadMasterDetail(record: any) {
  if (detailId.value === record.id) {
    detailId.value = "";
    masterDetail.value = null;
    return;
  }
  saving.value = true;
  try {
    masterDetail.value =
      masterType.value === "ITEM"
        ? await endpoints.inventoryItemDetail(record.id)
        : masterType.value === "SUPPLIER"
          ? await endpoints.inventorySupplierDetail(record.id)
          : await endpoints.inventoryLocationDetail(record.id);
    detailId.value = record.id;
  } catch (cause: any) {
    uni.showToast({ title: cause.message || "详情加载失败", icon: "none" });
  } finally {
    saving.value = false;
  }
}

function toggleMasterStatus(record: any) {
  const enabling = record.enabled === false, type = masterType.value
  task.start({ title: enabling ? '启用基础资料' : '停用基础资料', description: record.name + (enabling ? ' · 启用后可用于新业务。' : ' · 服务器检查库存和未完成作业，历史不删除。'),
    confirmText: enabling ? '确认启用' : '确认停用', fields: [reasonField('变更依据')],
    submit: async ({ reason }) => {
      const command = { enabled: enabling, expectedUpdatedAt: record.updatedAt, reason }
      await withPendingCreationKey('inventory.master.' + type + '.' + record.id, command, idempotencyKey => {
        const payload = { ...command, idempotencyKey }
        return type === 'ITEM' ? endpoints.setInventoryItemStatus(record.id, payload) : type === 'SUPPLIER' ? endpoints.setInventorySupplierStatus(record.id, payload) : endpoints.setInventoryLocationStatus(record.id, payload)
      })
      await load(); return '基础资料状态已更新，关联历史保留。'
    },
  })
}

function usageReferenceLabel(type: UsageType, entry: any) {
  if (type === "TRAINING_USAGE") {
    const name = entry.class?.name || entry.name || "培训课次";
    return `${name} · ${new Date(entry.startsAt).toLocaleDateString()}`;
  }
  return `${entry.name || entry.code || "赛事"} · ${entry.status}`;
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

function openUsageForm(item: any, type: UsageType) {
  usageForm.value = {
    type,
    itemId: item.id,
    referenceId: "",
    quantity: "",
  };
  showUsageForm.value = true;
}

function selectUsageReference(index: number) {
  usageForm.value.referenceId = eligibleUsageReferences.value[index]?.id || "";
}

async function submitUsage() {
  const item = activeItems.value.find(
    (entry) => entry.id === usageForm.value.itemId,
  );
  if (!item) return validationError("请选择要领用的商品");
  const selected = eligibleUsageReferences.value.find(
    (entry: any) => entry.id === usageForm.value.referenceId,
  );
  if (!selected)
    return validationError(
      usageForm.value.type === "TRAINING_USAGE"
        ? "请选择关联课次"
        : "请选择关联赛事",
    );
  const quantity = formPositiveInteger(
    usageForm.value.quantity,
    "请输入领用数量",
  );
  if (!quantity) return;
  if (quantity > Number(item.stock || 0)) {
    return uni.showToast({ title: "库存不足", icon: "none" });
  }
  const referenceLabel = usageReferenceLabel(usageForm.value.type, selected);
  saving.value = true;
  const succeeded = await run(
    () =>
      endpoints.inventoryTransaction(item.id, {
        type: usageForm.value.type,
        quantity: -quantity,
        referenceType:
          usageForm.value.type === "TRAINING_USAGE"
            ? "TrainingSession"
            : "Event",
        referenceId: selected.id,
        reason: `${referenceLabel}物料领用`,
        idempotencyKey: idempotencyKey(
          `${usageForm.value.type.toLowerCase()}-${item.id}-${selected.id}`,
        ),
      }),
    "领用已过账",
  );
  saving.value = false;
  if (succeeded) showUsageForm.value = false;
}

function openPurchaseForm() {
  purchaseForm.value = {
    supplierId: "",
    itemId: "",
    locationId: "",
    quantity: "",
  };
  showPurchaseForm.value = true;
}

function selectPurchaseSupplier(index: number) {
  purchaseForm.value.supplierId = activeSuppliers.value[index]?.id || "";
  purchaseForm.value.itemId = "";
}

function selectPurchaseItem(index: number) {
  purchaseForm.value.itemId = purchaseItems.value[index]?.id || "";
}

function selectPurchaseLocation(index: number) {
  purchaseForm.value.locationId = activeLocations.value[index]?.id || "";
}

async function submitPurchaseOrder() {
  const supplier = activeSuppliers.value.find(
    (entry) => entry.id === purchaseForm.value.supplierId,
  );
  if (!supplier) return validationError("请选择供应商");
  const item = purchaseItems.value.find(
    (entry) => entry.id === purchaseForm.value.itemId,
  );
  if (!item)
    return validationError(
      purchaseItems.value.length ? "请选择采购商品" : "该供应商暂无可采购商品",
    );
  const location = activeLocations.value.find(
    (entry) => entry.id === purchaseForm.value.locationId,
  );
  if (!location) return validationError("请选择收货库位");
  const quantity = formPositiveInteger(
    purchaseForm.value.quantity,
    "请输入采购数量",
  );
  if (!quantity) return;
  saving.value = true;
  const succeeded = await run(
    () =>
      endpoints.createPurchaseOrder({
        supplierId: supplier.id,
        lines: [
          {
            itemId: item.id,
            locationId: location.id,
            orderedQuantity: quantity,
            unitCostCents: item.purchasePriceCents,
            batchCode: item.batchCode || "DEFAULT",
          },
        ],
        remark: "小程序经营工作台制单",
      }),
    "采购单已建立",
  );
  saving.value = false;
  if (succeeded) showPurchaseForm.value = false;
}

function purchaseAction(order: any) {
  if (['DRAFT','SUBMITTED'].includes(order.status)) {
    const submit = order.status === 'DRAFT'
    task.start({ title: submit ? '提交采购审批' : '批准采购单', description: (order.purchaseNo || order.orderNo || '当前采购单') + ' · 请核对明细、供应商和数量。审批不会直接增加库存。',
      confirmText: submit ? '确认提交' : '确认批准', fields: [],
      submit: async () => { if (submit) await endpoints.submitPurchaseOrder(order.id); else await endpoints.approvePurchaseOrder(order.id); await load(); return submit ? '采购已提交审批。' : '采购已审批，下一步按实收数量入库。' },
    }); return
  }
  const lines = (order.lines || []).filter((line: any) => line.receivedQuantity < line.orderedQuantity)
  if (!lines.length) return
  task.start({ title: '采购收货', description: '选择本次实际到货商品并填写数量；分批收货按实际入库，不默认收齐。',
    confirmText: '确认本批收货入账', fields: [
      { key: 'lineId', label: '到货商品', kind: 'choices', initial: lines.length === 1 ? lines[0].id : '', options: lines.map((line: any) => ({ value: line.id, label: line.item?.name || '采购商品', description: '尚未收货 ' + (line.orderedQuantity - line.receivedQuantity) })) },
      { key: 'quantity', label: '实收数量', kind: 'number' },
    ],
    submit: async ({ lineId, quantity }) => {
      const line = lines.find((item: any) => item.id === lineId)
      if (Number(quantity) > line.orderedQuantity - line.receivedQuantity) throw new Error('实收不能超过剩余采购数量')
      const command = { lines: [{ lineId, quantity: Number(quantity) }] }
      await withPendingCreationKey('inventory.receipt.' + order.id, command, idempotencyKey => endpoints.receivePurchaseOrder(order.id, { ...command, idempotencyKey }))
      await load(); return '本批收货已过账，采购进度与库存已同步。'
    },
  })
}

function purchaseActionLabel(order: any) {
  if (order.status === "DRAFT") return "提交";
  if (order.status === "SUBMITTED" && isAdmin.value) return "审批";
  if (["APPROVED", "PARTIAL_RECEIVED"].includes(order.status)) return "收货";
  return "";
}

function openStocktakeForm() {
  stocktakeForm.value = { locationId: "", reason: "" };
  showStocktakeForm.value = true;
}

function selectStocktakeLocation(index: number) {
  stocktakeForm.value.locationId = activeLocations.value[index]?.id || "";
}

async function submitStocktake() {
  const location = activeLocations.value.find(
    (entry) => entry.id === stocktakeForm.value.locationId,
  );
  if (!location) return validationError("请选择盘点库位");
  const reason = stocktakeForm.value.reason.trim();
  if (!reason) return validationError("请填写盘点原因");
  saving.value = true;
  const succeeded = await run(
    () =>
      endpoints.createStocktake({
        locationId: location.id,
        reason,
      }),
    "盘点单已建立",
  );
  saving.value = false;
  if (succeeded) showStocktakeForm.value = false;
}

function stocktakeAction(document: any) {
  if (document.status === 'COUNTING') {
    const lines = document.lines.filter((line: any) => line.countedQuantity === null)
    if (lines.length) {
      task.start({ title: '登记实盘数量', description: '选择本次已清点商品，账面数量仅供核对。录入不会立即改变库存，差异须复核后过账。',
        confirmText: '确认保存实盘数', fields: [
          { key: 'lineId', label: '已清点商品', kind: 'choices', initial: lines.length === 1 ? lines[0].id : '', options: lines.map((line: any) => ({ value: line.id, label: line.item?.name || '商品', description: '账面 ' + line.bookQuantity })) },
          { key: 'counted', label: '实际数量（可填0）', kind: 'number', min: 0 },
        ],
        submit: async ({ lineId, counted }) => { await endpoints.countStocktakeLine(document.id, lineId, Number(counted)); await load(); return '实盘数已保存，请继续清点剩余商品。' },
      }); return
    }
  }
  const label = document.status === 'DRAFT' ? '开始盘点' : document.status === 'COUNTING' ? '提交盘点复核' : '复核并过账差异'
  task.start({ title: label, description: '当前盘点单 · 过账将按已复核差异更新库存，并保留不可覆盖的流水。',
    confirmText: '确认' + label, fields: [],
    submit: async () => {
      if (document.status === 'DRAFT') await endpoints.startStocktake(document.id)
      else if (document.status === 'COUNTING') await endpoints.submitStocktake(document.id)
      else await withPendingCreationKey('inventory.stocktake.' + document.id, { documentId: document.id }, idempotencyKey => endpoints.postStocktake(document.id, idempotencyKey))
      await load(); return '盘点单已' + label + '。'
    },
  })
}

function openMovementForm(type: MovementType) {
  movementType.value = type;
  movementForm.value = {
    itemId: "",
    sourceLocationId: "",
    targetLocationId: "",
    quantity: "",
    reason: "",
  };
  showMovementForm.value = true;
}

function selectMovementItem(index: number) {
  movementForm.value.itemId = activeItems.value[index]?.id || "";
}

function selectMovementSource(index: number) {
  movementForm.value.sourceLocationId = activeLocations.value[index]?.id || "";
  movementForm.value.targetLocationId = "";
}

function selectMovementTarget(index: number) {
  movementForm.value.targetLocationId =
    movementTargetLocations.value[index]?.id || "";
}

async function submitMovement() {
  const item = activeItems.value.find(
    (entry) => entry.id === movementForm.value.itemId,
  );
  if (!item) return validationError("请选择商品");
  const source = activeLocations.value.find(
    (entry) => entry.id === movementForm.value.sourceLocationId,
  );
  if (!source) return validationError("请选择来源库位");
  const target = movementTargetLocations.value.find(
    (entry) => entry.id === movementForm.value.targetLocationId,
  );
  if (movementType.value === "TRANSFER" && !target)
    return validationError("请选择目标库位");
  const quantity = formPositiveInteger(
    movementForm.value.quantity,
    `请输入${movementType.value === "TRANSFER" ? "调拨" : "报损"}数量`,
  );
  if (!quantity) return;
  if (quantity > Number(item.stock || 0))
    return validationError("操作数量不能超过当前库存");
  const reason = movementForm.value.reason.trim();
  if (!reason)
    return validationError(
      `请填写${movementType.value === "TRANSFER" ? "调拨" : "报损"}原因`,
    );
  saving.value = true;
  const succeeded = await run(
    () =>
      endpoints.createInventoryOperation({
        type: movementType.value,
        itemId: item.id,
        quantity,
        sourceLocationId: source.id,
        ...(movementType.value === "TRANSFER"
          ? { targetLocationId: target?.id }
          : {}),
        batchCode: item.batchCode || "DEFAULT",
        reason,
      }),
    `${movementType.value === "TRANSFER" ? "调拨" : "报损"}单已建立`,
  );
  saving.value = false;
  if (succeeded) showMovementForm.value = false;
}

async function movementAction(document: any) {
  if (document.status === "DRAFT")
    return run(
      () => endpoints.submitInventoryOperation(document.id),
      "已提交审批",
    );
  if (document.status === "SUBMITTED")
    return run(
      () => endpoints.approveInventoryOperation(document.id),
      "单据已审批",
    );
  if (document.status === "APPROVED")
    return run(
      () =>
        endpoints.postInventoryOperation(
          document.id,
          idempotencyKey(`operation-${document.id}`),
        ),
      "库存单据已过账",
    );
}

function movementActionLabel(document: any) {
  if (document.status === "DRAFT") return "提交";
  if (document.status === "SUBMITTED" && isAdmin.value) return "审批";
  if (document.status === "APPROVED") return "过账";
  return "";
}

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

    <template v-if="!errorMessage && tab === 'STOCK'">
      <view v-if="showUsageForm" class="card operation-form">
        <view class="form-heading">
          <view>
            <text class="title">{{
              usageForm.type === "TRAINING_USAGE" ? "培训领用" : "赛事领用"
            }}</text>
            <text class="muted"
              >商品由经办人从库存卡片发起，关联业务与数量必须逐项确认。</text
            >
          </view>
          <button class="link-button" @tap="showUsageForm = false">取消</button>
        </view>
        <text class="field-label">领用商品</text>
        <view class="picker-field readonly-field">{{
          activeItems.find((entry) => entry.id === usageForm.itemId)?.name ||
          "请选择要领用的商品"
        }}</view>
        <text class="field-label"
          >关联{{ usageForm.type === "TRAINING_USAGE" ? "课次" : "赛事" }}</text
        >
        <picker
          mode="selector"
          :range="usageReferenceNames"
          @change="selectUsageReference(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            eligibleUsageReferences.find(
              (entry: any) => entry.id === usageForm.referenceId,
            )
              ? usageReferenceLabel(
                  usageForm.type,
                  eligibleUsageReferences.find(
                    (entry: any) => entry.id === usageForm.referenceId,
                  ),
                )
              : `请选择关联${usageForm.type === "TRAINING_USAGE" ? "课次" : "赛事"}`
          }}</view></picker
        >
        <text v-if="!eligibleUsageReferences.length" class="form-warning"
          >暂无可关联{{
            usageForm.type === "TRAINING_USAGE" ? "课次" : "赛事"
          }}，请先建立业务排期。</text
        >
        <text class="field-label">领用数量</text>
        <input
          v-model="usageForm.quantity"
          class="field"
          type="number"
          placeholder="请输入正整数"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitUsage"
        >
          确认领用并过账
        </button>
      </view>
      <view v-if="!loading && !items.length" class="card empty">{{
        isAdmin ? "暂无库存 SKU，请先维护基础资料。" : "当前没有低库存预警。"
      }}</view>
      <view v-for="item in items" :id="opsDeepLinkDomId('inventory-item', item.id)" :key="item.id" class="card document" :class="{ 'deep-link-target': focusedRecord === `inventory-item:${item.id}` }"
        ><view class="row"
          ><view
            ><text class="title">{{ item.name }}</text
            ><text class="muted">{{ stockItemContext(item) }}</text></view
          ><text
            class="quantity"
            :class="{ warning: item.stock <= item.safeStock }"
            >{{ item.stock }}</text
          ></view
        ><text v-if="isAdmin" class="muted"
          >售价 {{ money(item.salePriceCents) }}</text
        ><view
          v-if="item.enabled !== false && (canUseForTraining || canUseForEvent)"
          class="usage-row"
          ><button
            v-if="canUseForTraining"
            class="secondary usage-action"
            @tap="openUsageForm(item, 'TRAINING_USAGE')"
          >
            培训领用</button
          ><button
            v-if="canUseForEvent"
            class="secondary usage-action"
            @tap="openUsageForm(item, 'EVENT_USAGE')"
          >
            赛事领用
          </button></view
        ></view
      >
    </template>

    <template v-else-if="!errorMessage && tab === 'PURCHASE'">
      <button v-if="canOperate" class="primary create" @tap="openPurchaseForm">
        新建采购单
      </button>
      <view v-if="showPurchaseForm" class="card operation-form">
        <view class="form-heading">
          <view
            ><text class="title">新建采购单</text
            ><text class="muted"
              >供应商、商品和收货库位均不预选，请由经办人逐项确认。</text
            ></view
          >
          <button class="link-button" @tap="showPurchaseForm = false">
            取消
          </button>
        </view>
        <text class="field-label">供应商</text>
        <picker
          mode="selector"
          :range="supplierNames"
          @change="selectPurchaseSupplier(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeSuppliers.find(
              (entry) => entry.id === purchaseForm.supplierId,
            )?.name || "请选择供应商"
          }}</view></picker
        >
        <text class="field-label">采购商品</text>
        <picker
          mode="selector"
          :range="purchaseItemNames"
          @change="selectPurchaseItem(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            purchaseItems.find((entry) => entry.id === purchaseForm.itemId)
              ?.name ||
            (purchaseForm.supplierId ? "请选择采购商品" : "请先选择供应商")
          }}</view></picker
        >
        <text class="field-label">收货库位</text>
        <picker
          mode="selector"
          :range="locationNames"
          @change="selectPurchaseLocation(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeLocations.find(
              (entry) => entry.id === purchaseForm.locationId,
            )?.name || "请选择收货库位"
          }}</view></picker
        >
        <text class="field-label">采购数量</text>
        <input
          v-model="purchaseForm.quantity"
          class="field"
          type="number"
          placeholder="请输入正整数"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitPurchaseOrder"
        >
          确认建立采购单
        </button>
      </view>
      <view v-if="!loading && !purchaseOrders.length" class="card empty"
        >暂无采购单。</view
      >
      <view
        v-for="order in purchaseOrders"
        :id="opsDeepLinkDomId('inventory-purchase', order.id)"
        :key="order.id"
        class="card document"
        :class="{ 'deep-link-target': focusedRecord === `inventory-purchase:${order.id}` }"
        ><view class="row"
          ><view
            ><text class="title">{{ order.orderNo }}</text
            ><text class="muted"
              >{{ order.supplier?.name }} · {{ order.lines.length }} 项</text
            ></view
          ><text class="status">{{
            statusLabel[order.status] || order.status
          }}</text></view
        ><view v-for="line in order.lines" :key="line.id" class="line"
          ><text>{{ line.item?.name }}</text
          ><text
            >{{ line.receivedQuantity }}/{{ line.orderedQuantity }}</text
          ></view
        ><button
          v-if="canOperate && purchaseActionLabel(order)"
          class="primary action"
          @tap="purchaseAction(order)"
        >
          {{ purchaseActionLabel(order) }}
        </button></view
      >
    </template>

    <template v-else-if="!errorMessage && tab === 'STOCKTAKE'">
      <button v-if="canOperate" class="primary create" @tap="openStocktakeForm">
        新建盘点单
      </button>
      <view v-if="showStocktakeForm" class="card operation-form">
        <view class="form-heading">
          <view
            ><text class="title">新建盘点单</text
            ><text class="muted"
              >盘点库位不自动带入，避免误盘其他仓位。</text
            ></view
          >
          <button class="link-button" @tap="showStocktakeForm = false">
            取消
          </button>
        </view>
        <text class="field-label">盘点库位</text>
        <picker
          mode="selector"
          :range="locationNames"
          @change="
            selectStocktakeLocation(Number(($event as any).detail.value))
          "
          ><view class="picker-field">{{
            activeLocations.find(
              (entry) => entry.id === stocktakeForm.locationId,
            )?.name || "请选择盘点库位"
          }}</view></picker
        >
        <text class="field-label">盘点原因</text>
        <input
          v-model="stocktakeForm.reason"
          class="field"
          placeholder="例如：月末例行盘点"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitStocktake"
        >
          确认建立盘点单
        </button>
      </view>
      <view v-if="!loading && !stocktakes.length" class="card empty"
        >暂无盘点单。</view
      >
      <view
        v-for="document in stocktakes"
        :id="opsDeepLinkDomId('inventory-stocktake', document.id)"
        :key="document.id"
        class="card document"
        :class="{ 'deep-link-target': focusedRecord === `inventory-stocktake:${document.id}` }"
        ><view class="row"
          ><view
            ><text class="title">{{ document.stocktakeNo }}</text
            ><text class="muted"
              >{{ document.location?.name }} · {{ document.reason }}</text
            ></view
          ><text class="status">{{
            statusLabel[document.status] || document.status
          }}</text></view
        ><text v-if="document.status === 'COUNTING'" class="muted"
          >已录
          {{
            document.lines.filter((line: any) => line.countedQuantity !== null)
              .length
          }}/{{ document.lines.length }} 项</text
        ><button
          v-if="
            canOperate &&
            (document.status !== 'REVIEW' || isAdmin) &&
            !['POSTED', 'CANCELLED'].includes(document.status)
          "
          class="primary action"
          @tap="stocktakeAction(document)"
        >
          {{
            document.status === "DRAFT"
              ? "开始"
              : document.status === "COUNTING"
                ? document.lines.some(
                    (line: any) => line.countedQuantity === null,
                  )
                  ? "录入下一项"
                  : "提交复核"
                : "复核过账"
          }}
        </button></view
      >
    </template>

    <template v-else-if="!errorMessage && tab === 'MOVEMENT'">
      <view v-if="canOperate" class="create-row"
        ><button
          class="secondary create-half"
          @tap="openMovementForm('TRANSFER')"
        >
          新建调拨</button
        ><button class="primary create-half" @tap="openMovementForm('LOSS')">
          新建报损
        </button></view
      >
      <view v-if="showMovementForm" class="card operation-form">
        <view class="form-heading">
          <view
            ><text class="title"
              >新建{{ movementType === "TRANSFER" ? "调拨" : "报损" }}单</text
            ><text class="muted"
              >商品与库位不自动带入，请核对后提交。</text
            ></view
          >
          <button class="link-button" @tap="showMovementForm = false">
            取消
          </button>
        </view>
        <text class="field-label">商品</text>
        <picker
          mode="selector"
          :range="activeItemNames"
          @change="selectMovementItem(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeItems.find((entry) => entry.id === movementForm.itemId)
              ?.name || "请选择商品"
          }}</view></picker
        >
        <text class="field-label">来源库位</text>
        <picker
          mode="selector"
          :range="locationNames"
          @change="selectMovementSource(Number(($event as any).detail.value))"
          ><view class="picker-field">{{
            activeLocations.find(
              (entry) => entry.id === movementForm.sourceLocationId,
            )?.name || "请选择来源库位"
          }}</view></picker
        >
        <template v-if="movementType === 'TRANSFER'">
          <text class="field-label">目标库位</text>
          <picker
            mode="selector"
            :range="movementTargetLocationNames"
            @change="selectMovementTarget(Number(($event as any).detail.value))"
            ><view class="picker-field">{{
              movementTargetLocations.find(
                (entry) => entry.id === movementForm.targetLocationId,
              )?.name ||
              (movementForm.sourceLocationId
                ? "请选择目标库位"
                : "请先选择来源库位")
            }}</view></picker
          >
        </template>
        <text class="field-label"
          >{{ movementType === "TRANSFER" ? "调拨" : "报损" }}数量</text
        >
        <input
          v-model="movementForm.quantity"
          class="field"
          type="number"
          placeholder="请输入正整数"
        />
        <text class="field-label"
          >{{ movementType === "TRANSFER" ? "调拨" : "报损" }}原因</text
        >
        <input
          v-model="movementForm.reason"
          class="field"
          :placeholder="
            movementType === 'TRANSFER' ? '例如：前台补货' : '例如：包装破损'
          "
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitMovement"
        >
          确认建立{{ movementType === "TRANSFER" ? "调拨" : "报损" }}单
        </button>
      </view>
      <view v-if="!loading && !operations.length" class="card empty"
        >暂无调拨或报损单。</view
      >
      <view
        v-for="document in operations"
        :id="opsDeepLinkDomId('inventory-movement', document.id)"
        :key="document.id"
        class="card document"
        :class="{ 'deep-link-target': focusedRecord === `inventory-movement:${document.id}` }"
        ><view class="row"
          ><view
            ><text class="title"
              >{{ document.documentNo }} ·
              {{ document.type === "TRANSFER" ? "调拨" : "报损" }}</text
            ><text class="muted"
              >{{ document.item?.name }} × {{ document.quantity }} ·
              {{ document.sourceLocation?.name
              }}<template v-if="document.targetLocation">
                → {{ document.targetLocation.name }}</template
              ></text
            ></view
          ><text class="status">{{
            statusLabel[document.status] || document.status
          }}</text></view
        ><button
          v-if="canOperate && movementActionLabel(document)"
          class="primary action"
          @tap="movementAction(document)"
        >
          {{ movementActionLabel(document) }}
        </button></view
      >
    </template>
    <template v-else-if="!errorMessage && tab === 'MASTER'">
      <view class="master-toolbar">
        <view class="master-kind-row">
          <button
            v-for="entry in [
              ['ITEM', 'SKU'],
              ['SUPPLIER', '供应商'],
              ['LOCATION', '库位'],
            ]"
            :key="entry[0]"
            class="kind-button"
            :class="{ active: masterType === entry[0] }"
            @tap="selectMasterType(entry[0] as MasterType)"
          >
            {{ entry[1] }}
          </button>
        </view>
        <input
          v-model="masterSearch"
          class="field search-field"
          placeholder="按编码、名称或分类搜索"
        />
        <view class="status-filter-row">
          <button
            v-for="entry in [
              ['ALL', '全部'],
              ['ACTIVE', '启用'],
              ['DISABLED', '停用'],
            ]"
            :key="entry[0]"
            class="filter-button"
            :class="{ active: masterStatus === entry[0] }"
            @tap="masterStatus = entry[0] as any"
          >
            {{ entry[1] }}
          </button>
        </view>
        <button
          v-if="isAdmin"
          class="primary create"
          :disabled="saving"
          @tap="openMasterForm()"
        >
          新增{{
            masterType === "ITEM"
              ? "SKU"
              : masterType === "SUPPLIER"
                ? "供应商"
                : "库位"
          }}
        </button>
        <text v-else class="readonly-note"
          >当前身份为只读，可查看状态、关联对象与历史上下文。</text
        >
      </view>

      <view v-if="showMasterForm" class="card master-form">
        <view class="row">
          <text class="title"
            >{{ editingMaster ? "编辑" : "新增"
            }}{{
              masterType === "ITEM"
                ? "SKU"
                : masterType === "SUPPLIER"
                  ? "供应商"
                  : "库位"
            }}</text
          >
          <button class="link-button" @tap="showMasterForm = false">
            取消
          </button>
        </view>

        <template v-if="masterType === 'ITEM'">
          <text class="field-label">SKU 编码</text>
          <input
            v-model="masterForm.sku"
            class="field"
            placeholder="例如 BALL-002"
          />
          <text class="field-label">商品名称</text>
          <input
            v-model="masterForm.name"
            class="field"
            placeholder="商品名称"
          />
          <text class="field-label">分类</text>
          <input
            v-model="masterForm.category"
            class="field"
            placeholder="羽毛球 / 手胶 / 饮品"
          />
          <text class="field-label">经营模式</text>
          <view class="choice-row">
            <button
              class="choice"
              :class="{ active: masterForm.mode === 'PURCHASE' }"
              @tap="masterForm.mode = 'PURCHASE'"
            >
              自营
            </button>
            <button
              class="choice"
              :class="{ active: masterForm.mode === 'CONSIGNMENT' }"
              @tap="masterForm.mode = 'CONSIGNMENT'"
            >
              代销
            </button>
          </view>
          <text class="field-label">供应商</text>
          <picker
            mode="selector"
            :range="supplierNames"
            @change="
              masterForm.supplierId =
                activeSuppliers[Number(($event as any).detail.value)]?.id
            "
            ><view class="picker-field">{{
              suppliers.find((entry) => entry.id === masterForm.supplierId)
                ?.name || "请选择供应商"
            }}</view></picker
          >
          <text class="field-label">默认库位</text>
          <picker
            mode="selector"
            :range="locationNames"
            @change="
              masterForm.defaultLocationId =
                activeLocations[Number(($event as any).detail.value)]?.id
            "
            ><view class="picker-field">{{
              locations.find(
                (entry) => entry.id === masterForm.defaultLocationId,
              )?.name || "请选择库位"
            }}</view></picker
          >
          <view class="field-grid">
            <view
              ><text class="field-label">进价（元）</text
              ><input
                v-model="masterForm.purchasePriceYuan"
                class="field"
                type="digit"
            /></view>
            <view
              ><text class="field-label">售价（元）</text
              ><input
                v-model="masterForm.salePriceYuan"
                class="field"
                type="digit"
            /></view>
          </view>
          <view class="field-grid">
            <view
              ><text class="field-label">安全库存</text
              ><input
                v-model="masterForm.safeStock"
                class="field"
                type="number"
            /></view>
            <view
              ><text class="field-label">默认批次</text
              ><input v-model="masterForm.batchCode" class="field"
            /></view>
          </view>
          <text class="field-label">效期（可空，YYYY-MM-DD）</text>
          <input
            v-model="masterForm.expiresAt"
            class="field"
            placeholder="2027-12-31"
          />
        </template>

        <template v-else-if="masterType === 'SUPPLIER'">
          <text class="field-label">供应商编码</text>
          <input
            v-model="masterForm.code"
            class="field"
            placeholder="例如 VENDOR-001"
          />
          <text class="field-label">供应商名称</text>
          <input v-model="masterForm.name" class="field" />
          <text class="field-label">合作属性</text>
          <view class="choice-row">
            <button
              class="choice"
              :class="{ active: masterForm.type === 'OWNED' }"
              @tap="masterForm.type = 'OWNED'"
            >
              自营采购
            </button>
            <button
              class="choice"
              :class="{ active: masterForm.type === 'CONSIGNMENT' }"
              @tap="masterForm.type = 'CONSIGNMENT'"
            >
              寄售合作
            </button>
          </view>
          <view class="field-grid">
            <view
              ><text class="field-label">联系人</text
              ><input v-model="masterForm.contactName" class="field"
            /></view>
            <view
              ><text class="field-label">联系电话</text
              ><input v-model="masterForm.contactPhone" class="field"
            /></view>
          </view>
          <text class="field-label">结算周期</text>
          <picker
            mode="selector"
            :range="['PER_ORDER · 逐单', 'WEEKLY · 周结', 'MONTHLY · 月结']"
            @change="
              masterForm.settlementCycle = ['PER_ORDER', 'WEEKLY', 'MONTHLY'][
                Number(($event as any).detail.value)
              ]
            "
            ><view class="picker-field">{{
              masterForm.settlementCycle
            }}</view></picker
          >
          <template v-if="masterForm.type === 'CONSIGNMENT'">
            <text class="field-label">场馆分成比例（%）</text>
            <input
              v-model="masterForm.commissionRatePercent"
              class="field"
              type="digit"
            />
          </template>
          <template v-else>
            <text class="field-label">采购账期（天）</text>
            <input
              v-model="masterForm.paymentTermsDays"
              class="field"
              type="number"
            />
          </template>
        </template>

        <template v-else>
          <text class="field-label">库位编码</text>
          <input
            v-model="masterForm.code"
            class="field"
            placeholder="例如 FRONT-02"
          />
          <text class="field-label">库位名称</text>
          <input
            v-model="masterForm.name"
            class="field"
            placeholder="前台展示仓"
          />
        </template>

        <text class="field-label">变更原因</text>
        <textarea
          v-model="masterForm.reason"
          class="field reason-field"
          placeholder="说明新增或修改原因，写入审计日志"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitMasterForm"
        >
          确认保存
        </button>
      </view>

      <view
        v-for="record in masterRecords"
        :id="opsDeepLinkDomId('inventory-master', record.id)"
        :key="record.id"
        class="card document master-card"
        :class="{ 'deep-link-target': focusedRecord === `inventory-master:${record.id}` }"
      >
        <view class="row">
          <view>
            <text class="title">{{ record.name }}</text>
            <text class="muted">
              <template v-if="masterType === 'ITEM'"
                >{{ record.sku }} · {{ record.category }} ·
                {{ record.mode === "CONSIGNMENT" ? "代销" : "自营" }}</template
              >
              <template v-else-if="masterType === 'SUPPLIER'"
                >{{ record.code }} ·
                {{
                  record.type === "CONSIGNMENT" ? "寄售合作" : "自营采购"
                }}</template
              >
              <template v-else
                >{{ record.code }} · 库存
                {{
                  (record.stockBalances || []).reduce(
                    (sum: number, entry: any) =>
                      sum + Number(entry.quantity || 0),
                    0,
                  )
                }}</template
              >
            </text>
          </view>
          <text
            class="status"
            :class="{ disabled: record.enabled === false }"
            >{{ record.enabled === false ? "已停用" : "启用中" }}</text
          >
        </view>
        <text v-if="masterType === 'ITEM'" class="muted"
          >库存 {{ record.stock }} / 安全线 {{ record.safeStock }} · 售价
          {{ money(record.salePriceCents) }}</text
        >
        <text v-else-if="masterType === 'SUPPLIER'" class="muted"
          >SKU {{ record._count?.items ?? record.items?.length ?? 0 }} ·
          历史采购
          {{
            record._count?.purchaseOrders ?? record.purchaseOrders?.length ?? 0
          }}</text
        >
        <text v-else class="muted"
          >默认 SKU
          {{
            record._count?.defaultItems ?? record.defaultItems?.length ?? 0
          }}
          · 库位分账
          {{
            record._count?.stockBalances ?? record.stockBalances?.length ?? 0
          }}</text
        >
        <view class="master-actions">
          <button
            class="secondary mini-action"
            :loading="saving && detailId !== record.id"
            @tap="loadMasterDetail(record)"
          >
            {{ detailId === record.id ? "收起详情" : "查看详情" }}
          </button>
          <button
            v-if="isAdmin"
            class="secondary mini-action"
            @tap="openMasterForm(record)"
          >
            编辑
          </button>
          <button
            v-if="isAdmin"
            class="danger-action mini-action"
            @tap="toggleMasterStatus(record)"
          >
            {{ record.enabled === false ? "启用" : "停用" }}
          </button>
        </view>
        <view
          v-if="detailId === record.id && masterDetail"
          class="detail-panel"
        >
          <template v-if="masterType === 'ITEM'">
            <text
              >供应商：{{ masterDetail.supplierRecord?.name || "未配置" }}</text
            >
            <text
              >默认库位：{{
                masterDetail.defaultLocation?.name || "未配置"
              }}</text
            >
            <text
              >库位/批次余额：{{
                masterDetail.stockBalances?.length || 0
              }}
              条</text
            >
            <text
              >最近库存流水：{{
                masterDetail.transactions?.length || 0
              }}
              条</text
            >
          </template>
          <template v-else-if="masterType === 'SUPPLIER'">
            <text
              >联系人：{{ masterDetail.contactName || "未填写" }}
              {{ masterDetail.contactPhone || "" }}</text
            >
            <text
              >结算：{{ masterDetail.settlementRule?.settlementCycle
              }}<template v-if="masterDetail.type === 'CONSIGNMENT'">
                · 分成
                {{
                  Number(masterDetail.settlementRule?.commissionRateBps || 0) /
                  100
                }}%</template
              ><template v-else>
                · 账期
                {{
                  masterDetail.settlementRule?.paymentTermsDays || 0
                }}
                天</template
              ></text
            >
            <text
              >关联 SKU：{{ masterDetail.items?.length || 0 }} · 最近采购单：{{
                masterDetail.purchaseOrders?.length || 0
              }}</text
            >
          </template>
          <template v-else>
            <text>默认 SKU：{{ masterDetail.defaultItems?.length || 0 }}</text>
            <text>库存分账：{{ masterDetail.stockBalances?.length || 0 }}</text>
            <text
              >最近盘点：{{ masterDetail.stocktakes?.length || 0 }} · 调出单
              {{ masterDetail.sourceOperations?.length || 0 }} · 调入单
              {{ masterDetail.targetOperations?.length || 0 }}</text
            >
          </template>
        </view>
      </view>
      <view v-if="!loading && !masterRecords.length" class="card empty"
        >当前筛选下暂无基础资料。</view
      >
    </template>
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

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14rpx;
  margin-top: 22rpx;
}
.tabs {
  margin-top: 22rpx;
  white-space: nowrap;
}
.tab-row {
  display: flex;
  gap: 10rpx;
}
.tab {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 58rpx;
  margin: 0;
  padding: 0 22rpx;
  line-height: 58rpx;
  font-size: 22rpx;
  background: #eef1ed;
  color: #526057;
}
.tab.active {
  background: #17653d;
  color: #fff;
}
.create {
  margin: 22rpx 0 0;
}
.create-row {
  display: flex;
  gap: 12rpx;
  margin-top: 22rpx;
}
.create-half {
  flex: 1;
  min-width: 0;
  margin: 0;
}
.document {
  box-sizing: border-box;
  width: 100%;
  margin-top: 14rpx;
  padding: 24rpx;
  overflow: hidden;
}
.title {
  display: block;
  margin-bottom: 7rpx;
  font-size: 28rpx;
  font-weight: 800;
}
.quantity {
  font-size: 34rpx;
  font-weight: 900;
  color: #17653d;
}
.quantity.warning {
  color: #b24b2d;
}
.status {
  padding: 6rpx 12rpx;
  border-radius: 12rpx;
  background: #e8f4eb;
  color: #17653d;
  font-size: 20rpx;
}
.status.disabled {
  background: #f2e9e5;
  color: #9a4935;
}
.line {
  display: flex;
  justify-content: space-between;
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid #edf0ed;
  font-size: 23rpx;
}
.action {
  min-height: 60rpx;
  margin: 20rpx 0 0;
  line-height: 60rpx;
  font-size: 22rpx;
}
.usage-row {
  display: flex;
  gap: 12rpx;
  margin-top: 18rpx;
}
.usage-action {
  flex: 1;
  min-width: 0;
  min-height: 58rpx;
  margin: 0;
  line-height: 58rpx;
  font-size: 22rpx;
}
.empty {
  color: #758079;
  text-align: center;
}
.state-card {
  margin-top: 18rpx;
  padding: 24rpx;
  color: #66736b;
  text-align: center;
}
.error-state {
  color: #9a4935;
}
.state-action {
  width: 220rpx;
  min-height: 58rpx;
  margin: 18rpx auto 0;
  line-height: 58rpx;
  font-size: 22rpx;
}
.master-toolbar {
  margin-top: 18rpx;
}
.master-kind-row,
.status-filter-row,
.choice-row,
.master-actions {
  display: flex;
  gap: 10rpx;
}
.kind-button,
.filter-button,
.choice {
  flex: 1;
  min-height: 58rpx;
  margin: 0;
  line-height: 58rpx;
  font-size: 22rpx;
  background: #eef1ed;
  color: #526057;
}
.kind-button.active,
.filter-button.active,
.choice.active {
  background: #17653d;
  color: #fff;
}
.status-filter-row {
  margin-top: 12rpx;
}
.field,
.picker-field {
  box-sizing: border-box;
  width: 100%;
  min-height: 72rpx;
  padding: 16rpx 18rpx;
  border: 1rpx solid #dfe5df;
  border-radius: 14rpx;
  background: #fff;
  color: #24342a;
  font-size: 24rpx;
}
.search-field {
  margin-top: 12rpx;
}
.field-label {
  display: block;
  margin: 18rpx 0 8rpx;
  color: #657168;
  font-size: 21rpx;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12rpx;
}
.field-grid > view {
  min-width: 0;
}
.reason-field {
  height: 120rpx;
}
.master-form {
  margin-top: 16rpx;
  padding: 24rpx;
}
.operation-form {
  box-sizing: border-box;
  width: 100%;
  margin-top: 16rpx;
  padding: 24rpx;
  overflow: hidden;
}
.form-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14rpx;
}
.form-heading > view {
  flex: 1;
  min-width: 0;
}
.readonly-field {
  background: #f4f7f4;
  color: #526057;
}
.form-warning {
  display: block;
  margin-top: 8rpx;
  color: #a44b32;
  font-size: 21rpx;
  overflow-wrap: anywhere;
}
.form-submit {
  box-sizing: border-box;
  width: 100%;
  margin: 22rpx 0 0;
}
.link-button {
  min-height: 50rpx;
  margin: 0;
  padding: 0 14rpx;
  line-height: 50rpx;
  font-size: 21rpx;
  background: transparent;
  color: #17653d;
}
.readonly-note {
  display: block;
  margin-top: 14rpx;
  color: #758079;
  font-size: 22rpx;
}
.master-card .muted {
  display: block;
  margin-top: 8rpx;
}
.master-actions {
  margin-top: 18rpx;
}
.mini-action,
.danger-action {
  flex: 1;
  min-height: 58rpx;
  margin: 0;
  line-height: 58rpx;
  font-size: 21rpx;
}
.danger-action {
  background: #f5e8e3;
  color: #9a4935;
}
.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 16rpx;
  border-radius: 14rpx;
  background: #f4f7f4;
  color: #526057;
  font-size: 22rpx;
}
.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}
.row > view:first-child {
  flex: 1;
  min-width: 0;
}
.row .title,
.row .muted,
.form-heading .title,
.form-heading .muted,
.picker-field,
.line > text {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.status {
  flex: 0 0 auto;
}
.line {
  gap: 12rpx;
}
.line > text:first-child {
  flex: 1;
  min-width: 0;
}
.line > text:last-child {
  flex: 0 0 auto;
}

.deep-link-target {
  border-color: #d69a24 !important;
  box-shadow: 0 0 0 4rpx rgba(214, 154, 36, 0.18);
}
@media (max-width: 430px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
  .create-row,
  .usage-row,
  .master-actions {
    flex-wrap: wrap;
  }
  .create-half,
  .usage-action,
  .mini-action,
  .danger-action {
    flex: 1 1 calc(50% - 8rpx);
    box-sizing: border-box;
  }
  .master-actions > button {
    min-width: 120rpx;
  }
}
</style>
