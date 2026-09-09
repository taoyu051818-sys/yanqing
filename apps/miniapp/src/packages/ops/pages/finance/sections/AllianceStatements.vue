<script setup lang="ts">
import { toRefs } from "vue";
import { money } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";

const props = defineProps<{
  loading: boolean;
  settlements: any[];
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
  settlementMerchant: (settlement: any) => any;
  settlementPeriod: (settlement: any) => string;
  settlementStatusLabel: (status?: string) => string;
  ratio: (value: unknown) => string;
  settlementHint: (
    settlement: any,
  ) =>
    | "待财务提交商户确认"
    | "待财务复核并提交"
    | "请商户确认或提出争议"
    | "已提交，等待商户确认"
    | "商户已确认，待财务结算入账"
    | "已确认，等待财务结算"
    | "结算闭环完成，记录不可覆盖"
    | "结算单已作废，仅供审计查询"
    | "请刷新获取最新状态";
  workflowNote: (settlement: any) => string;
  settlementHasAction: (settlement: any) => boolean;
  canFinanceAction: boolean;
  actionKey: string;
  submitSettlement: (settlement: any) => Promise<void>;
  acting: (key: string) => boolean;
  canMerchantAction: boolean;
  confirmSettlement: (settlement: any) => Promise<void>;
  disputeSettlement: (settlement: any) => void;
  settleSettlement: (settlement: any) => Promise<void>;
}>();
const {
  loading,
  settlements,
  loadErrors,
  refresh,
  focusedRecord,
  settlementMerchant,
  settlementPeriod,
  settlementStatusLabel,
  ratio,
  settlementHint,
  workflowNote,
  settlementHasAction,
  canFinanceAction,
  actionKey,
  submitSettlement,
  acting,
  canMerchantAction,
  confirmSettlement,
  disputeSettlement,
  settleSettlement,
} = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">
      联盟结算单
      <text class="section-note">{{
        loading ? "同步中" : `${settlements.length} 张`
      }}</text>
    </view>
    <view v-if="loadErrors.settlements" class="notice error card">
      <text>{{ loadErrors.settlements }}</text>
      <button class="ghost retry" :disabled="loading" @tap="refresh">
        重试
      </button>
    </view>
    <view v-if="loading && !settlements.length" class="empty card"
      >正在同步结算状态…</view
    >
    <view
      v-for="settlement in settlements"
      :id="opsDeepLinkDomId('finance-alliance-settlement', settlement.id)"
      :key="settlement.id"
      class="card workflow-card settlement-card"
      :class="{
        'deep-link-target':
          focusedRecord === `finance-alliance-settlement:${settlement.id}`,
      }"
    >
      <view class="workflow-head">
        <view class="workflow-main">
          <text class="order-title">{{ settlementMerchant(settlement) }}</text>
          <text class="muted">{{ settlementPeriod(settlement) }}</text>
        </view>
        <text
          class="state-chip"
          :class="`state-${String(settlement.status || '').toLowerCase()}`"
          >{{ settlementStatusLabel(settlement.status) }}</text
        >
      </view>
      <view class="settlement-numbers">
        <view
          ><text class="detail-label">发放 / 领取 / 核销</text
          ><text class="detail-value"
            >{{ settlement.issuedCount || 0 }} /
            {{ settlement.claimedCount || 0 }} /
            {{ settlement.redeemedCount || 0 }}</text
          ></view
        >
        <view
          ><text class="detail-label">有效新客</text
          ><text class="detail-value"
            >{{ settlement.effectiveNewCustomers || 0 }} 人</text
          ></view
        >
        <view
          ><text class="detail-label">归因 GMV</text
          ><text class="detail-value">{{
            money(settlement.attributedGmvCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">归因毛利</text
          ><text class="detail-value">{{
            money(settlement.attributedGrossProfitCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">应结服务费</text
          ><text class="detail-value money">{{
            money(settlement.cooperationFeeCents)
          }}</text></view
        >
        <view
          ><text class="detail-label">ROI</text
          ><text class="detail-value">{{ ratio(settlement.roi) }}</text></view
        >
      </view>
      <view class="state-guidance">
        <text>{{ settlementHint(settlement) }}</text>
        <text v-if="workflowNote(settlement)" class="muted workflow-note">{{
          workflowNote(settlement)
        }}</text>
      </view>
      <view v-if="settlementHasAction(settlement)" class="action-row">
        <button
          v-if="settlement.status === 'DRAFT' && canFinanceAction"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="submitSettlement(settlement)"
        >
          {{
            acting(`settlement-submit:${settlement.id}`)
              ? "提交中…"
              : "提交商户确认"
          }}
        </button>
        <button
          v-if="
            settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction
          "
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="confirmSettlement(settlement)"
        >
          {{
            acting(`settlement-confirm:${settlement.id}`)
              ? "确认中…"
              : "确认账单"
          }}
        </button>
        <button
          v-if="
            settlement.status === 'PENDING_CONFIRMATION' && canMerchantAction
          "
          class="danger action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="disputeSettlement(settlement)"
        >
          {{
            acting(`settlement-dispute:${settlement.id}`)
              ? "提交中…"
              : "提出争议"
          }}
        </button>
        <button
          v-if="settlement.status === 'CONFIRMED' && canFinanceAction"
          class="primary action-button"
          :disabled="loading || Boolean(actionKey)"
          @tap="settleSettlement(settlement)"
        >
          {{
            acting(`settlement-settle:${settlement.id}`)
              ? "入账中…"
              : "确认结算入账"
          }}
        </button>
      </view>
    </view>
    <view
      v-if="!loading && !loadErrors.settlements && !settlements.length"
      class="empty card"
      >当前没有联盟结算单，可先从商户生成草稿</view
    >
  </view>
</template>

<style scoped src="../page.css"></style>
