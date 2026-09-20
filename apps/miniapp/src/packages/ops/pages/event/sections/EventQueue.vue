<script setup lang="ts">
import type { EventSummary } from "../page-types";

import { computed, ref, toRefs } from "vue";
import { shortDate } from "../../../../../utils/format";
import type { EventStatus } from "../page-types.js";

const props = defineProps<{
  statusCounts: Record<string, number>;
  loading: boolean;
  actionKey: string;
  refresh: () => Promise<void>;
  eventList: EventSummary[];
  selectedEventId: string;
  selectEvent: (eventId: string) => Promise<void>;
  statusLabel: (status?: string) => string;
}>();
const {
  statusCounts,
  loading,
  actionKey,
  refresh,
  eventList,
  selectedEventId,
  selectEvent,
  statusLabel,
} = toRefs(props);
const search = ref('');
const visibleEvents = computed(() => props.eventList.filter(event => event.name.includes(search.value.trim())));
</script>

<template>
  <view>
    <view class="queue-header">
      <view>
        <text class="section-title queue-title">赛事队列</text>
        <text class="section-note">
          报名中 {{ (statusCounts.OPEN || 0) + (statusCounts.FULL || 0) }} ·
          进行中 {{ statusCounts.IN_PROGRESS || 0 }} · 草稿
          {{ statusCounts.DRAFT || 0 }}
        </text>
      </view>
      <button
        class="secondary refresh-button"
        :loading="loading"
        :disabled="loading || Boolean(actionKey)"
        @tap="refresh"
      >
        刷新
      </button>
    </view>

    <view class="event-search"><input v-model="search" placeholder="搜索赛事名称" aria-label="搜索赛事名称" /></view>
    <view v-if="visibleEvents.length" class="event-scroll">
      <view class="event-list">
        <button
          v-for="event in visibleEvents"
          :key="event.id"
          class="event-option"
          :class="{ selected: event.id === selectedEventId }"
          :disabled="loading || Boolean(actionKey)"
          @tap="selectEvent(event.id)"
        >
          <view class="option-top"
            ><text class="option-name">{{ event.name }}</text
            ><text class="status-badge" :class="event.status.toLowerCase()">{{
              statusLabel(event.status)
            }}</text></view
          >
          <text class="option-meta"
            >{{ shortDate(event.startsAt) }} · {{ event.currentRound || 0 }}/{{
              event.totalRounds || 5
            }}
            轮 · {{ event._count?.teams || 0 }} 队</text
          >
        </button>
      </view>
    </view>
    <view v-else-if="!loading" class="empty card">没有匹配的赛事</view>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.option-top { display:flex; align-items:center; justify-content:space-between; gap:16rpx; }.option-name { font-size:30rpx; font-weight:600; min-width:0; flex:1; }.option-meta { display:block; font-size:25rpx; margin-top:10rpx; }.status-badge { flex-shrink:0; font-size:24rpx; }.queue-header { display:flex; align-items:center; justify-content:space-between; gap:16rpx; }.refresh-button { width:auto; min-width:100rpx; flex:none; margin:0; }.queue-header .section-note { display:block; margin:8rpx 0 0; }

.event-list { display:grid; gap:0; background:#fff; border-radius:24rpx; overflow:hidden; }.event-option { display:flex; flex-direction:column; align-items:stretch; line-height:1.45; width:100%; margin:0; flex:none; background:#fff; color:#20252b; padding:28rpx 24rpx; border:0; border-radius:0; text-align:left; }.event-option+.event-option { border-top:1rpx solid #e8ece9; }.event-option.selected { background:#fff; color:#20252b; border:0; }.event-search { margin:20rpx 0; padding:0 24rpx; background:#fff; border-radius:20rpx; }.event-search input { height:92rpx; font-size:30rpx; }
</style>
