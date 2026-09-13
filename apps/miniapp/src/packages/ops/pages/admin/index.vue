<script setup lang="ts">
import type { DisplayWorkGroup, ManagementView } from "./page-types";

import OperatingAnalytics from "./sections/OperatingAnalytics.vue";
import WorkItemQueues from "./sections/WorkItemQueues.vue";

import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import OperationsFrame from "../../components/OperationsFrame.vue";
import MetricCard from "../../../../components/MetricCard.vue";
import StatusBadge from "../../../../components/StatusBadge.vue";
import { hasOperationsAccess } from "../../../../config/operations";
import {
  workGroupDefinitions,
  workGroupKey,
  type WorkGroupDefinition,
} from "../../../../config/work-items";
import { endpoints, type WorkItem } from "../../../../services/api";
import { isMockMode } from "../../../../services/http";
import { useSessionStore } from "../../../../stores/session";
import type { AppRole } from "../../../../types/domain";
import { money, shortDate } from "../../../../utils/format";
import { workGroupRoute } from "../../../../config/work-items";
import { resolveWorkItemDestination } from "../../../../utils/work-item-deep-link";

const session = useSessionStore();
const dashboard = ref<Record<string, any> | null>(null);
const workItems = ref<WorkItem[]>([]);
const loading = ref(false);
const dashboardError = ref("");
const workItemsError = ref("");
const workItemsNotice = ref("");
const lastSyncedAt = ref("");
const activeView = ref<ManagementView>("work");

const managementViews: Array<{ key: ManagementView; title: string }> = [
  { key: "work", title: "待办与异常" },
  { key: "analytics", title: "经营分析" },
];

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

const roleLabel = computed(() => {
  const roles = session.roles;
  if (roles.includes("SUPER_ADMIN")) return "超级管理员";
  if (roles.includes("ADMIN")) return "管理员";
  const labels = roles.map((role) => roleNames[role]).filter(Boolean);
  return labels.length ? labels.join(" / ") : "待登录";
});

const canViewDashboard = computed(() =>
  canSee(["FINANCE", "ADMIN", "SUPER_ADMIN"]),
);
const showAnalytics = computed(
  () => canViewDashboard.value && activeView.value === "analytics",
);

const groupedWorkItems = computed<DisplayWorkGroup[]>(() =>
  workGroupDefinitions
    .filter((group) => canSee(group.roles))
    .map((group) => ({
      ...group,
      route: workGroupRoute(group, session.roles),
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

const percent = (value: unknown) => {
  const parsed = Number(value || 0);
  return `${Number.isFinite(parsed) ? parsed.toFixed(2).replace(/\.00$/, "") : "0"}%`;
};
const basisPointsPercent = (value: unknown) =>
  percent(Number(value || 0) / 100);

const metrics = computed(() => [
  [
    "总出租率",
    percent(dashboard.value?.venue?.utilizationRate),
    "按可售场地小时",
  ],
  [
    "白天出租率",
    percent(dashboard.value?.venue?.daytimeUtilizationRate),
    "晨练 + 白天时段",
  ],
  [
    "黄金出租率",
    percent(dashboard.value?.venue?.primeUtilizationRate),
    "晚高峰与夜场",
  ],
  ["RevPAH", money(dashboard.value?.venue?.revpahCents), "每可售场地小时收入"],
  [
    "已实现收入",
    money(dashboard.value?.revenue?.realizedRevenueCents),
    "排除充值与培训预收",
  ],
  [
    "30日复购",
    percent(dashboard.value?.members?.thirtyDayRepurchase?.rate),
    "真实付费订单口径",
  ],
  [
    "培训现金毛利",
    money(dashboard.value?.training?.cashContributionMarginCents),
    "确认收入减直接成本",
  ],
  ["统一待办", String(todoCount.value), "按当前角色分组"],
]);

const decisionPanels = computed(() => [
  {
    title: "经营分成口径",
    note: "逐笔使用订单保存的规则版本；退款按原比例反冲",
    items: [
      [
        "已履约净收入基数",
        money(dashboard.value?.operatingShare?.basisRevenueCents),
      ],
      [
        "期末适用比例",
        basisPointsPercent(dashboard.value?.operatingShare?.rateAtPeriodEndBps),
      ],
      ["本期分成计提", money(dashboard.value?.operatingShare?.accruedCents)],
      ["会员充值", "预收款，不参与"],
    ],
  },
  {
    title: "收款、预收与收入",
    note: "资金流入不等于当期收入",
    items: [
      [
        "现金收款",
        money(
          dashboard.value?.collections?.cashCollectedCents ??
            dashboard.value?.collections?.grossPaymentCents,
        ),
      ],
      [
        "现金净流入",
        money(
          dashboard.value?.collections?.netCashCents ??
            dashboard.value?.collections?.netPaymentCents,
        ),
      ],
      [
        "充值新增预收",
        money(dashboard.value?.collections?.rechargePrepaidCents),
      ],
      [
        "培训新增预收",
        money(dashboard.value?.collections?.trainingPrepaidCollectedCents),
      ],
      ["当期已实现收入", money(dashboard.value?.revenue?.realizedRevenueCents)],
    ],
  },
  {
    title: "培训利润与合同口径",
    note: "占场只做资源分析，场地费恒为 0",
    items: [
      ["消课确认收入", money(dashboard.value?.training?.confirmedRevenueCents)],
      ["未消课预收余额", money(dashboard.value?.training?.unusedBalanceCents)],
      ["本期培训退费", money(dashboard.value?.training?.refundedCents)],
      [
        "20%场馆合同流水",
        money(dashboard.value?.training?.venueContributionCents),
      ],
      [
        "现金贡献毛利",
        money(dashboard.value?.training?.cashContributionMarginCents),
      ],
      [
        "每占场小时贡献",
        money(dashboard.value?.training?.resourceEfficiencyCentsPerCourtHour),
      ],
    ],
  },
  {
    title: "会员与营销健康度",
    note: "复购与有效转化优先于注册量",
    items: [
      [
        "新增 / 有效会员",
        `${dashboard.value?.members?.newMembers || 0} / ${dashboard.value?.members?.activeMembers || 0}`,
      ],
      [
        "7日 / 30日复购",
        `${percent(dashboard.value?.members?.sevenDayRepurchase?.rate)} / ${percent(dashboard.value?.members?.thirtyDayRepurchase?.rate)}`,
      ],
      [
        "30天内到期 / 流失预警",
        `${dashboard.value?.members?.expiringWithin30Days || 0} / ${dashboard.value?.members?.inactiveOver30Days || 0}`,
      ],
      [
        "本期推荐绑定 / 有效首单",
        `${dashboard.value?.marketing?.directReferralBindings || 0} / ${dashboard.value?.marketing?.directReferralConversions || 0}`,
      ],
      ["券核销率", percent(dashboard.value?.marketing?.couponRedemptionRate)],
    ],
  },
  {
    title: "商品与联盟回报",
    note: "毛利和真实核销共同约束投放",
    items: [
      [
        "商品销售 / 毛利",
        `${money(dashboard.value?.goods?.revenueCents)} / ${money(dashboard.value?.goods?.grossProfitCents)}`,
      ],
      ["商品毛利率", percent(dashboard.value?.goods?.grossMarginRate)],
      ["低库存预警", String(dashboard.value?.goods?.lowStockCount || 0)],
      [
        "当期结算毛利 / 合作费",
        `${money(dashboard.value?.alliance?.attributedGrossProfitCents)} / ${money(dashboard.value?.alliance?.cooperationFeeCents)}`,
      ],
      [
        "当期结算 ROI",
        dashboard.value?.alliance?.roi == null
          ? "—"
          : Number(dashboard.value.alliance.roi).toFixed(2),
      ],
    ],
  },
]);

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

function openRoute(route: string) {
  if (!route) return;
  uni.navigateTo({ url: route });
}

function openGroup(group: DisplayWorkGroup) {
  openRoute(group.route);
}

function openWorkItem(item: WorkItem) {
  const destination = resolveWorkItemDestination(item, session.roles);
  if (!destination) {
    uni.showToast({ title: "该待办缺少可识别的处理入口", icon: "none" });
    return;
  }
  openRoute(destination.url);
}

async function load() {
  if (loading.value) return;
  await session.hydrate();
  if (!hasOperationsAccess(session.roles, "workQueue")) return;
  loading.value = true;
  dashboard.value = null;
  workItems.value = [];
  dashboardError.value = "";
  workItemsError.value = "";
  workItemsNotice.value = "";
  lastSyncedAt.value = "";

  try {
    const [dashboardResult, workItemsResult] = await Promise.allSettled([
      canViewDashboard.value ? endpoints.dashboard() : Promise.resolve(null),
      endpoints.workItems(100),
    ]);

    if (dashboardResult.status === "fulfilled") {
      dashboard.value = dashboardResult.value;
    } else if (canViewDashboard.value) {
      dashboardError.value = "经营指标暂时无法同步，请稍后重试。";
    }

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

onLoad((query) => {
  if (query?.view === "analytics") activeView.value = "analytics";
});
onShow(load);
</script>

<template>
  <OperationsFrame
    access="workQueue"
    icon="analytics"
    title="经营总览"
    eyebrow="BUSINESS CONTROL"
    :role="roleLabel"
    description="待办与异常优先处理；经营指标独立查看，不让分析信息挤占现场工作入口。"
  >
    <view class="operator-context card">
      <view>
        <text class="operator-name">{{
          session.user?.displayName || "未登录账号"
        }}</text>
        <text class="muted"
          >当前角色：{{ roleLabel }} · 待办按岗位权限和责任范围分派</text
        >
      </view>
      <text class="sync-time">{{ syncLabel }}</text>
    </view>

    <view v-if="canViewDashboard" class="view-switch">
      <view
        v-for="view in managementViews"
        :key="view.key"
        class="view-option"
        :class="{ active: activeView === view.key }"
        @tap="activeView = view.key"
        >{{ view.title }}</view
      >
    </view>

    <OperatingAnalytics
      v-if="showAnalytics"
      :showAnalytics="showAnalytics"
      :dashboardError="dashboardError"
      :load="load"
      :metrics="metrics"
      :decisionPanels="decisionPanels"
    />

    <WorkItemQueues
      v-else
      :loading="loading"
      :todoCount="todoCount"
      :workItemsNotice="workItemsNotice"
      :workItemsError="workItemsError"
      :load="load"
      :groupedWorkItems="groupedWorkItems"
      :previewItems="previewItems"
      :openWorkItem="openWorkItem"
      :workItemMeta="workItemMeta"
      :openGroup="openGroup"
      :unmappedItems="unmappedItems"
    />

    <view class="card boundary"
      ><text class="muted"
        >本页只负责汇总、分派和复核。余额、积分、库存、退款、比分和结算必须通过对应业务中心的状态动作留痕。</text
      ></view
    >
  </OperationsFrame>
</template>

<style scoped src="./page.css"></style>
