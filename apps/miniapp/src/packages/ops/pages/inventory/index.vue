<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import MetricCard from "../../../../components/MetricCard.vue";
import OperationsFrame from "../../../../components/OperationsFrame.vue";
import { endpoints } from "../../../../services/api";
import { useSessionStore } from "../../../../stores/session";
import { idempotencyKey, money } from "../../../../utils/format";

type Tab = "STOCK" | "PURCHASE" | "STOCKTAKE" | "MOVEMENT";

const session = useSessionStore();
const tab = ref<Tab>("STOCK");
const loading = ref(false);
const items = ref<any[]>([]);
const suppliers = ref<any[]>([]);
const locations = ref<any[]>([]);
const purchaseOrders = ref<any[]>([]);
const stocktakes = ref<any[]>([]);
const operations = ref<any[]>([]);

const isAdmin = computed(() =>
  session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
);
const canOperate = computed(() =>
  session.roles.some((role) =>
    ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"].includes(role),
  ),
);
const lowStock = computed(() =>
  items.value.filter((item) => Number(item.stock) <= Number(item.safeStock)),
);
const metrics = computed(() => [
  ["库存 SKU", String(items.value.length), `低库存 ${lowStock.value.length}`],
  [
    "待审批采购",
    String(
      purchaseOrders.value.filter((item) => item.status === "SUBMITTED").length,
    ),
    "制单与审批分离",
  ],
  [
    "待复核盘点",
    String(stocktakes.value.filter((item) => item.status === "REVIEW").length),
    "差异过账",
  ],
  [
    "待过账单据",
    String(
      operations.value.filter((item) => item.status === "APPROVED").length,
    ),
    "调拨 / 报损",
  ],
]);

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

async function load() {
  await session.hydrate();
  loading.value = true;
  try {
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
  } catch (cause: any) {
    uni.showToast({
      title: cause.message || "库存工作台加载失败",
      icon: "none",
    });
  } finally {
    loading.value = false;
  }
}

async function positiveInteger(title: string, placeholder = "请输入数量") {
  const result = await uni.showModal({
    title,
    editable: true,
    placeholderText: placeholder,
  });
  if (!result.confirm) return null;
  const value = Number(result.content);
  if (!Number.isInteger(value) || value < 1) {
    uni.showToast({ title: "请输入正整数", icon: "none" });
    return null;
  }
  return value;
}

async function run(action: () => Promise<unknown>, message: string) {
  try {
    await action();
    uni.showToast({ title: message, icon: "success" });
    await load();
  } catch (cause: any) {
    uni.showModal({
      title: "操作未完成",
      content: cause.message || "请检查单据状态",
      showCancel: false,
    });
  }
}

async function createPurchaseOrder() {
  const item = items.value[0];
  const supplier = suppliers.value.find((entry) => entry.enabled !== false);
  const location = locations.value.find((entry) => entry.enabled !== false);
  if (!item || !supplier || !location)
    return uni.showToast({ title: "请先配置商品、供应商和库位", icon: "none" });
  const quantity = await positiveInteger(`采购 ${item.name}`);
  if (!quantity) return;
  await run(
    () =>
      endpoints.createPurchaseOrder({
        supplierId: supplier.id,
        lines: [
          {
            itemId: item.id,
            locationId: location.id,
            orderedQuantity: quantity,
            unitCostCents: item.purchasePriceCents,
            batchCode: "DEFAULT",
          },
        ],
        remark: "小程序经营工作台制单",
      }),
    "采购单已建立",
  );
}

async function purchaseAction(order: any) {
  if (order.status === "DRAFT")
    return run(() => endpoints.submitPurchaseOrder(order.id), "已提交审批");
  if (order.status === "SUBMITTED")
    return run(() => endpoints.approvePurchaseOrder(order.id), "采购单已审批");
  if (["APPROVED", "PARTIAL_RECEIVED"].includes(order.status)) {
    const line = order.lines.find(
      (entry: any) => entry.receivedQuantity < entry.orderedQuantity,
    );
    if (!line) return;
    const remaining = line.orderedQuantity - line.receivedQuantity;
    const quantity = await positiveInteger(
      `收货 ${line.item?.name || "采购商品"}`,
      `未收 ${remaining}`,
    );
    if (!quantity) return;
    return run(
      () =>
        endpoints.receivePurchaseOrder(order.id, {
          lines: [{ lineId: line.id, quantity }],
          idempotencyKey: idempotencyKey(`receipt-${order.id}`),
        }),
      "收货已过账",
    );
  }
}

function purchaseActionLabel(order: any) {
  if (order.status === "DRAFT") return "提交";
  if (order.status === "SUBMITTED" && isAdmin.value) return "审批";
  if (["APPROVED", "PARTIAL_RECEIVED"].includes(order.status)) return "收货";
  return "";
}

async function createStocktake() {
  const location = locations.value.find((entry) => entry.enabled !== false);
  if (!location) return uni.showToast({ title: "请先配置库位", icon: "none" });
  await run(
    () =>
      endpoints.createStocktake({
        locationId: location.id,
        reason: "日常库位盘点",
      }),
    "盘点单已建立",
  );
}

async function stocktakeAction(document: any) {
  if (document.status === "DRAFT")
    return run(() => endpoints.startStocktake(document.id), "已开始盘点");
  if (document.status === "COUNTING") {
    const line = document.lines.find(
      (entry: any) => entry.countedQuantity === null,
    );
    if (line) {
      const result = await uni.showModal({
        title: `实盘 ${line.item?.name || "商品"}`,
        content: `账面 ${line.bookQuantity}`,
        editable: true,
        placeholderText: "输入实盘数量",
      });
      if (!result.confirm) return;
      const counted = Number(result.content);
      if (!Number.isInteger(counted) || counted < 0)
        return uni.showToast({ title: "数量必须为非负整数", icon: "none" });
      return run(
        () => endpoints.countStocktakeLine(document.id, line.id, counted),
        "实盘数已保存",
      );
    }
    return run(() => endpoints.submitStocktake(document.id), "已提交复核");
  }
  if (document.status === "REVIEW")
    return run(
      () =>
        endpoints.postStocktake(
          document.id,
          idempotencyKey(`stocktake-${document.id}`),
        ),
      "盘点差异已过账",
    );
}

async function createMovement(type: "TRANSFER" | "LOSS") {
  const item = items.value[0];
  const source = locations.value[0];
  const target = locations.value[1];
  if (!item || !source || (type === "TRANSFER" && !target))
    return uni.showToast({ title: "商品或库位配置不完整", icon: "none" });
  const quantity = await positiveInteger(
    `${type === "TRANSFER" ? "调拨" : "报损"} ${item.name}`,
  );
  if (!quantity) return;
  await run(
    () =>
      endpoints.createInventoryOperation({
        type,
        itemId: item.id,
        quantity,
        sourceLocationId: source.id,
        ...(type === "TRANSFER" ? { targetLocationId: target.id } : {}),
        batchCode: "DEFAULT",
        reason: type === "TRANSFER" ? "经营库位调拨" : "现场破损报废",
      }),
    `${type === "TRANSFER" ? "调拨" : "报损"}单已建立`,
  );
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

onShow(load);
</script>

<template>
  <OperationsFrame
    title="库存作业中心"
    eyebrow="INVENTORY OPERATIONS"
    role="前台经办 / 管理员审批 / 财务只读"
    description="采购、分批收货、盘点、调拨和报损均以单据状态流转，不直接改写库存。"
  >
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
          v-for="entry in [
            ['STOCK', '库存'],
            ['PURCHASE', '采购收货'],
            ['STOCKTAKE', '盘点'],
            ['MOVEMENT', '调拨报损'],
          ]"
          :key="entry[0]"
          class="tab"
          :class="{ active: tab === entry[0] }"
          @tap="tab = entry[0] as Tab"
        >
          {{ entry[1] }}
        </button></view
      ></scroll-view
    >

    <template v-if="tab === 'STOCK'">
      <view v-for="item in items" :key="item.id" class="card document"
        ><view class="row"
          ><view
            ><text class="title">{{ item.name }}</text
            ><text class="muted"
              >{{ item.sku }} ·
              {{ item.mode === "CONSIGNMENT" ? "寄售" : "自营" }} · 安全线
              {{ item.safeStock }}</text
            ></view
          ><text
            class="quantity"
            :class="{ warning: item.stock <= item.safeStock }"
            >{{ item.stock }}</text
          ></view
        ><text class="muted">售价 {{ money(item.salePriceCents) }}</text></view
      >
    </template>

    <template v-else-if="tab === 'PURCHASE'">
      <button
        v-if="canOperate"
        class="primary create"
        @tap="createPurchaseOrder"
      >
        新建采购单
      </button>
      <view
        v-for="order in purchaseOrders"
        :key="order.id"
        class="card document"
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

    <template v-else-if="tab === 'STOCKTAKE'">
      <button v-if="canOperate" class="primary create" @tap="createStocktake">
        新建盘点单
      </button>
      <view
        v-for="document in stocktakes"
        :key="document.id"
        class="card document"
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

    <template v-else>
      <view v-if="canOperate" class="create-row"
        ><button
          class="secondary create-half"
          @tap="createMovement('TRANSFER')"
        >
          新建调拨</button
        ><button class="primary create-half" @tap="createMovement('LOSS')">
          新建报损
        </button></view
      >
      <view
        v-for="document in operations"
        :key="document.id"
        class="card document"
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
  margin: 0;
}
.document {
  margin-top: 14rpx;
  padding: 24rpx;
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
.empty {
  color: #758079;
  text-align: center;
}
.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}
</style>
