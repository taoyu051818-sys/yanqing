<script setup lang="ts">
import { computed, onUnmounted, ref, watch, nextTick } from "vue";
import type {
  TrainingEnrollmentView,
  TrainingSessionView,
} from "@yanqing/shared";
import ActionDialog from "../../../../../components/ActionDialog.vue";
import { useUnsavedForm } from "../../../composables/use-unsaved-form";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../../../../services/auth-session";
import { executeLessonBatch } from "../actions/batch";
import type { TrainingBatchAction } from "../../../../../types/training-batch";

const props = defineProps<{
  lesson: TrainingSessionView;
  students: TrainingEnrollmentView[];
  proposals: TrainingEnrollmentView[];
  confirmations: TrainingEnrollmentView[];
  selectedArrivals: string[];
  refresh: () => Promise<void>;
}>();
const emit = defineEmits<{
  "update:selectedArrivals": [ids: string[]];
  "update:busy": [busy: boolean];
}>();
const busy = ref(false),
  mode = ref<"proposal" | "confirmation" | "">(""),
  selected = ref<string[]>([]);
const failures = ref<{ id: string; name: string; message: string }[]>([]),
  result = ref("");
let alive = true;
onUnmounted(() => {
  alive = false;
});
const { markSaved } = useUnsavedForm(() => props.selectedArrivals);
const candidates = computed(() =>
  mode.value === "proposal" ? props.proposals : props.confirmations,
);
watch(candidates, () => {
  if (!busy.value)
    selected.value = selected.value.filter((id) =>
      candidates.value.some((student) => student.id === id),
    );
});
const name = (student: TrainingEnrollmentView) =>
  student.student?.displayName || student.buyer?.displayName || "学员";
function open(value: "proposal" | "confirmation") {
  if (busy.value) return;
  mode.value = value;
  selected.value = [];
  failures.value = [];
}
function toggle(id: string) {
  if (!busy.value)
    selected.value = selected.value.includes(id)
      ? selected.value.filter((item) => item !== id)
      : [...selected.value, id];
}
function selectAll() {
  if (!busy.value)
    selected.value =
      selected.value.length === candidates.value.length
        ? []
        : candidates.value.map((item) => item.id);
}
async function submit(action: TrainingBatchAction) {
  if (busy.value) return;
  const ids =
    action === "attendance"
      ? [...props.selectedArrivals]
      : selected.value.filter((id) =>
          candidates.value.some((item) => item.id === id),
        );
  if (!ids.length) return;
  const owner = captureAuthSession();
  busy.value = true;
  emit("update:busy", true);
  result.value = "";
  failures.value = [];
  const names = new Map(
    props.students.map((student) => [student.id, name(student)]),
  );
  try {
    const results = await executeLessonBatch(props.lesson.id, action, ids);
    if (!alive || !isAuthSessionCurrent(owner)) return;
    const failed = results.filter((item) => item.status === "FAILED");
    failures.value = failed.map((item) => ({
      id: item.enrollmentId,
      name: names.get(item.enrollmentId) || "学员",
      message: item.message || "未完成",
    }));
    const succeeded = results.length - failed.length;
    result.value = `已${action === "attendance" ? "登记到场" : action === "proposal" ? "提交消课建议" : "确认扣课入账"} ${succeeded} 人${failed.length ? `，${failed.length} 人未完成` : ""}`;
    if (action === "attendance") {
      emit(
        "update:selectedArrivals",
        failed.map((item) => item.enrollmentId),
      );
    } else {
      selected.value = failed.map((item) => item.enrollmentId);
      if (!failed.length) mode.value = "";
    }
    await props.refresh();
    if (!failed.length && action === "attendance") {
      await nextTick();
      markSaved();
    }
  } catch (error: any) {
    if (alive && isAuthSessionCurrent(owner))
      result.value = error?.message || "提交未完成，请重试";
  } finally {
    if (alive) {
      busy.value = false;
      emit("update:busy", false);
    }
  }
}
</script>
<template>
  <view class="lesson-batch">
    <view class="batch-actions">
      <button
        v-if="proposals.length"
        class="secondary"
        :disabled="busy || selectedArrivals.length > 0"
        @tap="open('proposal')"
      >
        提交消课建议 · {{ proposals.length }}人
      </button>
      <button
        v-if="confirmations.length"
        class="secondary"
        :disabled="busy || selectedArrivals.length > 0"
        @tap="open('confirmation')"
      >
        确认消课 · {{ confirmations.length }}人
      </button>
    </view>
    <text v-if="result" class="batch-result" role="status">{{ result }}</text>
    <view v-if="failures.length && !mode" class="batch-failures" role="alert"
      ><text v-for="failure in failures" :key="failure.id"
        >{{ failure.name }}：{{ failure.message }}</text
      ></view
    >
    <view v-if="selectedArrivals.length" class="attendance-save">
      <view
        ><text>待保存 {{ selectedArrivals.length }} 人到场</text
        ><text class="batch-note">其余学员保持原状态</text
        ><button
          class="clear-draft"
          :disabled="busy"
          @tap="emit('update:selectedArrivals', [])"
        >
          清空待保存
        </button></view
      >
      <button
        class="primary"
        :loading="busy"
        :disabled="busy"
        @tap="submit('attendance')"
      >
        保存点名
      </button>
    </view>
    <ActionDialog
      v-if="mode"
      :title="mode === 'proposal' ? '提交本课消课建议' : '确认本课消课'"
      :busy="busy"
      @close="mode = ''"
    >
      <text class="batch-note">{{
        mode === "proposal"
          ? "核对所选学员已完成本次训练。提交后等待管理员确认。"
          : "核对后为每位已选学员扣减 1 课次，并按各自合同确认收入。"
      }}</text>
      <button
        class="secondary batch-select-all"
        :disabled="busy"
        @tap="selectAll"
      >
        {{
          selected.length === candidates.length && candidates.length
            ? "取消全选"
            : "选择全部可处理学员"
        }}
      </button>
      <button
        v-for="student in candidates"
        :key="student.id"
        class="batch-student"
        :class="{ selected: selected.includes(student.id) }"
        :aria-pressed="selected.includes(student.id)"
        :disabled="busy"
        @tap="toggle(student.id)"
      >
        <text>{{ name(student) }}</text
        ><text>{{ selected.includes(student.id) ? "已选择" : "选择" }}</text>
      </button>
      <text v-if="!candidates.length" class="batch-note"
        >当前没有可批量处理的学员，请刷新核对。</text
      >
      <view v-if="failures.length" class="batch-failures" role="alert"
        ><text v-for="failure in failures" :key="failure.id"
          >{{ failure.name }}：{{ failure.message }}</text
        ></view
      >
      <template #footer
        ><button
          class="primary batch-submit"
          :loading="busy"
          :disabled="busy || !selected.length"
          @tap="submit(mode || 'proposal')"
        >
          {{ mode === "proposal" ? "确认提交" : "确认扣课入账" }} ·
          {{ selected.length }}人
        </button></template
      >
    </ActionDialog>
  </view>
</template>
<style scoped>
.batch-actions {
  display: flex;
  gap: 16rpx;
  flex-wrap: wrap;
  margin: 20rpx 0;
}
.batch-actions button {
  flex: 1;
  min-height: 44px;
  margin: 0;
  padding: 16rpx;
  font-size: 26rpx;
}
.batch-result,
.batch-note {
  display: block;
  font-size: 26rpx;
  line-height: 1.6;
  color: #626d66;
}
.batch-result {
  padding: 16rpx 0;
  color: #17653d;
}
.batch-failures {
  display: grid;
  gap: 12rpx;
  color: #a52626;
  font-size: 26rpx;
  line-height: 1.6;
  margin: 20rpx 0;
}
.attendance-save {
  position: fixed;
  z-index: 25;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 20rpx;
  background: white;
  border-top: 1rpx solid #dfe5df;
  padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
  font-size: 28rpx;
}
.attendance-save > view {
  flex: 1;
}
.attendance-save button {
  margin: 0;
  min-height: 48px;
  padding: 20rpx;
  font-size: 28rpx;
}
.batch-student {
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: left;
  white-space: normal;
  width: 100%;
  min-height: 48px;
  margin: 12rpx 0;
  padding: 20rpx;
  background: #f5f6f8;
  border: 1rpx solid #dfe5df;
  font-size: 28rpx;
  border-radius: 16rpx;
}
.batch-student.selected {
  border-color: #17653d;
  background: #e7f4eb;
  color: #17653d;
}
.batch-select-all {
  margin: 24rpx 0;
  min-height: 44px;
  font-size: 28rpx;
}
.batch-submit {
  width: 100%;
  min-height: 48px;
  margin: 0;
  font-size: 28rpx;
}
</style>

<style scoped>
.attendance-save .clear-draft {
  min-height: 44px;
  padding: 8rpx 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 24rpx;
  text-align: left;
}
</style>
