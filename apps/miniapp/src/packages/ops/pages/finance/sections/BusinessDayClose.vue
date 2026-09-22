<script setup lang="ts">
import { venueDateKey } from "../../../../../utils/format";
import { toRefs } from "vue";
import { useSessionStore } from "../../../../../stores/session";
import { hasOperationsAccess } from "../../../../../config/operations";
import StatusBadge from "../../../../../components/StatusBadge.vue";

const props = defineProps<{
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
  loading: boolean;
  refresh: () => void;
  focusedRecord: string;
  closeBusinessPeriod: () => {
    date: string;
    periodStart: string;
    periodEnd: string;
  };
  reconciliationStatusLabel: (status?: string) => string;
  reconciliation: {
    id?: string | undefined;
    businessDate: string;
    status: "OPEN" | "REVIEW" | "LOCKED" | string;
    totals: Record<string, number>;
    exceptionCount: number;
    closedById?: string | null | undefined;
    closedAt?: string | null | undefined;
    detail?: Record<string, unknown> | undefined;
    blocked?: boolean | undefined;
    blockers?: { kind: string; count: number; message: string }[] | undefined;
  } | null;
  reconciliationAmount: (key: string) => string;
  canFinanceAction: boolean;
  actionKey: string;
  closeBusinessDay: () => Promise<void>;
  acting: (key: string) => boolean;
}>();
const {
  loadErrors,
  loading,
  refresh,
  focusedRecord,
  closeBusinessPeriod,
  reconciliationStatusLabel,
  reconciliation,
  reconciliationAmount,
  canFinanceAction,
  actionKey,
  closeBusinessDay,
  acting,
} = toRefs(props);
const session = useSessionStore();
function blockerAction(kind: string) {
  if (kind === "UNREVIEWED_CASH_VARIANCES")
    return { label: "查看现金差异", route: "" };
  if (kind === "OPEN_FRONT_DESK_SHIFTS")
    return hasOperationsAccess(session.roles, "today")
      ? { label: "查看前台班次", route: "/packages/ops/pages/frontdesk/index" }
      : null;
  if (kind === "UNFULFILLED_TRAINING_SESSIONS")
    return hasOperationsAccess(session.roles, "training")
      ? {
          label: "查看培训待办",
          route: "/packages/ops/pages/admin/index?group=training",
        }
      : null;
  const before = encodeURIComponent(
    venueDateKey(props.reconciliation?.businessDate) ||
      props.closeBusinessPeriod().date,
  );
  if (kind === "PENDING_REFUNDS")
    return {
      label: "查看待处理退款",
      route: `/packages/ops/pages/transactions/index?view=refunds&before=${before}`,
    };
  if (kind === "PENDING_PAYMENTS" || kind === "UNFULFILLED_ORDERS")
    return {
      label: "查看相关订单",
      route: `/packages/ops/pages/transactions/index?view=orders&before=${before}&dateBasis=${kind === "UNFULFILLED_ORDERS" ? "usage" : "created"}`,
    };
  return null;
}
function openBlocker(kind: string) {
  const action = blockerAction(kind);
  if (!action) return;
  if (!action.route)
    uni.pageScrollTo({ selector: "#finance-shift-variances", duration: 200 });
  else uni.navigateTo({ url: action.route });
}
</script>

<template>
  <view>
    <view class="section-title">日结与账期关账</view>
    <view v-if="loadErrors.reconciliation" class="notice error card">
      <text>{{ loadErrors.reconciliation }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view
      id="finance-reconciliation"
      v-else
      class="card reconciliation-period"
      :class="{
        'deep-link-target': focusedRecord === 'finance-reconciliation',
      }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title"
            >待关账营业日 {{ closeBusinessPeriod().date }}</text
          >
          <text class="muted"
            >状态：{{ reconciliationStatusLabel(reconciliation?.status) }} ·
            异常 {{ reconciliation?.exceptionCount || 0 }} 项</text
          >
        </view>
        <StatusBadge :value="reconciliation?.status || 'OPEN'" />
      </view>
      <view class="settlement-numbers period-numbers">
        <view
          ><text class="detail-label">支付流水</text
          ><text class="detail-value">{{
            reconciliationAmount("successfulPaymentCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">完成退款</text
          ><text class="detail-value">{{
            reconciliationAmount("completedRefundCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">培训确认收入</text
          ><text class="detail-value">{{
            reconciliationAmount("trainingEffectiveRevenueCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">联盟服务费</text
          ><text class="detail-value">{{
            reconciliationAmount("allianceCooperationFeeCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">本日寄售应付净发生</text
          ><text class="detail-value">{{
            reconciliationAmount("consignmentPayableCents")
          }}</text></view
        >
        <view
          ><text class="detail-label">本日寄售已付结算</text
          ><text class="detail-value">{{
            reconciliationAmount("consignmentSettledPayableCents")
          }}</text></view
        >
      </view>
      <view v-if="reconciliation?.blockers?.length" class="blocker-list">
        <view
          v-for="blocker in reconciliation.blockers"
          :key="blocker.kind"
          class="blocker-row"
          ><text class="blocker">{{ blocker.message }}</text
          ><button
            v-if="blockerAction(blocker.kind)"
            class="secondary"
            @tap="openBlocker(blocker.kind)"
          >
            {{ blockerAction(blocker.kind)?.label }} ›</button
          ><text v-else class="muted"
            >请联系对应岗位处理后刷新日结。</text
          ></view
        >
      </view>
      <text class="muted period-note"
        >只关已结束的营业日；当天数据保持实时。关账快照不可覆盖，未处理支付、退款、履约或消课等源业务会进入
        待处理状态；培训、联盟和寄售周期结算作为财务待办，不锁死每日关账。</text
      >
      <button
        v-if="canFinanceAction && reconciliation?.status !== 'LOCKED'"
        class="primary period-close"
        :disabled="loading || Boolean(actionKey)"
        @tap="closeBusinessDay"
      >
        {{
          acting(`reconciliation-close:${closeBusinessPeriod().date}`)
            ? "提交中…"
            : reconciliation?.blocked
              ? "提交复核"
              : "核对并关账"
        }}
      </button>
      <view v-else-if="reconciliation?.status === 'LOCKED'" class="locked-note"
        >该营业日已锁定，重复刷新不会产生新的关账记录。</view
      >
    </view>
  </view>
</template>

<style scoped src="../page.css"></style>

<style scoped>
.blocker-row {
  padding: 16rpx 0;
  border-bottom: 1rpx solid var(--color-border);
}
.blocker-row button {
  min-height: 44px;
  width: 100%;
  margin: 12rpx 0 0;
  font-size: 26rpx;
  text-align: left;
  padding: 16rpx;
}
</style>
