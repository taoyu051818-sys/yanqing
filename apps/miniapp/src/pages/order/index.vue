<script setup lang="ts">
import { ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { idempotencyKey, money, shortDate } from '../../utils/format'

const orders = ref<any[]>([])
const loading = ref(false)
async function load() {
  loading.value = true
  try { orders.value = ((await endpoints.orders()) as any).items || [] }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
  finally { loading.value = false; uni.stopPullDownRefresh() }
}
async function pay(order: any) {
  const result = await uni.showActionSheet({ itemList: ['微信支付', '现金本金', '赠送余额', '羽毛球币'] })
  const channel = ['WECHAT', 'CASH_PRINCIPAL', 'GIFT_BALANCE', 'BADMINTON_COIN'][result.tapIndex]
  try {
    const payment: any = await endpoints.payOrder(order.id, { channel, idempotencyKey: idempotencyKey(`pay-${order.id}`) })
    const wechatPay = payment.wechatPay || payment.providerPayload?.wechatPay
    if (channel === 'WECHAT' && wechatPay) {
      await uni.requestPayment(wechatPay)
      uni.showToast({ title: '支付结果确认中', icon: 'success' })
    } else {
      uni.showToast({ title: '支付成功', icon: 'success' })
    }
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
async function refund(order: any) {
  const result = await uni.showModal({ title: '申请退款', editable: true, placeholderText: '请输入退款原因' })
  if (!result.confirm) return
  try {
    await endpoints.refundOrder(order.id, {
      amountCents: Math.max(0, Number(order.paidCents || order.payableCents || 0) - Number(order.refundedCents || 0)),
      reason: result.content || '用户申请退款',
      idempotencyKey: idempotencyKey(`refund-${order.id}`),
    })
    uni.showToast({ title: '申请已提交', icon: 'success' }); await load()
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
onShow(load)
onPullDownRefresh(load)
</script>

<template>
  <view class="page safe-bottom">
    <view v-for="order in orders" :key="order.id" class="card order">
      <view class="row"><text class="order-no">{{ order.orderNo }}</text><StatusBadge :value="order.status" /></view>
      <text class="title">{{ order.title }}</text>
      <view class="row"><text class="muted">{{ shortDate(order.createdAt) }} · {{ order.businessType }}</text><text class="money">{{ money(order.payableCents) }}</text></view>
      <view v-if="order.status === 'PENDING'" class="actions"><button class="primary small" @tap="pay(order)">立即支付</button></view>
      <view v-else-if="['PAID','CHECKED_IN','COMPLETED','PARTIALLY_REFUNDED'].includes(order.status)" class="actions"><button class="secondary small" @tap="refund(order)">申请退款</button></view>
    </view>
    <SectionEmpty v-if="!orders.length && !loading" title="还没有订单" description="订场、球局、赛事和培训订单都会汇总在这里" />
  </view>
</template>
<style scoped>
.order-no { color: #69736c; font-family: monospace; font-size: 22rpx; }
.title { display: block; margin: 26rpx 0 18rpx; font-size: 31rpx; font-weight: 700; }
.actions { display: flex; justify-content: flex-end; margin-top: 22rpx; padding-top: 20rpx; border-top: 1rpx solid #edf0ed; }
.small { min-width: 190rpx; margin: 0; padding: 0 24rpx; }
</style>
