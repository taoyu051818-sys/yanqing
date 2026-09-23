<script setup lang="ts">
import { canExecuteDirectly } from '../../../../../utils/admin-execution';

import type {
  TrainingEnrollmentView,
  TrainingSessionView,
} from "@yanqing/shared";

import type { useSessionStore } from "../../../../../stores/session";
import { ref, toRefs, watch } from "vue";
import LessonBatchControls from "./LessonBatchControls.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { money, shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../utils/work-item-deep-link";

const props = defineProps<{
  loading: boolean;
  refresh: () => Promise<void>;
  activeLessons: TrainingSessionView[];
  lessons: TrainingSessionView[];
  focusedRecord: string;
  studentsFor: (lesson: TrainingSessionView) => any[];
  isActiveEnrollment: (enrollment: TrainingEnrollmentView) => boolean;
  canScheduleMakeup: (lesson: TrainingSessionView, enrollment: TrainingEnrollmentView) => boolean;
  scheduleMakeup: (lesson: TrainingSessionView, enrollment: TrainingEnrollmentView) => void;
  attendanceStatus: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => any;
  attendanceLabel: (status: string) => string;
  recognitionTimeline: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => any[];
  isConsumableLesson: (lesson: TrainingSessionView) => boolean;
  canMarkAttendance: boolean;
  canUseLessonWindow: (
    lesson: TrainingSessionView,
    kind: "attendanceWindow" | "completionWindow",
  ) => any;
  attendanceWindowHint: (
    lesson: TrainingSessionView,
  ) => "" | "未到点名窗口" | "管理员可补录点名" | "点名窗口已关闭";
  mark: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
    status: "ATTENDED" | "ABSENT" | "LEAVE" | "CANCELLED",
  ) => void;
  isRefundPending: (enrollment: TrainingEnrollmentView) => boolean;
  canProposeConsume: boolean;
  hasPendingProposal: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => boolean;
  attendanceFor: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => any;
  propose: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => void;
  isChecker: boolean;
  session: ReturnType<typeof useSessionStore>;
  confirm: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => void;
  completionActionLabel: (
    lesson: TrainingSessionView,
  ) => "待下课后确认" | "补录确认入账" | "确认窗口已关闭" | "确认入账";
  canRequestCorrection: boolean;
  activeRecognition: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => any;
  activeCorrection: (recognitionId: string) => any;
  requestCorrection: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => void;
  canCreateSession: boolean;
  hasUnresolvedAttendance: (lesson: TrainingSessionView) => boolean;
  complete: (lesson: TrainingSessionView) => void;
  lessonWindowState: (
    lesson: TrainingSessionView,
    kind: "attendanceWindow" | "completionWindow",
  ) => any;
}>();
const {
  loading,
  activeLessons,
  lessons,
  focusedRecord,
  studentsFor,
  isActiveEnrollment,
  canScheduleMakeup,
  scheduleMakeup,
  attendanceStatus,
  attendanceLabel,
  recognitionTimeline,
  isConsumableLesson,
  canMarkAttendance,
  canUseLessonWindow,
  attendanceWindowHint,
  mark,
  isRefundPending,
  canProposeConsume,
  hasPendingProposal,
  attendanceFor,
  propose,
  isChecker,
  session,
  confirm,
  completionActionLabel,
  canRequestCorrection,
  activeRecognition,
  activeCorrection,
  requestCorrection,
  canCreateSession,
  hasUnresolvedAttendance,
  complete,
  lessonWindowState,
} = toRefs(props);
const arrivalDraft = ref<string[]>([]), batchBusy = ref(false);
watch(() => props.session.user?.id, () => { arrivalDraft.value = []; });
function queueArrival(lesson: TrainingSessionView, student: TrainingEnrollmentView) {
  if (batchBusy.value) return;
  if (props.lessonWindowState(lesson, 'attendanceWindow') !== 'OPEN') { props.mark(lesson, student, 'ATTENDED'); return; }
  arrivalDraft.value = arrivalDraft.value.includes(student.id) ? arrivalDraft.value.filter(id => id !== student.id) : [...arrivalDraft.value, student.id];
}
function batchCandidates(lesson: TrainingSessionView, kind: 'proposal' | 'confirmation') {
  if (!props.isConsumableLesson(lesson) || (kind === 'proposal' ? !props.canProposeConsume : !props.isChecker || props.lessonWindowState(lesson, 'completionWindow') !== 'OPEN')) return [];
  return props.studentsFor(lesson).filter((student: TrainingEnrollmentView) => props.isActiveEnrollment(student) && !props.isRefundPending(student) && props.attendanceStatus(lesson, student) === 'ATTENDED' && !props.activeRecognition(lesson, student) && !props.attendanceFor(lesson, student)?.consumedSessions && (kind === 'proposal' ? !props.hasPendingProposal(lesson, student) : true));
}
</script>

<template>
  <view class="lesson-detail" :class="{ 'has-attendance-draft': arrivalDraft.length }">
    <view class="section-title"
      >学员与点名
      <text class="section-note">{{
        loading ? "同步中" : `${lessons.reduce((total, lesson) => total + studentsFor(lesson).length, 0)} 位学员`
      }}</text></view
    >
    <view
      v-for="lesson in lessons"
      :id="opsDeepLinkDomId('coach-lesson', lesson.id)"
      :key="lesson.id"
      class="card lesson-card"
      :class="{
        'deep-link-target': focusedRecord === `coach-lesson:${lesson.id}`,
      }"
    >
      <view class="row"
        ><view
          ><text class="lesson-title">{{
            lesson.class?.name || "未命名课程"
          }}</text
          ><text class="muted"
            >{{ shortDate(lesson.startsAt) }} · 占场
            {{ lesson.occupiedCourtHours || 0 }} 小时</text
          ></view
        ><StatusBadge :value="lesson.status"
      /></view>
      <LessonBatchControls :lesson="lesson" :students="studentsFor(lesson)" :proposals="batchCandidates(lesson, 'proposal')" :confirmations="batchCandidates(lesson, 'confirmation')" v-model:selected-arrivals="arrivalDraft" @update:busy="batchBusy = $event" :refresh="refresh" />
      <view v-if="studentsFor(lesson).length" class="student-list">
        <view
          v-for="student in studentsFor(lesson)"
          :key="student.id"
          class="student-row"
        >
          <view class="student-main">
            <text class="student-name">{{
              student.student?.displayName ||
              student.buyer?.displayName ||
              "成人学员"
            }}</text>
            <text class="muted"
              >{{ student.usedSessions ?? student.consumedSessions ?? 0 }}/{{
                student.totalSessions || 0
              }}
              次 · {{ student.enrollmentNo }}</text
            >
            <text
              class="attendance-state"
              :class="`state-${attendanceStatus(lesson, student).toLowerCase()}`"
              >{{ attendanceLabel(attendanceStatus(lesson, student)) }}</text
            >
            <view
              v-if="recognitionTimeline(lesson, student).length"
              class="ledger-line"
            >
              <text
                v-for="entry in recognitionTimeline(lesson, student)"
                :key="entry.id"
                :class="
                  entry.type === 'REVERSAL'
                    ? 'ledger-negative'
                    : 'ledger-positive'
                "
                >序{{ entry.sequence }}
                {{ entry.type === "REVERSAL" ? "冲正" : "消课" }}
                {{ money(entry.effectiveRevenueCents) }}</text
              >
            </view>
          </view>
          <view class="student-actions">
            <text
              v-if="
                isConsumableLesson(lesson) && isActiveEnrollment(student) &&
                canMarkAttendance &&
                attendanceStatus(lesson, student) === 'PENDING' &&
                !canUseLessonWindow(lesson, 'attendanceWindow')
              "
              class="pending-text"
              >{{ attendanceWindowHint(lesson) }}</text
            >
            <template
              v-if="
                isConsumableLesson(lesson) && isActiveEnrollment(student) &&
                canMarkAttendance &&
                attendanceStatus(lesson, student) === 'PENDING' &&
                canUseLessonWindow(lesson, 'attendanceWindow')
              "
            >
              <button
                class="secondary inline"
                :class="{ 'arrival-selected': arrivalDraft.includes(student.id) }"
                :aria-pressed="arrivalDraft.includes(student.id)"
                :disabled="batchBusy"
                @tap="queueArrival(lesson, student)"
              >
                {{ arrivalDraft.includes(student.id) ? '到场 · 待保存' : '到场' }}
              </button>
              <button
                class="ghost inline"
                :disabled="batchBusy || arrivalDraft.includes(student.id)" @tap="mark(lesson, student, 'ABSENT')"
              >
                缺席
              </button>
              <button
                class="ghost inline"
                :disabled="batchBusy || arrivalDraft.includes(student.id)" @tap="mark(lesson, student, 'LEAVE')"
              >
                请假
              </button>
            </template>
            <button
              v-if="
                isConsumableLesson(lesson) && isActiveEnrollment(student) &&
                !isRefundPending(student) &&
                canProposeConsume &&
                attendanceStatus(lesson, student) === 'ATTENDED' &&
                !hasPendingProposal(lesson, student) &&
                !attendanceFor(lesson, student)?.consumedSessions
              "
              class="secondary inline"
              :disabled="batchBusy || arrivalDraft.length > 0" @tap="propose(lesson, student)"
            >
              提交消课建议
            </button>
            <button
              v-if="
                isConsumableLesson(lesson) && isActiveEnrollment(student) &&
                !isRefundPending(student) &&
                isChecker &&
                attendanceStatus(lesson, student) === 'ATTENDED' &&
                !activeRecognition(lesson, student) &&
                (canExecuteDirectly(session.roles) || hasPendingProposal(lesson, student))
              "
              class="primary inline"
              :disabled="
                batchBusy || arrivalDraft.length > 0 || (!canExecuteDirectly(session.roles) && attendanceFor(lesson, student)?.operatorId ===
                  session.user?.id) ||
                !canUseLessonWindow(lesson, 'completionWindow')
              "
              @tap="confirm(lesson, student)"
            >
              {{ completionActionLabel(lesson) }}
            </button>
            <text v-if="isRefundPending(student)" class="pending-text"
              >退款待审，暂停消课</text
            >
            <text
              v-if="
                isConsumableLesson(lesson) && isActiveEnrollment(student) &&
                isChecker &&
                attendanceStatus(lesson, student) === 'ATTENDED' &&
                !activeRecognition(lesson, student) &&
                (canExecuteDirectly(session.roles) || hasPendingProposal(lesson, student)) &&
                attendanceFor(lesson, student)?.operatorId === session.user?.id && !canExecuteDirectly(session.roles)
              "
              class="pending-text"
              >本人提交，须由另一管理员确认</text
            >
            <text
              v-if="
                isConsumableLesson(lesson) && isActiveEnrollment(student) &&
                hasPendingProposal(lesson, student) &&
                !isChecker
              "
              class="pending-text"
              >待主管确认</text
            >
            <text
              v-if="attendanceStatus(lesson, student) === 'MAKEUP_REQUIRED'"
              class="pending-text"
              >请安排补课</text
            >
            <button v-if="canScheduleMakeup(lesson, student)" class="secondary inline" :disabled="batchBusy || arrivalDraft.length > 0" @tap="scheduleMakeup(lesson, student)">安排补课</button>
            <button
              v-if="
                canRequestCorrection &&
                activeRecognition(lesson, student) &&
                !activeCorrection(activeRecognition(lesson, student).id)
              "
              class="danger inline"
              :disabled="batchBusy || arrivalDraft.length > 0" @tap="requestCorrection(lesson, student)"
            >
              {{ canExecuteDirectly(session.roles) ? "撤销消课" : "申请冲正" }}
            </button>
            <text
              v-if="
                activeRecognition(lesson, student) &&
                activeCorrection(activeRecognition(lesson, student).id)
                  ?.status === 'REQUESTED'
              "
              class="pending-text"
              >冲正待复核</text
            >
          </view>
        </view>
      </view>
      <view v-else class="empty-line">本节没有出勤记录或待上课学员</view>
      <button
        v-if="canCreateSession && isConsumableLesson(lesson)"
        class="primary finish"
        :disabled="
          batchBusy || arrivalDraft.length > 0 || hasUnresolvedAttendance(lesson) ||
          !canUseLessonWindow(lesson, 'completionWindow')
        "
        @tap="complete(lesson)"
      >
        {{
          hasUnresolvedAttendance(lesson)
            ? "先完成点名和消课"
            : lessonWindowState(lesson, "completionWindow") === "NOT_OPEN"
              ? "待下课后结束"
              : "结束本节课程"
        }}
      </button>
    </view>
    <view v-if="!loading && !lessons.length" class="empty card"
      >今天没有排课</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.lesson-detail { padding-bottom:calc(140rpx + env(safe-area-inset-bottom)); }.lesson-detail .finish { position:fixed; bottom:env(safe-area-inset-bottom); left:28rpx; right:28rpx; width:auto; margin:0; z-index:20; box-shadow:0 0 0 28rpx #fff; }
</style>

<style scoped>.has-attendance-draft{padding-bottom:calc(150rpx + env(safe-area-inset-bottom))}.arrival-selected{background:#17653d!important;color:#fff!important}</style>
