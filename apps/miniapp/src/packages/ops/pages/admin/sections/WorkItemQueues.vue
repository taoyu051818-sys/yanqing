<script setup lang="ts">
import type { DisplayWorkGroup } from "../page-types";
import { toRefs } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { WorkItem } from "../../../../../services/api";

const props = defineProps<{
  loading: boolean;
  todoCount: number;
  workItemsNotice: string;
  workItemsError: string;
  load: () => Promise<void>;
  groupedWorkItems: DisplayWorkGroup[];
  previewItems: (items: WorkItem[]) => WorkItem[];
  openWorkItem: (item: WorkItem) => void;
  workItemMeta: (item: WorkItem) => string;
  openGroup: (group: DisplayWorkGroup) => void;
  unmappedItems: {
    id: string;
    kind?: string | undefined;
    group?: string | undefined;
    category?: string | undefined;
    objectType?: string | undefined;
    objectId?: string | undefined;
    status?: string | undefined;
    priority?: number | undefined;
    title?: string | undefined;
    description?: string | undefined;
    ownerRoles?: string[] | undefined;
    createdAt?: string | undefined;
    dueAt?: string | undefined;
    amountCents?: number | undefined;
    action?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }[];
}>();
const {
  loading,
  todoCount,
  workItemsNotice,
  workItemsError,
  load,
  groupedWorkItems,
  previewItems,
  openWorkItem,
  workItemMeta,
  openGroup,
  unmappedItems,
} = toRefs(props);
</script>

<template>
  <view>
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
            <view class="item-status">
              <StatusBadge :value="item.status" />
            </view>
          </view>
          <text v-if="group.items.length > 3" class="more-hint"
            >还有 {{ group.items.length - 3 }} 项，进入业务中心查看全部</text
          >
        </view>
        <view v-else class="group-empty">{{ group.emptyText }}</view>
        <button class="secondary group-action" @tap="openGroup(group)">
          {{ group.items.length ? "进入处理" : "打开业务中心" }}
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
          >全部经营队列均已清空，可返回工作台进入业务中心。</text
        ></view
      >
    </view>
  </view>
</template>

<style scoped src="../page.css"></style>
