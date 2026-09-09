<script setup lang="ts">
import { toRefs, computed } from "vue";
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
</script>

<template>
  <view>
    <template v-if="mayManageEvent">
      <view class="section-title">创建赛事</view>
      <view class="card create-event-form">
        <view class="form-grid">
          <view
            ><text class="field-label">赛事编码</text
            ><input v-model="eventCode" class="text-input" maxlength="40"
          /></view>
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
        <view class="form-grid">
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
        <button
          class="primary"
          :loading="actionKey === 'create-event'"
          :disabled="loading || Boolean(actionKey)"
          @tap="createEvent"
        >
          创建赛事草稿
        </button>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
