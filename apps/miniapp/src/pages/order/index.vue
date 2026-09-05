<script setup lang="ts">
import { computed, ref } from 'vue'
import { onHide, onLoad, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import SectionEmpty from '../../components/SectionEmpty.vue'
import ReasonForm from '../../components/ReasonForm.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { isMockMode } from '../../services/http'
import { apiFeedback } from '../../services/api-feedback'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import { dateTimeRange, idempotencyKey, money, shortDate } from '../../utils/format'
import { useSessionStore } from '../../stores/session'
import { openMemberPage, openMemberRecord, requestMemberLogin } from '../../utils/member-navigation'
import { gameDetailPath } from '../../utils/game-detail'

const session = useSessionStore()
const orders = ref<any[]>([])
const focusedId = ref('')
const statusFilter = ref('')
const page = ref(1)
const total = ref(0)
const filters = [{ label: '全部', status: '' }, { label: '待付款', status: 'PENDING' }, { label: '待使用', status: 'PAID' }, { label: '售后中', status: 'REFUND_PENDING' }]
let loadGeneration = 0
const loading = ref(false)
const error = ref('')
const actionKey = ref('')
const payingId = ref('')
const paymentChannel = ref('WECHAT')
const paymentError = ref('')
const paymentQuote = ref<any>(null)
const balanceLoading = ref(false)
const refundingId = ref('')
const refundError = ref('')
let canWechatPay = isMockMode
// #ifdef MP-WEIXIN
canWechatPay = true
// #endif
const paymentChoices = computed<Array<{ channel: string; label: string; note: string; disabled: boolean; debitAmount: number }>>(() => (paymentQuote.value?.options || []).map((option: any) => {
  const coin = option.unit === 'COIN'
  const wechat = option.channel === 'WECHAT'
  const balance = coin ? option.availableBalance + ' 币' : money(option.availableBalance)
  const amount = coin ? option.debitAmount + ' 币' : money(option.debitAmount)
  return { channel: option.channel, debitAmount: option.debitAmount,
    label: ({ WECHAT: isMockMode ? '微信支付（模拟）' : '微信支付', CASH_PRINCIPAL: '充值余额', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币' } as any)[option.channel],
    note: option.reason || (wechat ? isMockMode ? '仅演示，不扣真实资金' : canWechatPay ? '确认后调起微信支付' : '请在微信小程序内完成微信支付' : '可用 ' + balance + ' · 本次扣除 ' + amount),
    disabled: !option.enabled || (wechat && !canWechatPay),
  }
}))
const refundableAmount = (order: any) => Math.max(0, Number(order.paidCents ?? order.payableCents ?? 0) - Number(order.refundedCents || 0))
async function preparePay(order: any) {
  if (actionKey.value || balanceLoading.value) return
  payingId.value = order.id; paymentChannel.value = 'WECHAT'; paymentError.value = ''
  paymentQuote.value = null; balanceLoading.value = true
  try {
    const quote = await endpoints.paymentOptions(order.id)
    if (payingId.value !== order.id) return
    paymentQuote.value = quote
    paymentChannel.value = paymentChoices.value.find((item: any) => !item.disabled)?.channel || ''
  } catch (cause: any) { paymentError.value = apiFeedback(cause?.message, cause?.statusCode || 0) }
  finally { balanceLoading.value = false }
}
const nowMs = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | undefined
let expiryRefreshPending = false
const businessTypeLabel: Record<string, string> = {
  VENUE: '场地预订', GAME: '拼场球局', EVENT: '赛事报名', TRAINING: '培训课程',
  MEMBERSHIP: '会员开通', RECHARGE: '账户充值', GOODS: '商品购买', COUPON: '卡券权益',
}
const businessTypeIcon: Record<string, string> = {
  VENUE: 'venue', GAME: 'sport', EVENT: 'event', TRAINING: 'training',
  MEMBERSHIP: 'members', RECHARGE: 'finance', GOODS: 'shop', COUPON: 'ticket',
}
const displayBusinessType = (value?: string) => businessTypeLabel[value || ''] || '其他消费'
const paymentDeadline = (order: any) =>
  order.paymentExpiresAt ||
  order.eventTeam?.paymentDueAt ||
  order.trainingEnrollment?.seatReservedUntil ||
  null
const deadlineExpired = (order: any) => {
  const deadline = paymentDeadline(order)
  return Boolean(deadline && new Date(deadline).getTime() <= nowMs.value)
}
function paymentCountdown(order: any) {
  const deadline = paymentDeadline(order)
  if (!deadline) return '请尽快完成支付'
  const remainingSeconds = Math.max(0, Math.ceil((new Date(deadline).getTime() - nowMs.value) / 1000))
  if (!remainingSeconds) return '支付时间已到，正在同步订单状态'
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = String(remainingSeconds % 60).padStart(2, '0')
  return `支付剩余 ${minutes}:${seconds}`
}
function orderTimeLabel(order: any) {
  const booking = order.bookings?.[0]
  const game = order.gameRegistration?.game
  const event = order.eventTeam?.event
  const start = booking?.startsAt || game?.startsAt || event?.startsAt || order.trainingEnrollment?.startsAt
  const end = booking?.endsAt || game?.endsAt
  if (!start) return `下单 ${shortDate(order.createdAt)}`
  return `使用时间 ${dateTimeRange(start, end)}`
}
async function load(more = false) {
  if (!session.isAuthenticated) return requestMemberLogin(focusedId.value
    ? `/pages/order/index?id=${encodeURIComponent(focusedId.value)}`
    : `/pages/order/index${statusFilter.value ? `?status=${statusFilter.value}` : ''}`)
  const run = ++loadGeneration
  const requestedPage = more ? page.value + 1 : 1
  loading.value = true
  error.value = ''
  try {
    const result = focusedId.value
      ? { items: [await endpoints.order(focusedId.value)], total: 1 }
      : await endpoints.orders({ page: requestedPage, pageSize: 20, ...(statusFilter.value ? { status: statusFilter.value } : {}) })
    if (run !== loadGeneration) return
    orders.value = more ? [...orders.value, ...result.items] : result.items
    total.value = result.total
    page.value = requestedPage
  }
  catch (cause: any) {
    if (run === loadGeneration) error.value = cause?.statusCode === 400
      ? '订单筛选未成功，请重试'
      : cause?.message || '订单加载失败，请稍后重试'
  }
  finally { if (run === loadGeneration) loading.value = false; uni.stopPullDownRefresh() }
}
function filterOrders(status: string) { focusedId.value = ''; statusFilter.value = status; orders.value = []; total.value = 0; page.value = 1; void load() }
function openRelated(order: any) {
  if (order.businessType === 'GAME') return openMemberRecord(order.gameRegistration?.game?.id ? gameDetailPath(order.gameRegistration.game.id) : '/pages/community/index?tab=games&view=mine')
  if (order.businessType === 'EVENT') return openMemberPage(`/pages/community/index?tab=events&eventId=${encodeURIComponent(order.eventTeam?.event?.id || '')}&view=mine`)
  if (order.businessType === 'TRAINING') return openMemberPage('/pages/training/index?tab=mine')
}
onLoad((query) => {
  focusedId.value = typeof query?.id === 'string' ? query.id : ''
  if (filters.some((item) => item.status === query?.status)) statusFilter.value = String(query?.status || '')
})
async function pay(order: any) {
  if (actionKey.value || deadlineExpired(order) || order.status !== 'PENDING') return
  const channel = paymentChannel.value
  if (!paymentChoices.value.some(item => item.channel === channel && !item.disabled)) return
  paymentError.value = ''
  actionKey.value = `pay:${order.id}`
  try {
    const payment: any = await withPendingCreationKey('order.payment', { orderId: order.id, channel, expectedDebitAmount: paymentQuote.value?.options.find((item: any) => item.channel === channel)?.debitAmount }, idempotencyKey =>
      endpoints.payOrder(order.id, { channel, idempotencyKey, expectedDebitAmount: paymentQuote.value?.options.find((item: any) => item.channel === channel)?.debitAmount }))
    const wechatPay = payment.wechatPay || payment.providerPayload?.wechatPay
    if (!isMockMode && channel === 'WECHAT' && wechatPay) {
      await uni.requestPayment(wechatPay)
      uni.showToast({ title: '支付结果确认中', icon: 'success' })
    } else {
      uni.showToast({ title: payment.status === 'SUCCEEDED' ? '支付成功' : '正在同步支付结果', icon: 'none' })
    }
    payingId.value = ''
    await load()
    await session.hydrate()
  } catch (cause: any) {
    paymentError.value = /cancel/.test(cause?.errMsg || '') ? '你已取消付款，订单仍保留，可稍后重试。' : apiFeedback(cause?.message, cause?.statusCode || 0)
  }
  finally { actionKey.value = '' }
}
async function cancelPending(order: any) {
  if (actionKey.value) return
  const result = await uni.showModal({
    title: '取消待支付订单',
    content: order.businessType === 'GAME' ? `取消“${order.title}”后将释放你的报名名额，有候补时按顺序晋级。不会取消整场球局。` : order.businessType === 'VENUE' ? `取消“${order.title}”后将立即释放场地。` : order.businessType === 'TRAINING' ? '取消后释放班级预留名额，不产生消课或退款。' : `取消“${order.title}”不扣款，不会发放会员权益、充值余额或扣减库存。`,
    confirmText: '确认取消',
    confirmColor: '#a52626',
  })
  if (!result.confirm) return
  actionKey.value = `cancel:${order.id}`
  try {
    await endpoints.cancelPendingOrder(order.id, {
      reason: '会员主动取消待支付订单',
      idempotencyKey: idempotencyKey(`cancel-${order.id}`),
    })
    uni.showToast({ title: '待付款订单已取消', icon: 'success' })
    await load()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '取消订单失败', icon: 'none' })
  } finally {
    actionKey.value = ''
  }
}
async function refund(order: any, reason: string) {
  if (actionKey.value || refundableAmount(order) <= 0) return
  actionKey.value = 'refund:' + order.id
  refundError.value = ''
  try {
    const command = { orderId: order.id, amountCents: refundableAmount(order), reason }
    await withPendingCreationKey('order.refund', command, idempotencyKey =>
      endpoints.refundOrder(order.id, { amountCents: command.amountCents, reason, idempotencyKey }))
    refundingId.value = ''
    uni.showToast({ title: '申请已提交', icon: 'success' })
    await load()
  } catch (cause: any) { refundError.value = cause.message || '申请失败，请重试' }
  finally { actionKey.value = '' }
}
function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  nowMs.value = Date.now()
  countdownTimer = setInterval(() => {
    nowMs.value = Date.now()
    if (
      !expiryRefreshPending &&
      orders.value.some((order) => order.status === 'PENDING' && deadlineExpired(order))
    ) {
      expiryRefreshPending = true
      void load().finally(() => { expiryRefreshPending = false })
    }
  }, 1000)
}
function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = undefined
}
onShow(() => { startCountdown(); void load() })
onHide(stopCountdown)
onUnload(stopCountdown)
onPullDownRefresh(() => load())
</script>

<template>
  <view class="page safe-bottom">
    <button v-if="focusedId" class="secondary all-orders" @tap="filterOrders('')">查看全部订单</button>
    <view v-else class="order-filters"><button v-for="filter in filters" :key="filter.label" :class="{ selected: statusFilter === filter.status }" :aria-pressed="statusFilter === filter.status" @tap="filterOrders(filter.status)">{{ filter.label }}</button></view>
    <view v-if="error" class="card load-error" role="alert" aria-live="polite"><AppIcon name="warning" :size="32" tone="danger" /><text>{{ error }}</text><button class="secondary retry" :disabled="loading" @tap="load()"><AppIcon name="refresh" :size="26" />重试</button></view>
    <view v-if="loading && !orders.length" class="loading-stack"><view class="card order-skeleton skeleton" /><view class="card order-skeleton skeleton" /></view>
    <view v-for="order in orders" :key="order.id" class="card order">
      <view class="row order-head"><view class="order-identity"><view class="order-icon"><AppIcon :name="businessTypeIcon[order.businessType] || 'receipt'" :size="30" /></view><text class="order-no">订单号 {{ order.orderNo }}</text></view><StatusBadge :value="order.status" :label="order.status === 'PENDING' ? '待付款' : undefined" /></view>
      <text class="title">{{ order.title }}</text>
      <view class="row order-meta"><view class="order-meta-copy"><text class="muted">{{ orderTimeLabel(order) }}</text><text class="muted">{{ displayBusinessType(order.businessType) }}</text></view><text class="money">{{ money(order.payableCents) }}</text></view>
      <text v-if="order.businessType === 'VENUE' && order.status === 'PAID'" class="use-note">{{ order.bookings?.[0]?.court?.name }} · 到店向前台出示本订单，完成核销后入场。</text>
      <text v-if="order.status === 'CANCELLED'" class="use-note">订单已取消，无需付款。{{ order.businessType === 'VENUE' ? '场地保留已解除。' : '' }}</text>
      <text v-if="order.businessType === 'GOODS' && order.status === 'PAID'" class="use-note">请到场馆出示本订单领取商品，取货进度以工作人员确认为准。</text>
      <button v-if="order.businessType === 'RECHARGE' && ['COMPLETED','REFUNDED','PARTIALLY_REFUNDED'].includes(order.status)" class="secondary related-order" @tap="openMemberPage('/pages/wallet/index')">查看到账余额与明细</button>
      <button v-if="order.businessType === 'MEMBERSHIP' && order.status === 'COMPLETED'" class="secondary related-order" @tap="openMemberPage('/pages/profile/index')">查看我的会员权益</button>
      <text v-if="order.status === 'REFUND_PENDING'" class="use-note">退款申请处理中，请在本订单查看处理结果。</text>
      <view v-if="order.refunds?.length" class="refund-history"><text v-for="item in order.refunds" :key="item.id">退款 {{ money(item.amountCents) }} · {{ ({ REQUESTED: '待审核', PENDING: '待审核', APPROVED: '已通过', PROCESSING: '处理中', SUCCEEDED: '已退款', REJECTED: '未通过', FAILED: '处理失败', CANCELLED: '已撤回' } as any)[item.status] || '处理中' }}</text></view>
      <view v-if="order.status === 'PENDING'" class="pending-panel">
        <view class="payment-window"><AppIcon name="clock" :size="28" :tone="deadlineExpired(order) ? 'danger' : 'accent'" /><text>{{ paymentCountdown(order) }}</text></view>
        <view class="actions">
          <button v-if="['VENUE', 'GAME', 'TRAINING', 'MEMBERSHIP', 'RECHARGE', 'GOODS'].includes(order.businessType)" class="danger small" :loading="actionKey === `cancel:${order.id}`" :disabled="Boolean(actionKey) || deadlineExpired(order)" @tap="cancelPending(order)"><AppIcon name="close" :size="30" tone="danger" />取消订单</button>
          <button v-if="payingId !== order.id" class="primary small" :loading="actionKey === `pay:${order.id}`" :disabled="Boolean(actionKey) || deadlineExpired(order)" @tap="preparePay(order)"><AppIcon name="finance" :size="30" tone="inverse" />立即支付</button>
        </view>
      </view>
      <view v-if="payingId === order.id && order.status === 'PENDING'" class="payment-selection">
        <text class="title">选择支付方式</text>
        <text v-if="order.businessType === 'RECHARGE'" class="use-note">充值订单仅支持微信支付，不可使用已有余额充值。</text>
        <text v-if="balanceLoading" class="use-note">正在同步最新余额…</text>
        <button v-for="choice in paymentChoices" :key="choice.channel" class="payment-choice" :aria-pressed="paymentChannel === choice.channel" :disabled="Boolean(actionKey) || choice.disabled" @tap="paymentChannel = choice.channel"><text>{{ paymentChannel === choice.channel ? '已选 · ' : '' }}{{ choice.label }}</text><text class="muted">{{ choice.note }}</text></button>
        <button v-if="!balanceLoading && !actionKey && (!paymentQuote || paymentError)" class="secondary" @tap="preparePay(order)">重新同步支付方式</button>
        <text v-if="paymentError" class="payment-error" role="alert">{{ paymentError }}</text>
        <button class="primary" :loading="actionKey === 'pay:' + order.id" :disabled="Boolean(actionKey) || deadlineExpired(order) || !paymentChoices.some(item => item.channel === paymentChannel && !item.disabled)" @tap="pay(order)">确认支付 {{ money(order.payableCents) }}</button>
        <button class="secondary" :disabled="Boolean(actionKey)" @tap="payingId = ''">暂不付款</button>
      </view>
      <button v-if="['GAME','EVENT','TRAINING'].includes(order.businessType)" class="secondary related-order" @tap="openRelated(order)">{{ order.businessType === 'TRAINING' ? '查看课程与退费' : order.businessType === 'EVENT' ? '查看报名与取消' : '查看球局安排' }}</button>
      <view v-if="!['EVENT','TRAINING'].includes(order.businessType) && ['PAID','CHECKED_IN','COMPLETED','PARTIALLY_REFUNDED'].includes(order.status) && refundableAmount(order) > 0" class="actions"><button class="secondary small" :disabled="Boolean(actionKey)" @tap="refundingId = order.id; refundError = ''"><AppIcon name="refund" :size="28" />申请退款</button></view>
      <ReasonForm v-if="refundingId === order.id && !['EVENT','TRAINING'].includes(order.businessType) && ['PAID','CHECKED_IN','COMPLETED','PARTIALLY_REFUNDED'].includes(order.status) && refundableAmount(order) > 0" :key="order.id" title="申请退款" :description="'申请金额 ' + money(refundableAmount(order)) + '。提交后由工作人员按订单状态和退款规则审核，进度在本订单查看。'" :busy="Boolean(actionKey)" :error="refundError" confirm-text="确认申请退款" @cancel="refundingId = ''" @submit="refund(order, $event)" />
    </view>
    <button v-if="!focusedId && !error && orders.length > 0 && orders.length < total" class="secondary all-orders" :loading="loading" :disabled="loading" @tap="load(true)">加载更多订单</button>
    <SectionEmpty v-if="!orders.length && !loading && !error" icon="receipt" :title="statusFilter ? '暂无这类订单' : '还没有订单'" description="已预约或报名的记录会保存在这里。" />
    <button v-if="!orders.length && !loading && !error" class="secondary all-orders" @tap="openMemberPage('/pages/booking/index')">去看看可订场地</button>
  </view>
</template>
<style scoped>
.payment-selection { display:grid; gap:18rpx; padding:22rpx; margin-top:20rpx; background:var(--color-surface-subtle); border-radius:20rpx; }.payment-selection button { width:100%; margin:0; padding:18rpx 12rpx; font-size:26rpx; }.payment-choice { flex-direction:column; align-items:flex-start !important; gap:8rpx; text-align:left; border:1rpx solid var(--color-border); background:#fff; }.payment-choice[aria-pressed="true"] { border-color:var(--color-primary); background:var(--color-primary-soft); }.payment-choice .muted { font-size:24rpx; line-height:1.6; }.payment-error { color:var(--color-danger); line-height:1.6; }

.order-meta-copy { display:flex; flex-direction:column; gap:6rpx; flex:1 1 260rpx; min-width:0; line-height:1.5; }
.order-filters { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6rpx; padding:6rpx; margin-bottom:24rpx; background:var(--color-primary-soft); border-radius:20rpx; }
.order-filters button { width:100%; padding:12rpx 4rpx; margin:0; font-size:24rpx; color:var(--color-muted); background:transparent; }
.order-filters .selected { color:var(--color-primary); background:var(--color-surface); }
.all-orders,.related-order { width:100%; margin:0 0 24rpx; }
.related-order { margin:24rpx 0 0; }
.use-note { display:block; margin:20rpx 0; font-size:25rpx; color:var(--color-muted); line-height:1.6; }
.refund-history { display:grid; gap:8rpx; padding:18rpx; margin-top:20rpx; background:var(--color-surface-subtle); border-radius:16rpx; font-size:24rpx; }
.order-head,.order-meta { flex-wrap: wrap; }
.order-identity { display:flex; flex:1 1 300rpx; align-items:center; min-width:0; gap:12rpx; }
.order-icon { display:grid; flex:0 0 auto; place-items:center; width:50rpx; height:50rpx; background:#e7f4eb; border-radius:15rpx; }
.order-no { min-width: 0; color: #69736c; font-size: 22rpx; overflow-wrap: anywhere; }
.title { display: block; margin: 26rpx 0 18rpx; font-size: 31rpx; font-weight: 700; overflow-wrap: anywhere; }
.order-meta .muted { min-width: 0; }
.order-meta .money { flex: 0 0 auto; }
.pending-panel { margin-top: 22rpx; padding-top: 20rpx; border-top: 1rpx solid #edf0ed; }
.payment-window { display:flex; align-items:center; gap:10rpx; margin-bottom:16rpx; color:#7a5a16; font-size:23rpx; font-weight:700; }
.actions { display: flex; justify-content: flex-end; gap: 14rpx; }
.small { flex: 1 1 220rpx; min-width: 0; margin: 0; padding: 14rpx 22rpx; }
.load-error { display: flex; align-items: center; gap: 18rpx; color: var(--color-danger); background: var(--color-danger-soft); }
.load-error text { flex: 1; min-width: 0; line-height: 1.5; overflow-wrap: anywhere; }
.retry { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; min-height: 88rpx; margin: 0; padding: 12rpx 22rpx; line-height: 1.2; font-size: 25rpx; }
.loading-stack { display:grid; gap:14rpx; }
.order-skeleton { min-height:220rpx; }
@media (max-width: 360px) {
  .load-error { align-items: stretch; flex-wrap: wrap; }
  .load-error .retry { width: 100%; }
  .actions { align-items: stretch; flex-wrap:wrap; }
  .actions .small { width: 100%; }
}
</style>
