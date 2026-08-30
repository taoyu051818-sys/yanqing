<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../../../components/OperationsFrame.vue";
import MetricCard from "../../../../components/MetricCard.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import { endpoints, type WorkItem } from "../../../../services/api";
import { isMockMode } from "../../../../services/http";
import { useSessionStore } from "../../../../stores/session";
import type { AppRole } from "../../../../types/domain";
import { money, shortDate } from "../../../../utils/format";

type WorkGroupKey =
  | "customer"
  | "refund"
  | "training"
  | "event"
  | "coupon"
  | "inventory"
  | "reconciliation";

type WorkGroupDefinition = {
  key: WorkGroupKey;
  title: string;
  description: string;
  emptyText: string;
  route: string;
  roles: AppRole[];
};

type DisplayWorkGroup = WorkGroupDefinition & { items: WorkItem[] };

const session = useSessionStore();
const dashboard = ref<Record<string, any> | null>(null);
const workItems = ref<WorkItem[]>([]);
const loading = ref(false);
const dashboardError = ref("");
const workItemsError = ref("");
const workItemsNotice = ref("");
const lastSyncedAt = ref("");

const roleNames: Partial<Record<AppRole, string>> = {
  MEMBER: "会员",
  FRONT_DESK: "前台",
  COACH: "教练",
  HOST: "主理人",
  MERCHANT: "商户",
  FINANCE: "财务",
  EVENT_MANAGER: "赛事",
  ADMIN: "管理员",
  SUPER_ADMIN: "超级管理员",
};

const workGroupDefinitions: WorkGroupDefinition[] = [
  {
    key: "customer",
    title: "客户经营",
    description: "线索 SLA、主理人申请与责任交接",
    emptyText: "暂无逾期线索或主理人申请",
    route: "/packages/ops/pages/members/index",
    roles: ["FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "refund",
    title: "资金复核",
    description: "账户调整、退款申请和原路冲正",
    emptyText: "暂无账户调整或退款待复核",
    route: "/packages/ops/pages/finance/index",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "training",
    title: "培训消课",
    description: "点名、消课建议和训练反馈",
    emptyText: "暂无待点名或消课课次",
    route: "/packages/ops/pages/coach/index",
    roles: ["COACH", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "event",
    title: "赛事执行",
    description: "轮次、比分、奖品出库与签收",
    emptyText: "暂无赛事比分或奖品待办",
    route: "/packages/ops/pages/event/index",
    roles: ["EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "coupon",
    title: "联盟券",
    description: "券码领取、核销和归因",
    emptyText: "暂无券待办，可进入联盟营销查看核销",
    route: "/packages/ops/pages/merchant/index",
    roles: ["FRONT_DESK", "MERCHANT", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "inventory",
    title: "库存预警",
    description: "低于安全线的商品与耗材",
    emptyText: "库存均高于安全线",
    route: "/packages/ops/pages/inventory/index",
    roles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    key: "reconciliation",
    title: "对账与结算",
    description: "培训分成、联盟账单和履约异常",
    emptyText: "暂无待处理对账或结算",
    route: "/packages/ops/pages/finance/index",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
];

const centerDefinitions: Array<{
  title: string;
  description: string;
  route: string;
  roles: AppRole[];
}> = [
  {
    title: "场馆资源",
    description: "封场维护日历、占用冲突与可售状态",
    route: "/packages/ops/pages/venue/index",
    roles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "今日营业",
    description: "值班、订单队列、场馆资源",
    route: "/packages/ops/pages/frontdesk/index",
    roles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "会员服务",
    description: "客户360、会员状态与服务上下文",
    route: "/packages/ops/pages/members/index",
    roles: [
      "FRONT_DESK",
      "COACH",
      "HOST",
      "EVENT_MANAGER",
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    ],
  },
  {
    title: "培训运营",
    description: "课表、点名、消课与训练反馈",
    route: "/packages/ops/pages/coach/index",
    roles: ["COACH", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "主理人运营",
    description: "主理人申请、球局和奖励观察期",
    route: "/packages/ops/pages/host/index",
    roles: ["HOST", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "赛事运营",
    description: "报名、比分、排名、奖品出库与签收",
    route: "/packages/ops/pages/event/index",
    roles: ["EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "商品库存",
    description: "SKU、低库存、采购与寄售",
    route: "/packages/ops/pages/inventory/index",
    roles: ["FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "联盟营销",
    description: "商户、券码核销与归因数据",
    route: "/packages/ops/pages/merchant/index",
    roles: ["FRONT_DESK", "MERCHANT", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "财务结算",
    description: "收入、退款、培训分成与联盟结算",
    route: "/packages/ops/pages/finance/index",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
  {
    title: "治理与审计",
    description: "员工微信身份、岗位权限、参数版本、风险与导出",
    route: "/packages/ops/pages/governance/index",
    roles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
  },
];

const roleLabel = computed(() => {
  const roles = session.roles;
  if (roles.includes("SUPER_ADMIN")) return "超级管理员";
  if (roles.includes("ADMIN")) return "管理员";
  const labels = roles.map((role) => roleNames[role]).filter(Boolean);
  return labels.length ? labels.join(" / ") : "待登录";
});

const visibleCenters = computed(() =>
  centerDefinitions.filter((center) => canSee(center.roles)),
);

const groupedWorkItems = computed<DisplayWorkGroup[]>(() =>
  workGroupDefinitions.map((group) => ({
    ...group,
    items: workItems.value.filter((item) => workGroupKey(item) === group.key),
  })),
);

const unmappedItems = computed(() =>
  workItems.value.filter((item) => !workGroupKey(item)),
);
const todoCount = computed(() => workItems.value.length);
const syncLabel = computed(() => {
  if (loading.value) return "同步中";
  return lastSyncedAt.value ? `更新于 ${lastSyncedAt.value}` : "尚未同步";
});

const metrics = computed(() => [
  [
    "场馆利用率",
    `${dashboard.value?.venue?.utilizationRate || 0}%`,
    "今日资源效率",
  ],
  [
    "经营收入",
    money(
      (dashboard.value?.venue?.revenueCents || 0) +
        (dashboard.value?.goods?.revenueCents || 0),
    ),
    "场地 + 商品",
  ],
  ["统一待办", String(todoCount.value), "按当前角色分组"],
  ["新会员", String(dashboard.value?.members?.newMembers || 0), "今日新增"],
]);

const normalizeToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const explicitGroupMap: Record<string, WorkGroupKey> = {
  CUSTOMER: "customer",
  CUSTOMER_LEAD_SLA: "customer",
  HOST_APPLICATION_REVIEW: "customer",
  LEAD: "customer",
  REFUND: "refund",
  REFUNDS: "refund",
  REFUND_REVIEW: "refund",
  ACCOUNT_ADJUSTMENT_REVIEW: "refund",
  TRAINING: "training",
  TRAINING_ATTENDANCE: "training",
  TRAINING_CONSUME: "training",
  ATTENDANCE: "training",
  EVENT: "event",
  EVENT_SCORE: "event",
  EVENT_PRIZE_RECEIPT: "event",
  SCORE: "event",
  COUPON: "coupon",
  COUPON_REVIEW: "coupon",
  COUPON_REDEMPTION: "coupon",
  ALLIANCE_COUPON: "coupon",
  INVENTORY: "inventory",
  LOW_STOCK: "inventory",
  STOCK: "inventory",
  RECONCILIATION: "reconciliation",
  SETTLEMENT: "reconciliation",
  ALLIANCE_SETTLEMENT: "reconciliation",
  TRAINING_SETTLEMENT: "reconciliation",
  ORDER_FULFILLMENT: "reconciliation",
};

function workGroupKey(item: WorkItem): WorkGroupKey | null {
  const explicit =
    explicitGroupMap[normalizeToken(item.group)] ||
    explicitGroupMap[normalizeToken(item.category)];
  if (explicit) return explicit;

  const kind = explicitGroupMap[normalizeToken(item.kind)];
  if (kind) return kind;

  // Keep the compatibility parser deliberately conservative. Unknown future
  // kinds remain visible in the “待识别” notice instead of being assigned to a
  // misleading business queue.
  const searchable =
    `${item.objectType || ""} ${item.title || ""} ${item.description || ""}`.toUpperCase();
  if (/客户|线索|主理人申请|CUSTOMER|LEAD|HOST_APPLICATION/.test(searchable))
    return "customer";
  if (/账户调整|资金复核|退款|ACCOUNT_ADJUSTMENT|REFUND/.test(searchable))
    return "refund";
  if (/培训|点名|消课|TRAINING|ATTENDANCE|CONSUME/.test(searchable))
    return "training";
  if (/赛事|比分|轮次|EVENT|MATCH|SCORE/.test(searchable)) return "event";
  if (/券|核销|COUPON|REDEEM/.test(searchable)) return "coupon";
  if (/库存|安全线|低库存|INVENTORY|STOCK/.test(searchable)) return "inventory";
  if (/对账|结算|履约|RECONCILIATION|SETTLEMENT|FULFILLMENT/.test(searchable))
    return "reconciliation";
  return null;
}

function canSee(roles: AppRole[]) {
  return session.roles.some((role) => roles.includes(role));
}

function extractItems(value: unknown): WorkItem[] {
  if (Array.isArray(value))
    return value.filter((item): item is WorkItem =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof (item as any).id === "string",
      ),
    );
  if (!value || typeof value !== "object") return [];
  const payload = value as { items?: unknown; data?: unknown };
  if (Array.isArray(payload.items)) return extractItems(payload.items);
  if (Array.isArray(payload.data)) return extractItems(payload.data);
  return [];
}

function legacyWorkItems(
  orderPayload: unknown,
  stockPayload: unknown,
): WorkItem[] {
  const items: WorkItem[] = [];
  const orders = extractItems(orderPayload as any);
  orders.forEach((order: any) => {
    const refunds = Array.isArray(order.refunds) ? order.refunds : [];
    const pendingRefunds = refunds.filter((refund: any) =>
      ["REQUESTED", "REFUND_PENDING", "REFUNDING"].includes(refund.status),
    );
    if (pendingRefunds.length) {
      pendingRefunds.forEach((refund: any) =>
        items.push({
          id: `legacy-refund:${refund.id || order.id}`,
          kind: "REFUND_REVIEW",
          objectType: "Refund",
          objectId: refund.id || order.id,
          status: refund.status || "REQUESTED",
          priority: 100,
          title: `退款待审核 · ${order.orderNo || order.id}`,
          description: `${order.title || "订单"}${refund.amountCents ? ` · ${money(refund.amountCents)}` : ""}`,
          createdAt: refund.requestedAt || order.createdAt,
          amountCents: Number(refund.amountCents || order.paidCents || 0),
        }),
      );
      return;
    }
    if (["REFUND_PENDING", "REFUNDING"].includes(order.status)) {
      items.push({
        id: `legacy-refund:${order.id}`,
        kind: "REFUND_REVIEW",
        objectType: "Order",
        objectId: order.id,
        status: order.status,
        priority: 100,
        title: `退款待审核 · ${order.orderNo || order.id}`,
        description: order.title || "订单退款申请",
        createdAt: order.createdAt,
        amountCents: Number(order.paidCents || order.payableCents || 0),
      });
    }
  });

  const stockItems = extractItems(stockPayload as any);
  stockItems.forEach((stock: any) => {
    const current = Number(stock.stock);
    const safe = Number(stock.safeStock);
    if (!Number.isFinite(current) || !Number.isFinite(safe) || current > safe)
      return;
    items.push({
      id: `legacy-stock:${stock.id}`,
      kind: "LOW_STOCK",
      objectType: "InventoryItem",
      objectId: stock.id,
      status: "OPEN",
      priority: 60,
      title: `库存低于安全线 · ${stock.name || stock.sku || stock.id}`,
      description: `当前 ${current} 件，安全线 ${safe} 件`,
      createdAt: stock.updatedAt,
      metadata: {
        sku: stock.sku,
        stock: current,
        safeStock: safe,
        source: "legacy-fallback",
      },
    });
  });
  return items;
}

function previewItems(items: WorkItem[]) {
  return items.slice(0, 3);
}

function workItemMeta(item: WorkItem) {
  const parts = [];
  if (item.description) parts.push(item.description);
  if (item.dueAt) parts.push(`截止 ${shortDate(item.dueAt)}`);
  if (!parts.length && item.createdAt)
    parts.push(`创建于 ${shortDate(item.createdAt)}`);
  return parts.join(" · ") || "待处理";
}

function openCenter(route: string) {
  if (!route) return;
  uni.navigateTo({ url: route });
}

function openGroup(group: DisplayWorkGroup) {
  openCenter(group.route);
}

function openWorkItem(item: WorkItem) {
  const group = groupedWorkItems.value.find((candidate) =>
    candidate.items.some((entry) => entry.id === item.id),
  );
  if (group) openGroup(group);
}

async function load() {
  if (loading.value) return;
  await session.hydrate();
  loading.value = true;
  dashboard.value = null;
  workItems.value = [];
  dashboardError.value = "";
  workItemsError.value = "";
  workItemsNotice.value = "";
  lastSyncedAt.value = "";

  try {
    const [dashboardResult, workItemsResult] = await Promise.allSettled([
      endpoints.dashboard(),
      endpoints.workItems(100),
    ]);

    if (dashboardResult.status === "fulfilled")
      dashboard.value = dashboardResult.value;
    else dashboardError.value = "经营指标暂时无法同步，请稍后重试。";

    if (workItemsResult.status === "fulfilled") {
      workItems.value = extractItems(workItemsResult.value);
    } else {
      // Older API/mock builds do not expose /work-items. Derive only the two
      // queues that already exist in those responses; never invent a pending
      // state for training, events, coupons or settlements.
      const [ordersResult, stockResult] = await Promise.allSettled([
        endpoints.adminOrders(),
        endpoints.lowStock(),
      ]);
      const fallbackItems = legacyWorkItems(
        ordersResult.status === "fulfilled" ? ordersResult.value : null,
        stockResult.status === "fulfilled" ? stockResult.value : null,
      );
      if (
        fallbackItems.length ||
        ordersResult.status === "fulfilled" ||
        stockResult.status === "fulfilled"
      ) {
        workItems.value = fallbackItems;
        workItemsNotice.value = isMockMode
          ? "当前为本机演示模式，统一待办接口未启用，已展示订单与库存兼容队列。"
          : "统一待办接口暂不可用，已回退到订单与库存兼容队列；请安排接口恢复。";
      } else {
        workItemsError.value = "统一待办接口和兼容队列均不可用，请重试。";
      }
    }

    if (
      dashboardResult.status === "fulfilled" ||
      workItemsResult.status === "fulfilled"
    ) {
      lastSyncedAt.value = shortDate(new Date());
    }
  } catch (cause: any) {
    workItemsError.value = cause?.message || "经营数据加载失败，请重试。";
  } finally {
    loading.value = false;
  }
}

onShow(load);
</script>

<template>
  <OperationsFrame
    title="经营管理"
    eyebrow="BUSINESS CONTROL"
    :role="roleLabel"
    description="以统一待办分派跨岗位工作，再进入对应业务中心完成履约、审批和复核。"
  >
    <view class="operator-context card">
      <view>
        <text class="operator-name">{{
          session.user?.displayName || "未登录账号"
        }}</text>
        <text class="muted"
          >当前角色：{{ roleLabel }} · 仅显示有权限的经营中心</text
        >
      </view>
      <text class="sync-time">{{ syncLabel }}</text>
    </view>

    <view v-if="dashboardError" class="error card">
      <text class="error-title">经营指标同步失败</text>
      <text class="muted">{{ dashboardError }}</text>
      <button class="secondary retry" @tap="load">重试同步</button>
    </view>

    <view class="metric-grid">
      <MetricCard
        v-for="item in metrics"
        :key="item[0]"
        :label="item[0]"
        :value="item[1]"
        :note="item[2]"
      />
    </view>

    <view class="section-title"
      >统一待办
      <text class="section-note">{{
        loading ? "同步中" : `${todoCount} 项`
      }}</text></view
    >
    <view v-if="workItemsNotice" class="notice card">{{
      workItemsNotice
    }}</view>

    <view v-if="loading" class="loading-stack">
      <view v-for="index in 3" :key="index" class="card loading-row"
        ><view class="loading-line wide"></view
        ><view class="loading-line"></view
      ></view>
    </view>
    <view v-else-if="workItemsError" class="error card">
      <text class="error-title">统一待办加载失败</text>
      <text class="muted">{{ workItemsError }}</text>
      <button class="secondary retry" @tap="load">重试待办</button>
    </view>
    <view v-else class="todo-list">
      <view
        v-for="group in groupedWorkItems"
        :key="group.key"
        class="card todo-group"
      >
        <view class="group-head">
          <view>
            <text class="group-title">{{ group.title }}</text>
            <text class="muted">{{ group.description }}</text>
          </view>
          <text class="group-count" :class="{ active: group.items.length }">{{
            group.items.length
          }}</text>
        </view>
        <view v-if="group.items.length" class="item-list">
          <view
            v-for="item in previewItems(group.items)"
            :key="item.id"
            class="todo-item"
            @tap="openWorkItem(item)"
          >
            <view class="item-copy"
              ><text class="item-title">{{ item.title || "待处理事项" }}</text
              ><text class="muted item-meta">{{
                workItemMeta(item)
              }}</text></view
            >
            <StatusBadge :value="item.status" />
          </view>
          <text v-if="group.items.length > 3" class="more-hint"
            >还有 {{ group.items.length - 3 }} 项，进入中心查看全部</text
          >
        </view>
        <view v-else class="group-empty">{{ group.emptyText }}</view>
        <button class="secondary group-action" @tap="openGroup(group)">
          {{ group.items.length ? "进入处理" : "打开中心" }}
        </button>
      </view>
      <view v-if="unmappedItems.length" class="card unmapped">
        <text class="error-title"
          >待识别待办 {{ unmappedItems.length }} 项</text
        >
        <text class="muted"
          >接口返回了暂未配置分组的事项，已保留在队列中；请补充 kind/group
          映射后再分派。</text
        >
      </view>
      <view v-if="!todoCount" class="card all-clear"
        ><text class="all-clear-title">当前没有待处理事项</text
        ><text class="muted"
          >全部经营队列均已清空，继续关注今日经营指标和异常提醒。</text
        ></view
      >
    </view>

    <view class="section-title"
      >经营中心
      <text class="section-note">{{ visibleCenters.length }} 个可用</text></view
    >
    <view v-if="visibleCenters.length" class="center-list">
      <view
        v-for="center in visibleCenters"
        :key="center.title"
        class="card center-row"
        @tap="openCenter(center.route)"
      >
        <view
          ><text class="center-title">{{ center.title }}</text
          ><text class="muted">{{ center.description }}</text></view
        >
        <text class="arrow">›</text>
      </view>
    </view>
    <view v-else class="empty card"
      >当前账号没有可见的经营中心，请联系管理员分配角色。</view
    >

    <view class="card boundary"
      ><text class="muted"
        >经营中心只负责分派和复核。余额、积分、库存、退款、比分和结算必须通过后端状态动作留痕；本页不直接修改业务状态。</text
      ></view
    >
  </OperationsFrame>
</template>

<style scoped>
.operator-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  margin-top: 22rpx;
  padding: 22rpx 24rpx;
}
.operator-name {
  display: block;
  margin-bottom: 8rpx;
  font-size: 28rpx;
  font-weight: 800;
}
.sync-time {
  flex: 0 0 auto;
  color: #17653d;
  font-size: 21rpx;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14rpx;
  margin-top: 18rpx;
}
.section-note {
  color: #758079;
  font-size: 22rpx;
  font-weight: 400;
}
.notice {
  margin-top: 16rpx;
  color: #6d5a24;
  background: #fff4d8;
  line-height: 1.6;
}
.error {
  margin-top: 16rpx;
  color: #8a3636;
  background: #fbeaea;
  line-height: 1.6;
}
.error-title {
  display: block;
  margin-bottom: 8rpx;
  font-size: 26rpx;
  font-weight: 800;
}
.retry {
  width: 100%;
  margin: 18rpx 0 0;
}
.loading-stack {
  display: grid;
  gap: 14rpx;
}
.loading-row {
  padding: 24rpx;
}
.loading-line {
  width: 55%;
  height: 22rpx;
  margin-top: 12rpx;
  background: #edf1ee;
  border-radius: 999rpx;
}
.loading-line.wide {
  width: 78%;
  margin-top: 0;
}
.todo-list {
  display: grid;
  gap: 14rpx;
}
.todo-group {
  padding: 24rpx;
}
.group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}
.group-title {
  display: block;
  margin-bottom: 8rpx;
  font-size: 29rpx;
  font-weight: 800;
}
.group-count {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 48rpx;
  height: 48rpx;
  color: #758079;
  background: #eef2ef;
  border-radius: 999rpx;
  font-size: 24rpx;
  font-weight: 800;
}
.group-count.active {
  color: #9b6300;
  background: #fff2d6;
}
.item-list {
  margin-top: 18rpx;
  border-top: 1rpx solid #edf0ed;
}
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  padding: 18rpx 0;
  border-bottom: 1rpx solid #edf0ed;
}
.item-copy {
  min-width: 0;
  flex: 1;
}
.item-title {
  display: block;
  overflow: hidden;
  margin-bottom: 6rpx;
  font-size: 25rpx;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-meta {
  display: block;
  overflow: hidden;
  font-size: 21rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.more-hint {
  display: block;
  padding-top: 14rpx;
  color: #758079;
  font-size: 21rpx;
}
.group-empty,
.all-clear {
  color: #758079;
}
.group-empty {
  padding: 20rpx 0 4rpx;
  font-size: 23rpx;
}
.group-action {
  width: 100%;
  margin: 18rpx 0 0;
}
.unmapped {
  color: #6d5a24;
  background: #fff8e8;
  line-height: 1.6;
}
.all-clear {
  padding: 28rpx 24rpx;
  text-align: center;
}
.all-clear-title {
  display: block;
  margin-bottom: 8rpx;
  color: #17653d;
  font-size: 29rpx;
  font-weight: 800;
}
.center-list {
  display: grid;
  gap: 0;
}
.center-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: 0;
  padding: 22rpx 24rpx;
  border-radius: 0;
  box-shadow: none;
}
.center-row:first-child {
  border-radius: 28rpx 28rpx 0 0;
}
.center-row:last-child {
  border-radius: 0 0 28rpx 28rpx;
}
.center-title {
  display: block;
  margin-bottom: 8rpx;
  font-size: 28rpx;
  font-weight: 800;
}
.arrow {
  color: #17653d;
  font-size: 40rpx;
}
.empty {
  color: #758079;
  text-align: center;
}
.boundary {
  margin-top: 22rpx;
  line-height: 1.7;
}
</style>
