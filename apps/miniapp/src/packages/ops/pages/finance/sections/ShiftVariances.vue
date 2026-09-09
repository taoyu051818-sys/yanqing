<script setup lang="ts">
import type { useSessionStore } from "../../../../../stores/session";
import { toRefs } from "vue";
import { money, shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  loading: boolean;
  unreviewedShiftVariances: any[];
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
  focusedRecord: string;
  session: ReturnType<typeof useSessionStore>;
  actionKey: string;
  reviewShiftVariance: (shift: any) => void;
  acting: (key: string) => boolean;
}>();
const {
  loading,
  unreviewedShiftVariances,
  loadErrors,
  refresh,
  focusedRecord,
  session,
  actionKey,
  reviewShiftVariance,
  acting,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">
      前台现金差异复核
      <text class="section-note">{{
        loading ? "同步中" : `${unreviewedShiftVariances.length} 个待复核班次`
      }}</text>
    </view>
    <text class="section-description"
      >现金按实际收款操作员归属；班次操作人或关班人不能复核自己的差异，非零差异处理后才能完成日结关账。</text
    >
    <view v-if="loadErrors.shifts" class="notice error card">
      <text>{{ loadErrors.shifts }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view
      v-for="shift in unreviewedShiftVariances"
      :id="opsDeepLinkDomId('finance-shift', shift.id)"
      :key="shift.id"
      class="card workflow-card"
      :class="{
        'deep-link-target': focusedRecord === `finance-shift:${shift.id}`,
      }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{
            shift.operator?.displayName || "前台班次"
          }}</text>
          <text class="muted"
            >{{ shift.businessDateLabel || shortDate(shift.businessDate) }} ·
            {{ shift.venueCode || "MAIN" }}</text
          >
        </view>
        <text class="state-chip state-pending_confirmation">待差异复核</text>
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">备用金</text
          ><text class="detail-value">{{
            money(shift.openingCashCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">账面现金</text
          ><text class="detail-value">{{
            money(shift.expectedCashCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">实际盘点</text
          ><text class="detail-value">{{
            money(shift.closingCashCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">现金差异</text
          ><text class="detail-value danger-money">{{
            money(shift.cashVarianceCents)
          }}</text></view
        >
      </view>
      <view
        v-if="[shift.operatorId, shift.closedById].includes(session.user?.id)"
        class="locked-note"
        >你参与了本班次操作或关班，请切换另一名财务或管理员复核。</view
      >
      <view v-else class="action-row">
        <button
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="reviewShiftVariance(shift)"
        >
          {{
            acting(`shift-variance-review:${shift.id}`)
              ? "复核中…"
              : "复核现金差异"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="!loading && !loadErrors.shifts && !unreviewedShiftVariances.length"
      class="empty card"
      >当前没有待复核现金差异</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
