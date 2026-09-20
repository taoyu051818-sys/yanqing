<script setup lang="ts">
import { computed, toRefs } from "vue";
import AppIcon from "../../../../../components/AppIcon.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import { money, shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../utils/work-item-deep-link";

const props = defineProps<{
  summary: { label: string; coverage: string; missing: string; empty: string };
  direct?: boolean;
  detailId?: string;
  detailRefund?: any;
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
const emit = defineEmits<{ open: [refund: any] }>();
const displayedRefunds = computed(() => props.detailRefund ? [props.detailRefund] : []);
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
  <view :class="{ 'refund-detail': detailId }">
    <view v-if="!detailId" class="refund-heading"><text class="section-title">退款申请</text><text class="muted">{{ summary.label }}</text><text v-if="summary.coverage" class="muted">{{ summary.coverage }}</text></view>
    <view v-if="!detailId && summary.missing && !loading" class="notice error card refund-missing" role="alert"><text>{{ summary.missing }}</text><button class="secondary" @tap="refresh">刷新核对</button></view>
    <view v-if="loadErrors.refunds" class="notice error card">
      <text>{{ loadErrors.refunds }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && (!detailId ? !activeRefunds.length : !detailRefund)" class="empty card"
      >正在同步退款申请与通道状态…</view
    >
    <view v-if="!detailId" class="refund-list"><button v-for="refund in activeRefunds" :key="refund.id" class="refund-row" @tap="emit('open', refund)"><view class="refund-copy"><text class="refund-title">{{ refund.order.user?.displayName || refund.order.title || '退款申请' }}</text><text class="muted">{{ refund.order.orderNo }}</text><text class="refund-amount">{{ money(refund.amountCents) }}</text></view><StatusBadge :value="refund.status" domain="refund" /><AppIcon name="chevron" :size="28" tone="muted" /></button></view>
    <view
      v-for="refund in displayedRefunds"
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
          <StatusBadge :value="refund.status" domain="refund" />
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
        class="action-row refund-action-bar"
      >
        <button
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="approveRefund(refund)"
        >
          {{ acting(`refund-approve:${refund.id}`) ? "批准中…" : `${direct ? "确认退款" : "批准退款"} ${money(refund.amountCents)}` }}
        </button>
        <button
          v-if="!isForcedSystemRefund(refund)"
          class="secondary action-button"
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
      v-if="!detailId && !loading && !loadErrors.refunds && !summary.missing && !activeRefunds.length"
      class="empty card"
      >{{ summary.empty }}</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.refund-missing { flex-direction:column; align-items:stretch; gap:20rpx; }.refund-missing button { margin:0; width:100%; white-space:nowrap; }
.refund-heading { display:grid; gap:12rpx; margin:24rpx 0; }.refund-heading .section-title { margin:0; }.refund-list { background:#fff; border-radius:24rpx; overflow:hidden; }.refund-row { display:flex; gap:20rpx; align-items:center; padding:28rpx 24rpx; width:100%; background:#fff; text-align:left; border-radius:0; margin:0; }.refund-row+.refund-row { border-top:1rpx solid #e8ece9; }.refund-copy { flex:1; min-width:0; }.refund-title { display:block; font-size:30rpx; color:#20252b; font-weight:550; }.refund-amount { display:block; margin-top:14rpx; font-size:34rpx; color:#20252b; font-weight:600; }
.refund-detail { padding-bottom:calc(170rpx + env(safe-area-inset-bottom)); }.refund-action-bar { position:fixed; bottom:0; left:0; right:0; z-index:20; padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #e2e7e3; margin:0; }.refund-action-bar button { margin:0; flex:1; font-size:28rpx; min-height:96rpx; white-space:normal; }.refund-action-bar { display:flex; gap:16rpx; }.refund-detail .detail-label { font-size:26rpx; }.refund-detail .detail-value { font-size:30rpx; }.refund-detail .order-title { font-size:34rpx; }.refund-detail .reason-text { font-size:28rpx; }.refund-detail .status-note { font-size:24rpx; }
</style>
