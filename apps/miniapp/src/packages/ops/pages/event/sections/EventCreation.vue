<script setup lang="ts">
import { toRefs, computed, ref, watch } from "vue";
import { previousEvening } from "../deadline-preset";
import { today as shanghaiDate } from "../../../../../utils/format";

const props = defineProps<{
  mayManageEvent: boolean;
  eventCode: string;
  eventName: string;
  eventDate: string;
  eventTime: string;
  registrationEndDate: string;
  registrationEndTime: string;
  capacityOptions: number[];
  eventCapacityIndex: number;
  eventFeeYuan: string;
  eventSponsor: string;
  actionKey: string;
  loading: boolean;
  createEvent: () => Promise<void>;
}>();
const emit = defineEmits<{
  (event: "update:eventCode", value: string): void;
  (event: "update:eventName", value: string): void;
  (event: "update:eventDate", value: string): void;
  (event: "update:eventTime", value: string): void;
  (event: "update:registrationEndDate", value: string): void;
  (event: "update:registrationEndTime", value: string): void;
  (event: "update:eventCapacityIndex", value: number): void;
  (event: "update:eventFeeYuan", value: string): void;
  (event: "update:eventSponsor", value: string): void;
}>();
const { mayManageEvent, capacityOptions, actionKey, loading, createEvent } =
  toRefs(props);
const eventCode = computed({
  get: () => props.eventCode,
  set: (value) => emit("update:eventCode", value),
});
const eventName = computed({
  get: () => props.eventName,
  set: (value) => emit("update:eventName", value),
});
const eventDate = computed({
  get: () => props.eventDate,
  set: (value) => emit("update:eventDate", value),
});
const eventTime = computed({
  get: () => props.eventTime,
  set: (value) => emit("update:eventTime", value),
});
const registrationEndDate = computed({
  get: () => props.registrationEndDate,
  set: (value) => emit("update:registrationEndDate", value),
});
const registrationEndTime = computed({
  get: () => props.registrationEndTime,
  set: (value) => emit("update:registrationEndTime", value),
});
const eventCapacityIndex = computed({
  get: () => props.eventCapacityIndex,
  set: (value) => emit("update:eventCapacityIndex", value),
});
const eventFeeYuan = computed({
  get: () => props.eventFeeYuan,
  set: (value) => emit("update:eventFeeYuan", value),
});
const eventSponsor = computed({
  get: () => props.eventSponsor,
  set: (value) => emit("update:eventSponsor", value),
});
const deadlinePreset = ref(props.registrationEndDate === previousEvening(props.eventDate)?.date && props.registrationEndTime === '20:00');
function applyPreset() {
  const preset = previousEvening(props.eventDate); if (!preset) return;
  deadlinePreset.value = true; registrationEndDate.value = preset.date; registrationEndTime.value = preset.time;
}
watch(eventDate, () => { if (deadlinePreset.value) applyPreset(); });
</script>

<template>
  <view>
    <template v-if="mayManageEvent">
      <view class="section-title">创建赛事</view>
      <view class="card create-event-form">
        <view class="form-grid">
          <view
            ><text class="field-label">赛事名称</text
            ><input
              v-model="eventName"
              class="text-input"
              maxlength="120"
              placeholder="例如：延庆周末积分赛"
          /></view>
        </view>
        <view class="form-grid">
          <picker
            mode="date"
            :value="eventDate"
            :start="shanghaiDate()"
            @change="eventDate = ($event.detail as any).value"
            ><view
              ><text class="field-label">开赛日期</text
              ><view class="picker-value">{{ eventDate }} ›</view></view
            ></picker
          >
          <picker
            mode="time"
            :value="eventTime"
            @change="eventTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">开赛时间</text
              ><view class="picker-value">{{ eventTime }} ›</view></view
            ></picker
          >
        </view>
        <text class="field-label">报名截止</text>
        <view class="deadline-options"><button :class="deadlinePreset ? 'primary' : 'secondary'" @tap="applyPreset">开赛前一天 20:00</button><button :class="!deadlinePreset ? 'primary' : 'secondary'" @tap="deadlinePreset = false">自定义</button></view>
        <text v-if="deadlinePreset" class="deadline-value">{{ registrationEndDate }} {{ registrationEndTime }} 截止</text>
        <view v-if="!deadlinePreset" class="form-grid">
          <picker
            mode="date"
            :value="registrationEndDate"
            :start="shanghaiDate()"
            @change="registrationEndDate = ($event.detail as any).value"
            ><view
              ><text class="field-label">报名截止日期</text
              ><view class="picker-value"
                >{{ registrationEndDate }} ›</view
              ></view
            ></picker
          >
          <picker
            mode="time"
            :value="registrationEndTime"
            @change="registrationEndTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">报名截止时间</text
              ><view class="picker-value"
                >{{ registrationEndTime }} ›</view
              ></view
            ></picker
          >
        </view>
        <view class="form-grid">
          <picker
            :range="capacityOptions"
            :value="eventCapacityIndex"
            @change="eventCapacityIndex = Number(($event.detail as any).value)"
            ><view
              ><text class="field-label">人数上限</text
              ><view class="picker-value"
                >{{ capacityOptions[eventCapacityIndex] }} 人 ›</view
              ></view
            ></picker
          >
          <view
            ><text class="field-label">报名费（元）</text
            ><input v-model="eventFeeYuan" class="text-input" type="digit"
          /></view>
        </view>
        <view
          ><text class="field-label">赞助方（选填）</text
          ><input
            v-model="eventSponsor"
            class="text-input"
            maxlength="100"
            placeholder="无赞助可留空"
        /></view>
        <text class="create-guardrail"
          >赛制锁定为固定双打、24 人成赛、24-48
          人双数容量、五轮瑞士制。创建得到草稿，必须二次确认发布才开放报名。</text
        >
        <view class="create-save-bar"><button
          class="primary"
          :loading="actionKey === 'create-event'"
          :disabled="loading || Boolean(actionKey)"
          @tap="createEvent"
        >
          创建赛事草稿
        </button></view>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>.create-event-form { margin-bottom:calc(150rpx + env(safe-area-inset-bottom)); }.create-save-bar { position:fixed; bottom:0; left:0; right:0; z-index:20; padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #e2e7e3; }.create-save-bar button { width:100%; margin:0; }</style>

<style scoped>.deadline-options{display:flex;gap:12rpx;margin:12rpx 0}.deadline-options button{flex:1;min-height:48px;margin:0;font-size:26rpx;padding:16rpx 8rpx;line-height:1.6}.deadline-value{display:block;margin-bottom:24rpx;font-size:28rpx;color:var(--color-foreground)}</style>
