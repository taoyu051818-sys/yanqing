<script setup lang="ts">
const props = defineProps<{ value?: string; label?: string }>()
const labels: Record<string, string> = {
  PENDING_PAYMENT: '待支付', PAID: '已支付', CONFIRMED: '已确认', CHECKED_IN: '已签到',
  COMPLETED: '已完成', CANCELLED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款',
  OPEN: '报名中', REGISTRATION: '报名中', RUNNING: '进行中', ISSUED: '待领取',
  CLAIMED: '已领取', REDEEMED: '已核销', ACTIVE: '有效', PENDING: '待处理',
  REFUND_PENDING: '退款待审核', REQUESTED: '待审核', SUCCEEDED: '已完成',
  FULL: '已满员', IN_PROGRESS: '进行中', PARTIALLY_REFUNDED: '部分退款',
  WAITLISTED: '候补中', REGISTERED: '已报名', REJECTED: '未通过',
  FAILED: '处理失败', EXPIRED: '已过期', DISABLED: '已停用', DRAFT: '草稿',
  LOCKED: '已锁定', REVIEWING: '复核中', RESOLVED: '已解决', DISMISSED: '已排除',
  SUCCESS: '成功', VOID: '已作废', POSTED: '已过账', SETTLED: '已结算',
}
</script>

<template><text class="badge" :class="(props.value || '').toLowerCase()">{{ props.label || labels[props.value || ''] || props.value || '—' }}</text></template>

<style scoped>
.badge { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; max-width: 100%; min-height:40rpx; padding: 6rpx 14rpx; overflow:hidden; color: #456052; background: #eef2ef; border:1rpx solid rgba(69,96,82,.08); border-radius: 999rpx; font-size: 22rpx; line-height: 1.35; text-align: center; text-overflow:ellipsis; white-space: nowrap; }
.paid,.confirmed,.active,.completed,.checked_in,.redeemed { color: #17653d; background: #e5f3e9; }
.pending_payment,.pending,.refunding,.refund_pending,.requested,.reviewing { color: #9b6300; background: #fff2d6; }
.cancelled,.refunded,.failed,.rejected,.dismissed,.void { color: #8a3636; background: #fbeaea; }
</style>
