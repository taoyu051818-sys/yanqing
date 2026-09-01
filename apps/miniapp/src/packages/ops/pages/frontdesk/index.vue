<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import StatusBadge from '../../../../components/StatusBadge.vue'
import { hasOperationsAccess } from '../../../../config/operations'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import type { MemberDirectoryItem } from '../../../../types/domain'
import { idempotencyKey, money, today } from '../../../../utils/format'
import { withPendingCreationKey } from '../../../../utils/pending-creation-key'
import {
  findOpsDeepLinkRecord,
  opsDeepLinkDomId,
  parseOpsDeepLinkQuery,
  type OpsDeepLinkQuery,
} from '../../../../utils/work-item-deep-link'

const session = useSessionStore()
const orders = ref<any[]>([])
const members = ref<MemberDirectoryItem[]>([])
const merchants = ref<any[]>([])
const availability = ref<any>(null)
const selectedMemberId = ref('')
const loading = ref(false)
const loadError = ref('')
const shiftLoaded = ref(false)
const ordersLoaded = ref(false)
const membersLoaded = ref(false)
const availabilityLoaded = ref(false)
const shift = ref<any>(null)
const deepLinkQuery = ref<OpsDeepLinkQuery>({})
const deepLinkHandled = ref(false)
const focusedRecord = ref('')
const shiftOpen = computed(() => shift.value?.status === 'OPEN')
const adminEmergencyBypass = computed(() => session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role)))
const onsiteAllowed = computed(() => adminEmergencyBypass.value || (shiftLoaded.value && shiftOpen.value))
const shiftLabel = computed(() => !shiftLoaded.value
  ? '班次状态未同步'
  : shiftOpen.value ? '前台班次已开启'
    : adminEmergencyBypass.value ? '管理员应急旁路 · 自动审计'
      : shift.value?.status === 'CLOSED' ? '今日班次已关班' : '前台班次未开启')

const pendingOrders = computed(() => orders.value.filter((order) =>
  ['PENDING', 'PAID', 'CHECKED_IN', 'REFUNDING', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(order.status),
))
const venueOrders = computed(() => pendingOrders.value.filter((order) => order.businessType === 'VENUE'))
const paidOrders = computed(() => venueOrders.value.filter((order) => order.status === 'PAID'))
const selectedMember = computed(() => members.value.find((member) => member.id === selectedMemberId.value) || null)
const selectedMemberDetail = computed(() => {
  if (!selectedMember.value) return '未选择客户，不能创建现场场地订单'
  return `${selectedMember.value.displayName}${selectedMember.value.phone ? ` · ${selectedMember.value.phone}` : ''}`
})
const memberOptions = computed(() => members.value.map((member) => {
  const level = member.memberProfile?.level || member.level
  const phone = member.phone ? ` · ${String(member.phone).slice(-4)}` : ''
  return `${member.displayName}${phone}${level ? ` · ${level}` : ''}`
}))
const freeCourts = computed(() => {
  if (!availability.value) return 0
  const booked = new Set((availability.value.bookings || []).map((item: any) => item.courtId))
  return (availability.value.courts || []).filter((court: any) => court.enabled && !booked.has(court.id)).length
})
const metrics = computed(() => [
  ['待现场处理', String(venueOrders.value.length), '场地履约队列'],
  ['待签到', String(paidOrders.value.length), '已支付场地单'],
  ['可用场地', String(freeCourts.value), '今日资源'],
  ['会员查询', String(members.value.length), '可服务会员'],
])

async function load() {
  await session.hydrate()
  if (!hasOperationsAccess(session.roles, 'today')) return
  loading.value = true
  loadError.value = ''
  shiftLoaded.value = false
  ordersLoaded.value = false
  membersLoaded.value = false
  availabilityLoaded.value = false
  const result = await Promise.allSettled([
    endpoints.currentFrontDeskShift(), endpoints.adminOrders(), endpoints.members(), endpoints.availability(today()), endpoints.merchants(),
  ])
  const [shiftResult, orderResult, memberResult, availabilityResult, merchantResult] = result
  if (shiftResult.status === 'fulfilled') {
    shift.value = shiftResult.value
    shiftLoaded.value = true
  }
  if (orderResult.status === 'fulfilled') {
    orders.value = orderResult.value?.items || orderResult.value || []
    ordersLoaded.value = true
  }
  if (memberResult.status === 'fulfilled') {
    const directory = memberResult.value?.items || []
    members.value = directory.filter((member: any) => !member.status || member.status === 'ACTIVE')
    membersLoaded.value = true
  }
  if (selectedMemberId.value && !members.value.some((member) => member.id === selectedMemberId.value)) {
    selectedMemberId.value = ''
  }
  if (availabilityResult.status === 'fulfilled') {
    availability.value = availabilityResult.value
    availabilityLoaded.value = true
  }
  if (merchantResult.status === 'fulfilled') merchants.value = merchantResult.value || []
  const failedSources = [
    shiftResult.status === 'rejected' ? '班次状态' : '',
    orderResult.status === 'rejected' ? '订单队列' : '',
    memberResult.status === 'rejected' ? '会员目录' : '',
    availabilityResult.status === 'rejected' ? '场地资源' : '',
    merchantResult.status === 'rejected' ? '联盟商户' : '',
  ].filter(Boolean)
  if (failedSources.length) loadError.value = `${failedSources.join('、')}加载失败；未同步区域不会按“暂无”处理。`
  loading.value = false
  await applyFrontDeskDeepLink()
}

async function applyFrontDeskDeepLink() {
  if (deepLinkHandled.value || !deepLinkQuery.value.focus) return
  deepLinkHandled.value = true
  if (deepLinkQuery.value.focus !== 'order') {
    uni.showToast({ title: `无法识别前台待办类型：${deepLinkQuery.value.focus}`, icon: 'none' })
    return
  }
  const order = findOpsDeepLinkRecord(venueOrders.value, deepLinkQuery.value, ['id', 'orderId'])
  if (!order) {
    uni.showToast({ title: '未找到待办对应的场地订单，可能已履约或无权查看', icon: 'none' })
    return
  }
  focusedRecord.value = `frontdesk-order:${order.id}`
  await nextTick()
  uni.pageScrollTo({ selector: `#${opsDeepLinkDomId('frontdesk-order', order.id)}`, duration: 250 })
}

function selectMember(event: any) {
  const index = Number(event.detail.value)
  selectedMemberId.value = members.value[index]?.id || ''
}

async function openShift() {
  if (shift.value?.status === 'CLOSED') {
    uni.showToast({ title: '今日班次已关班，不能再次开班', icon: 'none' }); return
  }
  const modal = await uni.showModal({
    title: '开启主馆前台班次', content: '', editable: true,
    placeholderText: '输入备用金（元，如 500）', confirmText: '核对开班',
  })
  if (!modal.confirm) return
  const input = modal.content?.trim() || ''
  if (!/^\d+(\.\d{1,2})?$/.test(input)) {
    uni.showToast({ title: '备用金格式不正确', icon: 'none' }); return
  }
  const openingCashCents = Math.round(Number(input) * 100)
  try {
    shift.value = await endpoints.openFrontDeskShift(openingCashCents)
    uni.showToast({ title: '班次已开启并留痕', icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '开班失败', icon: 'none' }) }
}

function ensureShiftOpen() {
  if (onsiteAllowed.value) return true
  uni.showToast({ title: shift.value?.status === 'CLOSED' ? '今日已关班，现场操作已锁定' : '请先开班再处理现场业务', icon: 'none' })
  return false
}

async function closeShift() {
  if (!ensureShiftOpen() || !shift.value) return
  const cash = await uni.showModal({
    title: '关班现金实点', content: '', editable: true,
    placeholderText: '输入抽屉现金实点（元）', confirmText: '下一步',
  })
  if (!cash.confirm) return
  const cashInput = cash.content?.trim() || ''
  if (!/^\d+(\.\d{1,2})?$/.test(cashInput)) {
    uni.showToast({ title: '现金实点格式不正确', icon: 'none' }); return
  }
  const note = await uni.showModal({
    title: '填写交接备注', content: '', editable: true,
    placeholderText: '现金、退款、未签到订单及现场异常', confirmText: '确认关班',
  })
  const handoverNote = note.content?.trim() || ''
  if (!note.confirm || handoverNote.length < 2) return
  try {
    shift.value = await endpoints.closeFrontDeskShift(shift.value.id, {
      closingCashCents: Math.round(Number(cashInput) * 100), handoverNote,
    })
    const pending = shift.value.pendingSnapshot || {}
    await uni.showModal({
      title: '关班完成', showCancel: false,
      content: `账面现金 ${money(shift.value.expectedCashCents)}，差异 ${money(shift.value.cashVarianceCents)}；待处理订单 ${pending.pendingOrders?.count || 0} 笔，待处理退款 ${pending.pendingRefunds?.count || 0} 笔。`,
    })
  } catch (cause: any) { uni.showToast({ title: cause.message || '关班失败', icon: 'none' }) }
}

async function manualOrder() {
  if (!ensureShiftOpen()) return
  const customer = selectedMember.value
  if (!customer) {
    uni.showToast({ title: '请先选择代订会员', icon: 'none' }); return
  }
  if (!availability.value?.courts?.length || !availability.value?.slots?.length) {
    uni.showToast({ title: '暂无可预订资源', icon: 'none' }); return
  }
  let courtResult: UniApp.ShowActionSheetRes
  let slotResult: UniApp.ShowActionSheetRes
  try {
    courtResult = await uni.showActionSheet({ itemList: availability.value.courts.filter((court: any) => court.enabled).slice(0, 8).map((court: any) => court.name) })
    slotResult = await uni.showActionSheet({ itemList: availability.value.slots.slice(0, 8).map((slot: any) => slot.label) })
  } catch { return }
  const court = availability.value.courts.filter((item: any) => item.enabled).slice(0, 8)[courtResult.tapIndex]
  const slot = availability.value.slots.slice(0, 8)[slotResult.tapIndex]
  try {
    const command = {
      memberId: customer.id,
      date: today(),
      courtId: court.id,
      slotId: slot.id,
      sourceChannel: 'STORE_VISIT',
    }
    await withPendingCreationKey('venue.booking.frontdesk', command, (creationIdempotencyKey) =>
      endpoints.createBooking({ ...command, creationIdempotencyKey }),
    )
    uni.showToast({ title: `已为${customer.displayName}建单`, icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '创建失败', icon: 'none' }) }
}

async function checkIn(order: any) {
  if (!ensureShiftOpen()) return
  const booking = venueBooking(order)
  const startsAt = new Date(booking?.startsAt || 0).getTime()
  const earliest = startsAt - 30 * 60_000
  const latest = startsAt + 30 * 60_000
  if (Number.isFinite(startsAt) && Date.now() < earliest) {
    uni.showToast({ title: '未到签到窗口，不能提前签到', icon: 'none' }); return
  }
  let overrideReason: string | undefined
  if (Number.isFinite(startsAt) && Date.now() > latest) {
    if (!session.roles.some((role) => ['ADMIN', 'SUPER_ADMIN'].includes(role))) {
      uni.showToast({ title: '已过签到窗口，请由管理员历史补录', icon: 'none' }); return
    }
    const modal = await uni.showModal({
      title: '历史补录签到', content: '', editable: true,
      placeholderText: '填写迟到补录原因（2-300字）', confirmText: '确认补录',
    })
    overrideReason = modal.content?.trim()
    if (!modal.confirm || !overrideReason || overrideReason.length < 2) return
  }
  try {
    await endpoints.checkInVenueOrder(order.id, overrideReason ? { overrideReason } : {})
    uni.showToast({ title: '已完成签到', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '签到失败', icon: 'none' }) }
}

function venueBooking(order: any) {
  return (order.bookings || [])[0] || null
}

function bookingEnded(order: any) {
  const endsAt = new Date(venueBooking(order)?.endsAt || 0).getTime()
  return Number.isFinite(endsAt) && endsAt <= Date.now()
}

async function fulfill(order: any, outcome: 'COMPLETED' | 'NO_SHOW') {
  if (!ensureShiftOpen()) return
  if (!bookingEnded(order)) {
    uni.showToast({ title: '预约结束后才能确认履约', icon: 'none' }); return
  }
  const isNoShow = outcome === 'NO_SHOW'
  const modal = await uni.showModal({
    title: isNoShow ? '确认会员未到场' : '确认场地使用完成',
    content: '', editable: true,
    placeholderText: isNoShow ? '填写点名与现场核对说明' : '填写巡场与完成说明',
    confirmText: isNoShow ? '标记未到' : '确认完成',
  })
  const reason = modal.content?.trim() || ''
  if (!modal.confirm || reason.length < 2 || reason.length > 300) {
    if (modal.confirm) uni.showToast({ title: '原因需填写2-300个字', icon: 'none' })
    return
  }
  const command = {
    outcome,
    reason,
    evidence: {
      source: isNoShow ? 'FRONT_DESK_ROLL_CALL' : 'COURT_INSPECTION',
      observedAt: new Date().toISOString(),
    },
  }
  try {
    await withPendingCreationKey(`venue.fulfillment.${order.id}.${outcome}`, command, (idempotencyKey) =>
      endpoints.fulfillVenueOrder(order.id, { ...command, idempotencyKey }),
    )
    uni.showToast({ title: isNoShow ? '已标记未到并关单' : '履约完成并关单', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '履约确认失败', icon: 'none' }) }
}

async function collectCash(order: any) {
  if (!ensureShiftOpen()) return
  if (order.status !== 'PENDING') {
    uni.showToast({ title: '订单当前状态不可收款', icon: 'none' }); return
  }
  const confirmed = await uni.showModal({
    title: '确认线下现金收款',
    content: `${order.member?.displayName || '现场会员'} · ${order.orderNo} · 应收 ${money(order.payableCents)}。请先核对实收现金，入账后将归属当前班次。`,
    confirmText: '确认已收现金',
  })
  if (!confirmed.confirm) return
  const command = { orderId: order.id, channel: 'OFFLINE_CASH', amountCents: order.payableCents }
  try {
    await withPendingCreationKey(`frontdesk.cash-payment.${order.id}`, command, (paymentKey) =>
      endpoints.payOrder(order.id, { channel: 'OFFLINE_CASH', idempotencyKey: paymentKey }),
    )
    uni.showToast({ title: '现金已入当前班次', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '现金收款失败', icon: 'none' }) }
}

async function scanCheckIn() {
  if (!ensureShiftOpen()) return
  try {
    const result = await uni.scanCode({ scanType: ['qrCode', 'barCode'] })
    const orderId = result.result.split('/').pop() || result.result
    await endpoints.checkInVenueOrder(orderId)
    uni.showToast({ title: '扫码签到成功', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '扫码未识别', icon: 'none' }) }
}

async function requestRefund(order: any) {
  if (!ensureShiftOpen()) return
  const modal = await uni.showModal({ title: '发起退款申请', content: `订单 ${order.orderNo} 将进入退款审核队列。` })
  if (!modal.confirm) return
  try {
    await endpoints.refundOrder(order.id, {
      amountCents: Math.max(0, Number(order.paidCents || order.payableCents || 0) - Number(order.refundedCents || 0)),
      reason: '前台服务申请退款',
      idempotencyKey: idempotencyKey(`refund-${order.id}`),
    })
    uni.showToast({ title: '已提交退款审核', icon: 'success' })
    await load()
  } catch (cause: any) { uni.showToast({ title: cause.message || '退款申请失败', icon: 'none' }) }
}

async function redeemCoupon() {
  if (!ensureShiftOpen()) return
  try {
    const result = await uni.scanCode({ scanType: ['qrCode', 'barCode'] })
    const code = result.result.split('/').pop() || result.result
    const merchantId = merchants.value[0]?.id
    if (!merchantId) throw new Error('未配置联盟商户')
    await endpoints.redeemCoupon({ code, merchantId, attributedAmountCents: 0, idempotencyKey: idempotencyKey(`venue-coupon-${code}`) })
    uni.showToast({ title: '联盟券已核销', icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '核销失败', icon: 'none' }) }
}

onLoad((options) => {
  deepLinkQuery.value = parseOpsDeepLinkQuery(options)
})
onShow(load)
</script>

<template>
  <OperationsFrame access="today" title="今日营业" eyebrow="TODAY OPERATIONS" role="前台 / 值班" :shift="shiftLabel" description="先开班，再按现场队列处理签到、订单、退款申请和联盟券核销。">
    <view v-if="loadError" class="load-error card"><view><text class="load-error-title">前台数据未完整同步</text><text class="muted">{{ loadError }}</text></view><button class="secondary retry" :disabled="loading" @tap="load">重新加载</button></view>
    <view class="shift card">
      <view>
        <text class="shift-title">营业班次</text>
        <text class="muted">主馆前台 · {{ !shiftLoaded ? '班次状态未同步，现场动作已锁定' : shift ? `备用金 ${money(shift.openingCashCents)} · ${shift.operator?.displayName || session.user?.displayName}` : '现金收款与现场服务' }}</text>
      </view>
      <button v-if="shiftLoaded && !shift" class="primary shift-button" @tap="openShift">开班</button>
      <text v-else-if="shiftLoaded && shiftOpen" class="pill">已开班</text>
      <text v-else-if="shiftLoaded" class="pill closed">已关班</text>
      <text v-else class="pill closed">状态未知</text>
    </view>
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>

    <view class="section-title">现场动作</view>
    <view class="card customer-card">
      <view>
        <text class="order-title">代客订场客户</text>
        <text class="muted">{{ selectedMemberDetail }}</text>
      </view>
      <picker mode="selector" :range="memberOptions" :disabled="!onsiteAllowed || !memberOptions.length" @change="selectMember">
        <view class="customer-picker">{{ selectedMember ? '更换会员' : !membersLoaded ? '目录未同步' : (memberOptions.length ? '选择会员' : '暂无会员') }}</view>
      </picker>
    </view>
    <view class="action-grid">
      <button class="primary" :disabled="!onsiteAllowed" @tap="scanCheckIn">扫码签到</button>
      <button class="secondary" :disabled="!onsiteAllowed || !selectedMember" @tap="manualOrder">为所选会员订场</button>
      <button class="secondary" :disabled="!onsiteAllowed" @tap="redeemCoupon">联盟券核销</button>
    </view>

    <view class="section-title">订单队列 <text class="section-note">{{ loading ? '同步中' : ordersLoaded ? `共 ${pendingOrders.length} 笔` : '未同步' }}</text></view>
    <view v-for="order in venueOrders" :id="opsDeepLinkDomId('frontdesk-order', order.id)" :key="order.id" class="card order-card" :class="{ 'deep-link-target': focusedRecord === `frontdesk-order:${order.id}` }">
      <view class="row"><view><text class="order-title">{{ order.title }}</text><text class="muted">{{ order.orderNo }} · {{ order.member?.displayName || '现场会员' }}</text></view><StatusBadge :value="order.status" /></view>
      <view class="order-footer"><text class="money">{{ money(order.payableCents) }}</text><view class="order-actions"><button v-if="order.status === 'PENDING'" class="primary inline" :disabled="!onsiteAllowed" @tap="collectCash(order)">现金收款</button><button v-if="order.status === 'PAID' && !bookingEnded(order)" class="secondary inline" :disabled="!onsiteAllowed" @tap="checkIn(order)">签到</button><button v-if="order.status !== 'REFUND_PENDING' && venueBooking(order)?.status === 'CHECKED_IN' && bookingEnded(order)" class="primary inline" :disabled="!onsiteAllowed" @tap="fulfill(order, 'COMPLETED')">确认完成</button><button v-if="order.status !== 'REFUND_PENDING' && venueBooking(order)?.status === 'CONFIRMED' && bookingEnded(order)" class="danger inline" :disabled="!onsiteAllowed" @tap="fulfill(order, 'NO_SHOW')">标记未到</button><button v-if="order.status === 'PAID' && !bookingEnded(order)" class="danger inline" :disabled="!onsiteAllowed" @tap="requestRefund(order)">退款申请</button></view></view>
    </view>
    <view v-if="!loading && ordersLoaded && !venueOrders.length" class="empty card">当前没有待处理场地订单</view>

    <view class="section-title">场馆资源</view>
    <view class="card resource-card">
      <view class="row"><text class="order-title">今日可用场地</text><text class="money">{{ availabilityLoaded ? `${freeCourts} / ${availability?.courts?.length || 0}` : '未同步' }}</text></view>
      <text class="muted">资源日历以营业日期为准；培训占场与公众预约分开统计。</text>
    </view>

    <view class="section-title">交接班</view>
    <view class="card handover">
      <text v-if="!shiftLoaded" class="muted">班次状态未同步，交接与现场动作保持锁定；请重新加载后再操作。</text>
      <text v-else-if="!shift" class="muted">尚未开班；开班后，现金实点与待处理事项会在关班时生成服务端审计快照。</text>
      <template v-else-if="shiftOpen">
        <text class="muted">交班前确认现金实点，并备注退款申请、未签到订单和现场异常；关班后现场动作立即锁定。</text>
        <button class="secondary" @tap="closeShift">现金实点并关班</button>
      </template>
      <template v-else>
        <text class="muted">关班人 {{ shift.closedBy?.displayName || '已记录' }} · 账面 {{ money(shift.expectedCashCents) }} · 实点 {{ money(shift.closingCashCents) }} · 差异 {{ money(shift.cashVarianceCents) }}</text>
        <text class="muted">交接：{{ shift.handoverNote }}；待处理订单 {{ shift.pendingSnapshot?.pendingOrders?.count || 0 }} 笔，退款 {{ shift.pendingSnapshot?.pendingRefunds?.count || 0 }} 笔。</text>
      </template>
    </view>
  </OperationsFrame>
</template>

<style scoped>
.shift,.customer-card,.order-card,.resource-card,.handover { margin-top: 22rpx; }.shift { display:flex; align-items:center; justify-content:space-between; gap:20rpx; }.shift > view { min-width:0; flex:1; }.shift-title,.order-title { display:block; margin-bottom:8rpx; font-size:29rpx; font-weight:800; overflow-wrap:anywhere; }.shift-button { min-width: 132rpx; min-height: 64rpx; margin:0; line-height:64rpx; font-size:24rpx; }.pill.closed { color:#6f5142; background:#f3e8df; }.metric-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14rpx; margin-top:20rpx; }.customer-card { display:flex; align-items:center; justify-content:space-between; gap:20rpx; }.customer-card > view:first-child { min-width:0; flex:1; }.customer-card .muted { display:block; overflow-wrap:anywhere; }.customer-picker { min-width:132rpx; max-width:180rpx; padding:16rpx 20rpx; border:1rpx solid #bfd0c4; border-radius:14rpx; color:#17653d; text-align:center; font-size:24rpx; font-weight:700; overflow-wrap:anywhere; }.action-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14rpx; }.action-grid button { min-width:0!important; min-height:78rpx; margin:0; padding:10rpx 12rpx; font-size:24rpx; line-height:1.35; white-space:normal; }.action-grid button:last-child { grid-column:span 2; }.section-note { color:#758079; font-size:22rpx; font-weight:400; }.order-card { padding:24rpx; }.order-card .row > view { flex:1; min-width:0; }.order-card .muted { display:block; overflow-wrap:anywhere; }.order-footer { display:flex; align-items:flex-start; justify-content:space-between; gap:12rpx; margin-top:18rpx; }.order-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10rpx; }.inline { min-width:112rpx; min-height:56rpx; margin:0; padding:8rpx 14rpx; line-height:1.35; font-size:21rpx; white-space:normal; }.empty { color:#758079; text-align:center; }.resource-card .muted,.handover .muted { display:block; margin-top:12rpx; line-height:1.6; overflow-wrap:anywhere; }.handover button { width:100%; margin-top:20rpx; }.load-error { display:flex; align-items:flex-start; justify-content:space-between; gap:14rpx; margin-top:22rpx; color:#8a3636; background:#fff4f2; }.load-error > view { flex:1; min-width:0; }.load-error-title { display:block; margin-bottom:8rpx; font-size:26rpx; font-weight:800; }.load-error .muted { display:block; line-height:1.55; overflow-wrap:anywhere; }.retry { flex:0 0 auto; width:auto; margin:0; padding:0 18rpx; font-size:22rpx; }
.deep-link-target { border-color:#d69a24!important; box-shadow:0 0 0 4rpx rgba(214,154,36,.18); }
@media (max-width:375px) { .load-error,.order-footer { flex-direction:column; }.retry { width:100%; }.order-actions { width:100%; justify-content:flex-start; } }
</style>
