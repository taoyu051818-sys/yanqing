<script setup lang="ts">
import { toRefs, computed, nextTick, watch } from "vue";
import { useUnsavedForm } from "../../../composables/use-unsaved-form";
import { today as shanghaiDate } from "../../../../../utils/format";

const props = defineProps<{
  errorMessage?: string;
  errorField?: string;
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
const { markSaved } = useUnsavedForm(() => ({ date:props.sessionDate, start:props.sessionStartTime, end:props.sessionEndTime, courts:props.selectedCourtIds, note:props.sessionNote, reason:props.sessionReason, classIndex:props.sessionClassIndex }));
watch(() => props.actionKey, (key, previous) => { if (previous === 'create-session' && !key && !props.errorMessage) markSaved(); });
watch(() => [props.errorField, props.errorMessage], async () => {
  if (!props.errorField || !props.errorMessage) return;
  await nextTick();
  uni.pageScrollTo({ selector:`#session-field-${props.errorField}`, offsetTop:-24, duration:200 });
});
</script>

<template>
  <view class="schedule-page">
    <template v-if="canCreateSession">

      <view class="card creation-form">
        <picker id="session-field-class"
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
        <text v-if="errorField === 'class'" class="field-error" role="alert">{{ errorMessage }}</text>
        <view id="session-field-time" class="form-grid three-columns">
          <picker class="form-grid-lead"
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
        <view id="session-field-courts">
          <text v-if="errorField === 'time'" class="field-error" role="alert">{{ errorMessage }}</text>
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
          <text v-if="errorField === 'courts'" class="field-error" role="alert">{{ errorMessage }}</text>
          <text v-if="!sessionCourts.length" class="muted"
            >场地状态加载中或当天无可用场地。</text
          >
        </view>
        <view id="session-field-note"
          ><text class="field-label">课次备注（选填）</text
          ><input
            v-model="sessionNote"
            class="form-input"
            maxlength="300"
            placeholder="教学重点、器材或分组说明"
        /></view>
        <view id="session-field-reason"
          ><text class="field-label">创建原因（必填）</text
          ><textarea
            v-model="sessionReason"
            :focus="errorField === 'reason' && Boolean(errorMessage)"
            :aria-invalid="errorField === 'reason' && Boolean(errorMessage)"
            class="reason-input"
            maxlength="300"
            placeholder="说明本次排课依据"
          />
          <text v-if="errorField === 'reason'" class="field-error" role="alert">{{ errorMessage }}</text>
        </view>
        <text class="guardrail">排课成功后，将同步预留所选场地。</text>
        <view class="save-bar"><text v-if="errorMessage" class="field-error" role="alert">{{ errorMessage }}</text>
        <button
          class="primary full-button"
          :loading="actionKey === 'create-session'"
          :disabled="loading || Boolean(actionKey) || !selectedSessionClass"
          @tap="createSession"
        >
          创建培训课次
        </button></view>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.schedule-page { padding-bottom:calc(180rpx + env(safe-area-inset-bottom)); }.field-error { display:block; color:#a52626; font-size:26rpx; line-height:1.5; margin-top:10rpx; }
.save-bar { position:fixed; left:0; right:0; bottom:0; z-index:25; padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #e2e7e3; }.save-bar .field-error { margin:0 0 12rpx; }.save-bar button { width:100%; margin:0; }
</style>
