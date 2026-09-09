<script setup lang="ts">
import { toRefs, computed } from "vue";
import { today as shanghaiDate } from "../../../../../utils/format";

const props = defineProps<{
  canCreateSession: boolean;
  sessionClasses: any[];
  sessionClassIndex: number;
  selectedSessionClass: any;
  sessionDate: string;
  changeSessionDate: (event: any) => Promise<void>;
  sessionStartTime: string;
  sessionEndTime: string;
  changeSessionCourts: (event: any) => void;
  sessionCourts: {
    id: string;
    name: string;
    usage: string;
    enabled: boolean;
  }[];
  isCourtBlocked: (courtId: string) => boolean;
  selectedCourtIds: string[];
  sessionNote: string;
  sessionReason: string;
  actionKey: string;
  loading: boolean;
  createSession: () => Promise<void>;
}>();
const emit = defineEmits<{
  (event: "update:sessionClassIndex", value: number): void;
  (event: "update:sessionStartTime", value: string): void;
  (event: "update:sessionEndTime", value: string): void;
  (event: "update:sessionNote", value: string): void;
  (event: "update:sessionReason", value: string): void;
}>();
const {
  canCreateSession,
  sessionClasses,
  selectedSessionClass,
  sessionDate,
  changeSessionDate,
  changeSessionCourts,
  sessionCourts,
  isCourtBlocked,
  selectedCourtIds,
  actionKey,
  loading,
  createSession,
} = toRefs(props);
const sessionClassIndex = computed({
  get: () => props.sessionClassIndex,
  set: (value) => emit("update:sessionClassIndex", value),
});
const sessionStartTime = computed({
  get: () => props.sessionStartTime,
  set: (value) => emit("update:sessionStartTime", value),
});
const sessionEndTime = computed({
  get: () => props.sessionEndTime,
  set: (value) => emit("update:sessionEndTime", value),
});
const sessionNote = computed({
  get: () => props.sessionNote,
  set: (value) => emit("update:sessionNote", value),
});
const sessionReason = computed({
  get: () => props.sessionReason,
  set: (value) => emit("update:sessionReason", value),
});
</script>

<template>
  <view>
    <template v-if="canCreateSession">
      <view class="section-title"
        >创建培训课次 <text class="section-note">教练仅可排本人班级</text></view
      >
      <view class="card creation-form">
        <picker
          :range="sessionClasses"
          range-key="name"
          :value="sessionClassIndex"
          @change="sessionClassIndex = Number(($event.detail as any).value)"
          ><view
            ><text class="field-label">培训班级</text
            ><view class="picker-value"
              >{{ selectedSessionClass?.name || "暂无可排课班级" }} ›</view
            ></view
          ></picker
        >
        <view class="form-grid three-columns">
          <picker
            mode="date"
            :value="sessionDate"
            :start="shanghaiDate()"
            @change="changeSessionDate"
            ><view
              ><text class="field-label">课次日期</text
              ><view class="picker-value">{{ sessionDate }} ›</view></view
            ></picker
          >
          <picker
            mode="time"
            :value="sessionStartTime"
            @change="sessionStartTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">开始</text
              ><view class="picker-value">{{ sessionStartTime }} ›</view></view
            ></picker
          >
          <picker
            mode="time"
            :value="sessionEndTime"
            @change="sessionEndTime = ($event.detail as any).value"
            ><view
              ><text class="field-label">结束</text
              ><view class="picker-value">{{ sessionEndTime }} ›</view></view
            ></picker
          >
        </view>
        <view>
          <text class="field-label">场地（至少选择一个）</text>
          <checkbox-group class="court-grid" @change="changeSessionCourts">
            <label
              v-for="court in sessionCourts"
              :key="court.id"
              class="court-choice"
              :class="{ blocked: isCourtBlocked(court.id) }"
            >
              <checkbox
                :value="court.id"
                :checked="selectedCourtIds.includes(court.id)"
                :disabled="isCourtBlocked(court.id)"
                color="#17653d"
              />
              <text>{{ court.name }}</text
              ><text class="court-usage">{{
                isCourtBlocked(court.id)
                  ? "冲突"
                  : court.usage === "TRAINING"
                    ? "培训场"
                    : "可用"
              }}</text>
            </label>
          </checkbox-group>
          <text v-if="!sessionCourts.length" class="muted"
            >场地状态加载中或当天无可用场地。</text
          >
        </view>
        <view
          ><text class="field-label">课次备注（选填）</text
          ><input
            v-model="sessionNote"
            class="form-input"
            maxlength="300"
            placeholder="教学重点、器材或分组说明"
        /></view>
        <view
          ><text class="field-label">创建原因（必填）</text
          ><textarea
            v-model="sessionReason"
            class="reason-input"
            maxlength="300"
            placeholder="说明本次排课依据"
          />
        </view>
        <text class="guardrail"
          >创建前同时校验未来时间、班级归属、封场和所有已确认场地预约；成功后课次与场地占用一并落账。</text
        >
        <button
          class="primary full-button"
          :loading="actionKey === 'create-session'"
          :disabled="loading || Boolean(actionKey) || !selectedSessionClass"
          @tap="createSession"
        >
          创建培训课次
        </button>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
