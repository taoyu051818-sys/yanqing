<script setup lang="ts">
import { ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { idempotencyKey, money, shortDate } from '../../utils/format'

const orders = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const businessTypeLabel: Record<string, string> = {
  VENUE: '场地预订', GAME: '拼场球局', EVENT: '赛事报名', TRAINING: '培训课程',
  MEMBERSHIP: '会员开通', RECHARGE: '账户充值', GOODS: '商品购买', COUPON: '卡券权益',
}
const displayBusinessType = (value?: string) => businessTypeLabel[value || ''] || '其他消费'
async function load() {
  loading.value = true
  error.value = ''
  try { orders.value = ((await endpoints.orders()) as any).items || [] }
  catch (cause: any) { error.value = cause?.message || '订单加载失败，请稍后重试' }
  finally { loading.value = false; uni.stopPullDownRefresh() }
}
async function pay(order: any) {
  let result: UniApp.ShowActionSheetRes
  try { result = await uni.showActionSheet({ itemList: ['微信支付', '现金本金', '赠送余额', '羽毛球币'] }) }
  catch { return }
  const channel = ['WECHAT', 'CASH_PRINCIPAL', 'GIFT_BALANCE', 'BADMINTON_COIN'][result.tapIndex]
  if (!channel) return
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
    <view v-if="error" class="card load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view v-if="loading && !orders.length" class="card loading-state">订单同步中…</view>
    <view v-for="order in orders" :key="order.id" class="card order">
      <view class="row order-head"><text class="order-no">订单号 {{ order.orderNo }}</text><StatusBadge :value="order.status" /></view>
      <text class="title">{{ order.title }}</text>
      <view class="row order-meta"><text class="muted">{{ shortDate(order.createdAt) }} · {{ displayBusinessType(order.businessType) }}</text><text class="money">{{ money(order.payableCents) }}</text></view>
      <view v-if="order.status === 'PENDING'" class="actions"><button class="primary small" @tap="pay(order)">立即支付</button></view>
      <view v-else-if="['PAID','CHECKED_IN','COMPLETED','PARTIALLY_REFUNDED'].includes(order.status)" class="actions"><button class="secondary small" @tap="refund(order)">申请退款</button></view>
    </view>
    <SectionEmpty v-if="!orders.length && !loading && !error" title="还没有订单" description="订场、球局、赛事和培训订单都会汇总在这里" />
  </view>
</template>
<style scoped>
.order-head,.order-meta { flex-wrap: wrap; }
.order-no { min-width: 0; color: #69736c; font-size: 22rpx; overflow-wrap: anywhere; }
.title { display: block; margin: 26rpx 0 18rpx; font-size: 31rpx; font-weight: 700; overflow-wrap: anywhere; }
.order-meta .muted { flex: 1 1 260rpx; min-width: 0; }
.order-meta .money { flex: 0 0 auto; }
.actions { display: flex; justify-content: flex-end; margin-top: 22rpx; padding-top: 20rpx; border-top: 1rpx solid #edf0ed; }
.small { min-width: 190rpx; margin: 0; padding: 0 24rpx; }
.load-error { display: flex; align-items: center; gap: 18rpx; color: #9a3e36; background: #fff4f2; }
.load-error text { flex: 1; min-width: 0; line-height: 1.5; overflow-wrap: anywhere; }
.retry { flex: 0 0 auto; min-height: 64rpx; margin: 0; padding: 0 22rpx; line-height: 64rpx; font-size: 23rpx; }
.loading-state { color: #758079; text-align: center; }
@media (max-width: 360px) {
  .load-error { align-items: stretch; flex-wrap: wrap; }
  .load-error .retry { width: 100%; }
  .actions { align-items: stretch; }
  .actions .small { width: 100%; }
}
</style>
