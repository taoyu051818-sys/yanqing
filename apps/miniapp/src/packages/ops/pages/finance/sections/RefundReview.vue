<script setup lang="ts">
import { toRefs } from "vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { money, shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  loading: boolean;
  reviewRefunds: any[];
  loadErrors: {
    dashboard: string;
    refunds: string;
    training: string;
    trainingSettlements: string;
    merchants: string;
    settlements: string;
    consignmentSuppliers: string;
    consignmentPayables: string;
    consignmentSettlements: string;
    reconciliation: string;
    adjustments: string;
    shifts: string;
  };
  refresh: () => void;
  activeRefunds: any[];
  focusedRecord: string;
  refundStatusNote: (status?: string) => string;
  actionKey: string;
  approveRefund: (refund: any) => void;
  acting: (key: string) => boolean;
  isForcedSystemRefund: (refund: any) => boolean;
  rejectRefund: (refund: any) => void;
}>();
const {
  loading,
  reviewRefunds,
  loadErrors,
  refresh,
  activeRefunds,
  focusedRecord,
  refundStatusNote,
  actionKey,
  approveRefund,
  acting,
  isForcedSystemRefund,
  rejectRefund,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">
      退款审核
      <text class="section-note">{{
        loading ? "同步中" : `${reviewRefunds.length} 笔待审`
      }}</text>
    </view>
    <view v-if="loadErrors.refunds" class="notice error card">
      <text>{{ loadErrors.refunds }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !activeRefunds.length" class="empty card"
      >正在同步退款申请与通道状态…</view
    >
    <view
      v-for="refund in activeRefunds"
      :id="opsDeepLinkDomId('finance-refund', refund.id)"
      :key="refund.id"
      class="card workflow-card"
      :class="{
        'deep-link-target': focusedRecord === `finance-refund:${refund.id}`,
      }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{
            refund.order.title || "退款申请"
          }}</text>
          <text class="muted"
            >{{ refund.order.orderNo }} ·
            {{ refund.refundNo || refund.id }}</text
          >
        </view>
        <view class="status-block">
          <StatusBadge :value="refund.status" />
          <text class="status-note">{{ refundStatusNote(refund.status) }}</text>
        </view>
      </view>
      <view class="detail-grid">
        <view
          ><text class="detail-label">申请金额</text
          ><text class="detail-value danger-money">{{
            money(refund.amountCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">申请时间</text
          ><text class="detail-value">{{
            shortDate(refund.requestedAt)
          }}</text></view
        >
      </view>
      <view class="reason-box"
        ><text class="detail-label">申请原因</text
        ><text class="reason-text">{{ refund.reason || "未填写" }}</text></view
      >
      <view
        v-if="['REQUESTED', 'REFUND_PENDING'].includes(refund.status)"
        class="action-row"
      >
        <button
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="approveRefund(refund)"
        >
          {{ acting(`refund-approve:${refund.id}`) ? "批准中…" : "批准退款" }}
        </button>
        <button
          v-if="!isForcedSystemRefund(refund)"
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="rejectRefund(refund)"
        >
          {{ acting(`refund-reject:${refund.id}`) ? "驳回中…" : "驳回申请" }}
        </button>
        <text v-else class="locked-note"
          >系统强制退款不可驳回，只能核准并原路退回。</text
        >
      </view>
    </view>
    <view
      v-if="!loading && !loadErrors.refunds && !activeRefunds.length"
      class="empty card"
      >当前没有待审核或处理中的退款</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
