<script setup lang="ts">
import type { EventSummary } from "../page-types";

import { toRefs } from "vue";
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

    <scroll-view
      v-if="eventList.length"
      class="event-scroll"
      scroll-x
      enable-flex
    >
      <view class="event-list">
        <button
          v-for="event in eventList"
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
    </scroll-view>
  </view>
</template>

<style scoped src="../page.css"></style>
