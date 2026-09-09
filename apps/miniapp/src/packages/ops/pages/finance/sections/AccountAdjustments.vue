<script setup lang="ts">
import { toRefs } from "vue";
import { shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  canFinanceAction: boolean;
  loading: boolean;
  adjustments: any[];
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
  accountDelta: (request: any) => string;
  isOwnAdjustment: (request: any) => boolean;
  actionKey: string;
  reviewAdjustment: (request: any, approved: boolean) => void;
  acting: (key: string) => boolean;
}>();
const {
  canFinanceAction,
  loading,
  adjustments,
  loadErrors,
  refresh,
  focusedRecord,
  accountDelta,
  isOwnAdjustment,
  actionKey,
  reviewAdjustment,
  acting,
} = toRefs(props);
</script>

<template>
  <view>
    <template v-if="canFinanceAction">
      <view class="section-title">
        账户调整复核
        <text class="section-note">{{
          loading ? "同步中" : `${adjustments.length} 笔待审`
        }}</text>
      </view>
      <view v-if="loadErrors.adjustments" class="notice error card">
        <text>{{ loadErrors.adjustments }}</text>
        <button class="ghost retry" :disabled="loading" @tap="refresh">
          重试
        </button>
      </view>
      <view
        v-for="request in adjustments"
        :id="opsDeepLinkDomId('finance-adjustment', request.id)"
        :key="request.id"
        class="card workflow-card"
        :class="{
          'deep-link-target':
            focusedRecord === `finance-adjustment:${request.id}`,
        }"
      >
        <view class="workflow-head">
          <view class="workflow-main">
            <text class="order-title">{{
              request.account?.user?.displayName || "会员账户"
            }}</text>
            <text class="muted"
              >{{ request.account?.type }} · 申请人
              {{ request.requestedBy?.displayName || "历史申请人" }}</text
            >
          </view>
          <text class="state-chip state-draft">待复核</text>
        </view>
        <view class="detail-grid">
          <view
            ><text class="detail-label">调整数额</text
            ><text class="detail-value">{{ accountDelta(request) }}</text></view
          >
          <view
            ><text class="detail-label">申请时间</text
            ><text class="detail-value">{{
              shortDate(request.createdAt)
            }}</text></view
          >
        </view>
        <view class="reason-box"
          ><text class="detail-label">调整原因</text
          ><text class="reason-text">{{ request.reason }}</text></view
        >
        <view v-if="isOwnAdjustment(request)" class="locked-note"
          >制单人与复核人不能是同一账号，请由另一名财务或管理员处理。</view
        >
        <view v-else class="action-row">
          <button
            class="primary action-button"
            :disabled="loading || Boolean(actionKey)"
            @tap="reviewAdjustment(request, true)"
          >
            {{
              acting(`account-adjustment-approve:${request.id}`)
                ? "入账中…"
                : "复核入账"
            }}
          </button>
          <button
            class="danger action-button"
            :disabled="loading || Boolean(actionKey)"
            @tap="reviewAdjustment(request, false)"
          >
            {{
              acting(`account-adjustment-reject:${request.id}`)
                ? "驳回中…"
                : "驳回申请"
            }}
          </button>
        </view>
      </view>
      <view
        v-if="!loading && !loadErrors.adjustments && !adjustments.length"
        class="empty card"
        >当前没有待复核账户调整</view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
