<script setup lang="ts">
const props = defineProps<{ value?: string }>()
const labels: Record<string, string> = {
  PENDING_PAYMENT: '待支付', PAID: '已支付', CONFIRMED: '已确认', CHECKED_IN: '已签到',
  COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款',
  OPEN: '报名中', REGISTRATION: '报名中', RUNNING: '进行中', ISSUED: '待领取',
  CLAIMED: '已领取', REDEEMED: '已核销', ACTIVE: '有效', PENDING: '待处理',
  REFUND_PENDING: '退款待审核', REQUESTED: '待审核', SUCCEEDED: '已完成',
}
</script>

<template><text class="badge" :class="(props.value || '').toLowerCase()">{{ labels[props.value || ''] || props.value || '—' }}</text></template>

<style scoped>
.badge { display: inline-flex; padding: 7rpx 14rpx; color: #456052; background: #eef2ef; border-radius: 999rpx; font-size: 22rpx; }
.paid,.confirmed,.active,.completed,.checked_in,.redeemed { color: #17653d; background: #e5f3e9; }
.pending_payment,.pending,.refunding,.refund_pending,.requested { color: #9b6300; background: #fff2d6; }
.cancelled,.refunded { color: #8a3636; background: #fbeaea; }
</style>
