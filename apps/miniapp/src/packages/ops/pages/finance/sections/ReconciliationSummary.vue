<script setup lang="ts">
import { toRefs } from "vue";
import { money } from "../../../../../utils/format";

const props = defineProps<{
  dashboard: Record<string, any> | null;
  training: Record<string, any> | null;
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
}>();
const { dashboard, training, loadErrors } = toRefs(props);
</script>

<template>
  <view>
    <view class="section-title">经营对账</view>
    <view class="card reconciliation">
      <view class="row"
        ><text>本期支付额（含账户权益）</text
        ><text class="money">{{
          money(dashboard?.collections?.grossPaymentCents)
        }}</text></view
      >
      <view class="row"
        ><text>本期退款额（含退回账户）</text
        ><text class="money"
          >-{{ money(dashboard?.collections?.completedRefundCents) }}</text
        ></view
      >
      <view class="row"
        ><text>净支付额</text
        ><text class="money">{{
          money(dashboard?.collections?.netPaymentCents)
        }}</text></view
      >
      <view class="row"
        ><text>现金收款</text
        ><text class="money">{{
          money(
            dashboard?.collections?.cashCollectedCents ??
              dashboard?.collections?.grossPaymentCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>现金退款</text
        ><text class="money"
          >-{{
            money(
              dashboard?.collections?.cashRefundedCents ??
                dashboard?.collections?.completedRefundCents,
            )
          }}</text
        ></view
      >
      <view class="row"
        ><text>现金净流入</text
        ><text class="money">{{
          money(
            dashboard?.collections?.netCashCents ??
              dashboard?.collections?.netPaymentCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>充值新增预收</text
        ><text class="money">{{
          money(dashboard?.collections?.rechargePrepaidCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训新增预收</text
        ><text class="money">{{
          money(dashboard?.collections?.trainingPrepaidCollectedCents)
        }}</text></view
      >
      <view class="row"
        ><text>已实现经营收入</text
        ><text class="money">{{
          money(dashboard?.revenue?.realizedRevenueCents)
        }}</text></view
      >
      <view class="row"
        ><text>场地收入</text
        ><text class="money">{{
          money(dashboard?.venue?.revenueCents)
        }}</text></view
      >
      <view class="row"
        ><text>商品收入</text
        ><text class="money">{{
          money(dashboard?.goods?.revenueCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训确认收入</text
        ><text class="money">{{
          money(
            training?.confirmedRevenueCents ??
              dashboard?.training?.confirmedRevenueCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>培训未消课余额</text
        ><text class="money">{{
          money(
            training?.unusedBalanceCents ??
              dashboard?.training?.unusedBalanceCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>培训本期退费</text
        ><text class="money">{{
          money(dashboard?.training?.refundedCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训场馆合同分成</text
        ><text class="money">{{
          money(
            training?.venueContractContributionCents ??
              training?.venueContributionCents ??
              dashboard?.training?.venueContributionCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>培训场地费</text
        ><text class="money">{{
          money(training?.venueFeeCents ?? dashboard?.training?.venueFeeCents)
        }}</text></view
      >
      <view class="row"
        ><text>培训现金贡献毛利</text
        ><text class="money">{{
          money(
            training?.cashContributionMarginCents ??
              dashboard?.training?.cashContributionMarginCents,
          )
        }}</text></view
      >
      <view class="row"
        ><text>每占场小时现金贡献</text
        ><text class="money">{{
          money(
            training?.resourceEfficiencyCentsPerCourtHour ??
              dashboard?.training?.resourceEfficiencyCentsPerCourtHour,
          )
        }}</text></view
      >
      <view class="row"
        ><text>球馆合同流水总额</text
        ><text class="money">{{
          money(dashboard?.contract?.venueContractRevenueCents)
        }}</text></view
      >
      <text
        v-if="loadErrors.dashboard || loadErrors.training"
        class="inline-error"
        >{{
          loadErrors.dashboard || loadErrors.training
        }}，当前数值可能不完整。</text
      >
      <text class="muted guardrail"
        >口径锁定：充值和培训课包收款先记预收；培训确认收入只来自异人复核后的消课，20%进入场馆合同流水；占场只做资源效率分析，场地费与场馆应付款恒为
        0。</text
      >
    </view>
  </view>
</template>

<style scoped src="../page.css"></style>
