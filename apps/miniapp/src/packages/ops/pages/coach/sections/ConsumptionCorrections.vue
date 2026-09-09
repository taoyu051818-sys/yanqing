<script setup lang="ts">
import { toRefs } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { money } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  corrections: any[];
  focusedRecord: string;
  correctionStudentName: (correction: any) => any;
  attendanceLabel: (status: string) => string;
  isChecker: boolean;
  isOwnCorrection: (correction: any) => boolean;
  decideCorrection: (correction: any, action: "approve" | "reject") => void;
  loading: boolean;
}>();
const {
  corrections,
  focusedRecord,
  correctionStudentName,
  attendanceLabel,
  isChecker,
  isOwnCorrection,
  decideCorrection,
  loading,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title"
      >消课冲正流水
      <text class="section-note">{{ corrections.length }} 条</text></view
    >
    <view
      v-for="correction in corrections"
      :id="opsDeepLinkDomId('coach-correction', correction.id)"
      :key="correction.id"
      class="card correction-card"
      :class="{
        'deep-link-target':
          focusedRecord === `coach-correction:${correction.id}`,
      }"
    >
      <view class="row"
        ><view
          ><text class="student-name">{{
            correctionStudentName(correction)
          }}</text
          ><text class="muted"
            >{{ correction.attendance?.session?.class?.name || "培训课次" }} ·
            申请人 {{ correction.requestedBy?.displayName || "系统记录" }}</text
          ></view
        ><StatusBadge :value="correction.status"
      /></view>
      <text class="correction-reason">原因：{{ correction.reason }}</text>
      <view class="evidence-grid">
        <text
          >原消课：序{{ correction.recognition?.sequence || "-" }} ·
          {{ money(correction.recognition?.effectiveRevenueCents) }}</text
        >
        <text
          >负向冲正：{{
            correction.reversalRecognition
              ? `序${correction.reversalRecognition.sequence} · ${money(correction.reversalRecognition.effectiveRevenueCents)}`
              : "尚未生成"
          }}</text
        >
        <text
          >出勤：{{
            attendanceLabel(correction.attendance?.status || "PENDING")
          }}
          · 当前消课 {{ correction.attendance?.consumedSessions || 0 }} 次</text
        >
        <text
          >当前确认收入：{{
            money(correction.attendance?.confirmedRevenueCents)
          }}
          · 成长积分计提
          {{ correction.attendance?.growthPointsAwarded || 0 }}</text
        >
      </view>
      <view
        v-if="isChecker && correction.status === 'REQUESTED'"
        class="correction-actions"
      >
        <button
          class="primary inline"
          :disabled="isOwnCorrection(correction)"
          @tap="decideCorrection(correction, 'approve')"
        >
          批准冲正
        </button>
        <button
          class="danger inline"
          :disabled="isOwnCorrection(correction)"
          @tap="decideCorrection(correction, 'reject')"
        >
          驳回
        </button>
        <text v-if="isOwnCorrection(correction)" class="pending-text"
          >本人发起，需另一管理员复核</text
        >
      </view>
    </view>
    <view v-if="!loading && !corrections.length" class="empty card"
      >暂无消课冲正申请</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
