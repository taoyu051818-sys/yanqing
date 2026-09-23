<script setup lang="ts">
import { openMemberPage } from "../../utils/member-navigation";
import { computed, ref, watch } from "vue";
import { onShow } from "@dcloudio/uni-app";
import AppIcon from "../../components/AppIcon.vue";
import { workItemDescription } from "../../config/status-labels";
import StatusBadge from "../../components/StatusBadge.vue";
import { useVenueProfile } from "../../composables/use-venue-profile";
import { useSessionStore } from "../../stores/session";
import {
  managementKeys,
  visibleWorkspaceTabs,
  workspaceGroups,
  workspaceMenu,
  type WorkspaceTab,
} from "../../config/workspace";
import { workQueueRoute } from "../../config/operations";
import { isUrgentWorkItem } from "../../config/work-items";
import { resolveWorkItemDestination } from "../../utils/work-item-deep-link";
import { venueDateLabel } from "../../utils/format";
import type { WorkItem } from "../../services/api";
import { useWorkspaceData } from "./use-workspace-data";

const venue = useVenueProfile(),
  session = useSessionStore();
const {
  loading,
  loadError,
  workItems,
  loadWork,
  dataLoading,
  dataError,
  days,
  periodLabel,
  metrics,
  loadData,
} = useWorkspaceData();
const activeTab = ref<WorkspaceTab>("today"),
  searchQuery = ref("");
const tabs = computed(() => visibleWorkspaceTabs(session.roles));
const menu = computed(() => workspaceMenu(session.roles));
const groups = computed(() =>
  workspaceGroups
    .map((group) => ({
      ...group,
      items: group.keys.flatMap((key) =>
        menu.value.filter(
          (item) =>
            item.key === key &&
            `${item.title} ${item.description}`.includes(
              searchQuery.value.trim(),
            ),
        ),
      ),
    }))
    .filter((group) => group.items.length),
);
const managementItems = computed(() =>
  menu.value.filter((item) => managementKeys.includes(item.key)),
);
const shortcuts = computed(() =>
  menu.value
    .filter((item) =>
      [
        "transactions",
        "booking",
        "today",
        "training",
        "games",
        "events",
        "alliance",
        "finance",
      ].includes(item.key),
    )
    .slice(0, 4),
);
const priorityItems = computed(() =>
  [...workItems.value]
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, 4),
);
const urgentCount = computed(
  () => workItems.value.filter(isUrgentWorkItem).length,
);
const headings: Record<WorkspaceTab, string> = {
  today: "今日待办",
  business: "业务",
  data: "经营数据",
  manage: "管理",
};
const dateLabel = computed(() => venueDateLabel(new Date()));
watch(tabs, (available) => {
  if (!available.some((tab) => tab.key === activeTab.value))
    activeTab.value = "today";
});
function openRoute(route: string) {
  if (route === "/pages/booking/index") openMemberPage(route + "?mode=ASSISTED");
  else uni.navigateTo({ url: route });
}
function openWork(item: WorkItem) {
  const destination = resolveWorkItemDestination(item, session.roles);
  if (destination) openRoute(destination.url);
  else openRoute(workQueueRoute);
}
function selectTab(tab: WorkspaceTab) {
  activeTab.value = tab;
  uni.pageScrollTo({ scrollTop: 0, duration: 0 });
  if (tab === "data") void loadData();
}
function selectPeriod(value: number) {
  days.value = value;
  void loadData();
}
function backToMember() {
  uni.switchTab({ url: "/pages/home/index" });
}
onShow(async () => {
  void venue.refresh();
  await loadWork();
  if (activeTab.value === "data") void loadData();
});
</script>
<template>
  <view class="workspace">
    <template v-if="session.isOperator">
      <view class="workspace-context"
        ><view
          ><AppIcon name="venue" :size="34" /><text>{{
            venue.profile.value?.name || "球馆经营台"
          }}</text></view
        ><button @tap="backToMember">
          会员端<AppIcon name="chevron" :size="28" /></button
      ></view>
      <view class="workspace-title"
        ><view
          ><text class="title">{{ headings[activeTab] }}</text
          ><text class="muted">{{
            activeTab === "today"
              ? dateLabel
              : activeTab === "business"
                ? "按任务查找"
                : activeTab === "data"
                  ? periodLabel
                  : "球馆、课程、优惠券与人员设置"
          }}</text></view
        ><button
          v-if="activeTab === 'today'"
          aria-label="刷新待办"
          :disabled="loading"
          @tap="loadWork"
        >
          <AppIcon name="refresh" :size="38" /></button
      ></view>
      <template v-if="activeTab === 'today'">
        <view v-if="loading" class="empty" role="status">正在同步待办…</view>
        <view v-else-if="loadError" class="error" role="alert"
          ><text>{{ loadError }}</text
          ><button @tap="loadWork">重试</button></view
        >
        <template v-else>
          <view class="section-heading"
            ><text>{{
              urgentCount ? `${urgentCount} 项需优先处理` : "待处理事项"
            }}</text
            ><button @tap="openRoute(workQueueRoute)">
              全部 {{ workItems.length
              }}<AppIcon name="chevron" :size="26" /></button
          ></view>
          <view class="list-group"
            ><button
              v-for="item in priorityItems"
              :key="item.id"
              class="list-row"
              @tap="openWork(item)"
            >
              <view class="row-copy"
                ><text class="row-title">{{ item.title || "待处理事项" }}</text
                ><text class="muted">{{
                  workItemDescription(item.description) || "查看详情并处理"
                }}</text></view
              ><StatusBadge :value="item.status" domain="work" /><AppIcon
                name="chevron"
                :size="28"
                tone="muted"
              /></button
            ><view v-if="!priorityItems.length" class="empty"
              ><AppIcon name="success" :size="44" /><text
                >当前没有待处理事项</text
              ><text class="muted">可从业务入口继续处理日常工作。</text></view
            ></view
          >
        </template>
        <view class="section-heading"><text>常用业务</text></view
        ><view class="menu-group"
          ><view class="menu-grid"
            ><button
              v-for="item in shortcuts"
              :key="item.key"
              class="menu-tile"
              @tap="openRoute(item.route)"
            >
              <AppIcon :name="item.icon" :size="46" /><text>{{
                item.title
              }}</text>
            </button></view
          ></view
        >
      </template>
      <template v-else-if="activeTab === 'business'">
        <view class="search-box"
          ><AppIcon name="search" :size="32" tone="muted" /><input
            v-model="searchQuery"
            aria-label="搜索业务功能"
            placeholder="搜索功能"
            confirm-type="search"
          /><button v-if="searchQuery" @tap="searchQuery = ''">
            清除
          </button></view
        >
        <view v-for="group in groups" :key="group.title" class="menu-group"
          ><text class="group-title">{{ group.title }}</text
          ><view class="menu-grid"
            ><button
              v-for="item in group.items"
              :key="item.key"
              class="menu-tile"
              hover-class="is-pressed"
              @tap="openRoute(item.route)"
            >
              <AppIcon :name="item.icon" :size="46" /><text>{{
                item.title
              }}</text>
            </button></view
          ></view
        >
        <view v-if="!groups.length" class="empty">没有匹配的功能</view>
      </template>
      <template v-else-if="activeTab === 'data'">
        <view class="period-tabs"
          ><button
            v-for="period in [
              { days: 1, title: '今日' },
              { days: 7, title: '近7天' },
            ]"
            :key="period.days"
            :class="{ selected: days === period.days }"
            :aria-pressed="days === period.days"
            @tap="selectPeriod(period.days)"
          >
            {{ period.title }}
          </button></view
        >
        <view v-if="dataError" class="error" role="alert"
          ><text>{{ dataError }}</text
          ><button @tap="loadData">重试</button></view
        >
        <view class="metrics" :aria-busy="dataLoading"
          ><view v-for="metric in metrics" :key="metric.label" class="metric"
            ><text class="muted">{{ metric.label }}</text
            ><text class="metric-value">{{
              dataLoading ? "…" : metric.value
            }}</text
            ><text class="metric-note">{{ metric.note }}</text></view
          ></view
        >
        <view class="list-group more-data"
          ><button
            class="list-row"
            @tap="openRoute(workQueueRoute + '?view=analytics')"
          >
            <view class="row-copy"
              ><text class="row-title">完整经营分析</text
              ><text class="muted">查看今日收入、培训与活动明细</text></view
            ><AppIcon name="chevron" :size="30" /></button
        ></view>
      </template>
      <view v-else class="list-group"
        ><button
          v-for="item in managementItems"
          :key="item.key"
          class="list-row"
          @tap="openRoute(item.route)"
        >
          <AppIcon :name="item.icon" :size="40" /><view class="row-copy"
            ><text class="row-title">{{ item.title }}</text
            ><text class="muted">{{ item.description }}</text></view
          ><AppIcon name="chevron" :size="30" tone="muted" /></button
      ></view>
      <view class="workspace-nav" aria-label="经营台导航"
        ><button
          v-for="tab in tabs"
          :key="tab.key"
          :aria-pressed="activeTab === tab.key"
          :class="{ selected: activeTab === tab.key }"
          @tap="selectTab(tab.key)"
        >
          <AppIcon
            :name="tab.icon"
            :size="42"
            :tone="activeTab === tab.key ? 'primary' : 'muted'"
          /><text>{{ tab.title }}</text>
        </button></view
      >
    </template>
    <view v-else class="empty"
      ><text class="title">经营台</text
      ><text class="muted">当前账号没有经营角色，可继续使用会员服务。</text
      ><button class="primary" @tap="backToMember">返回会员首页</button></view
    >
  </view>
</template>
<style scoped src="./workspace.css"></style>
