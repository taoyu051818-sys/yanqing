<script setup lang="ts">
import { computed } from "vue";
import type { OrderView } from "@yanqing/shared";
import ReasonForm from "../../components/ReasonForm.vue";
import { money } from "../../utils/format";
import { orderTimeLabel, refundableAmount } from "./order-presentation";
import { refundDestination } from "./refund-preview";
const props = defineProps<{
  order: OrderView;
  direct: boolean;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ submit: [reason: string]; cancel: [] }>();
const destination = computed(() => refundDestination(props.order));
</script>
<template>
  <ReasonForm
    :title="direct ? '确认退款' : '申请退款'"
    :description="
      direct
        ? '核对本次退款后确认，无需再次审核。'
        : '提交后由工作人员审核，可在本订单查看进度。'
    "
    :busy="busy"
    :error="error"
    :confirm-text="
      direct ? '确认退款 ' + money(refundableAmount(order)) : '提交退款申请'
    "
    @cancel="emit('cancel')"
    @submit="emit('submit', $event)"
  >
    <view class="refund-summary">
      <text class="refund-title">{{ order.title }}</text>
      <text v-if="order.member" class="refund-copy"
        >会员：{{ order.member.displayName }}</text
      >
      <text class="refund-copy">{{ orderTimeLabel(order) }}</text>
      <view class="refund-amount"
        ><text>本次退款</text
        ><text>{{ money(refundableAmount(order)) }}</text></view
      >
      <view class="refund-destination"
        ><text>退回方式</text><text>{{ destination.label }}</text></view
      >
      <text v-if="direct && destination.cash" class="cash-note"
        >请先向会员退回现金，再确认登记。</text
      >
      <text v-else class="refund-copy"
        >提交后以退款记录为准，处理中不代表已到账。</text
      >
    </view>
  </ReasonForm>
</template>
<style scoped>
.refund-summary {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding: 22rpx;
  background: #f5f6f8;
  border-radius: 18rpx;
}
.refund-title {
  font-size: 30rpx;
  font-weight: 650;
}
.refund-copy {
  font-size: 24rpx;
  line-height: 1.6;
  color: #626d66;
}
.refund-amount,
.refund-destination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  font-size: 26rpx;
}
.refund-amount {
  margin-top: 12rpx;
  padding-top: 18rpx;
  border-top: 1px solid #dce2dd;
}
.refund-amount text:last-child {
  font-size: 38rpx;
  font-weight: 650;
}
.refund-destination text:last-child {
  flex: 1;
  min-width: 0;
  text-align: right;
}
.cash-note {
  color: #975b12;
  font-size: 26rpx;
  line-height: 1.6;
}
</style>
