<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import type { CourtAvailability } from '../../types/domain'
import { money, today } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import { requestMemberLogin, openMemberPage } from '../../utils/member-navigation'
import { selectableBookingCoupons } from '../../utils/booking-coupons'
import { consumeBookingIntent } from '../../utils/member-navigation'

const session = useSessionStore()
const date = ref(today())
const data = ref<CourtAvailability | null>(null)
const loading = ref(false)
const selected = ref<{ courtId: string; slotId: string } | null>(null)
const couponCode = ref('')
const showCoupon = ref(false)
const coupons = ref<any[]>([])
const couponError = ref('')
const couponLoading = ref(false)
const couponOptions = computed(() => selectableBookingCoupons(coupons.value))
const selectedCoupon = computed(() => couponOptions.value.find(item => item.code === couponCode.value))
async function loadCoupons(requestedId = '') {
  coupons.value = []
  couponError.value = ''
  if (!session.isAuthenticated) { couponCode.value = ''; return }
  couponLoading.value = true
  try {
    coupons.value = await endpoints.myCoupons()
    if (requestedId) couponCode.value = couponOptions.value.find(item => item.id === requestedId)?.code || ''
    if (couponCode.value && !selectedCoupon.value) { couponCode.value = ''; couponError.value = '原优惠券当前不可用，已取消选择。' }
    if (requestedId && !couponCode.value) couponError.value = '这张券当前不可用，请选择其他券或不使用优惠券。'
  } catch { couponCode.value = ''; couponError.value = '券包暂未同步，可重试或不使用优惠券继续预约。' }
  finally { couponLoading.value = false }
}
const error = ref('')

const selectedSlot = computed(() => data.value?.slots.find((slot) => slot.id === selected.value?.slotId))
const selectedCourt = computed(() => data.value?.courts.find((court) => court.id === selected.value?.courtId))

function slotRange(slot: CourtAvailability['slots'][number]) {
  const format = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return `${format(slot.startMinutes)}-${format(slot.endMinutes)}`
}

function slotTimes(slot: CourtAvailability['slots'][number]) {
  const atMinutes = (minutes: number) => {
    return new Date(`${date.value}T00:00:00+08:00`).getTime() + minutes * 60_000
  }
  const start = atMinutes(slot.startMinutes)
  const rawEnd = atMinutes(slot.endMinutes)
  return { start, end: rawEnd <= start ? rawEnd + 86_400_000 : rawEnd }
}

function isBooked(courtId: string, slot: CourtAvailability['slots'][number]) {
  const { start, end } = slotTimes(slot)
  return Boolean(data.value?.bookings.some((booking) => booking.courtId === courtId && new Date(booking.startsAt).getTime() < end && new Date(booking.endsAt).getTime() > start))
}

function isClosed(courtId: string, slot: CourtAvailability['slots'][number]) {
  const { start, end } = slotTimes(slot)
  return Boolean(data.value?.closures.some((closure) =>
    closure.courtId === courtId &&
    closure.status === 'ACTIVE' &&
    new Date(closure.startsAt).getTime() < end &&
    new Date(closure.endsAt).getTime() > start,
  ))
}

function unavailableReason(courtId: string, slot: CourtAvailability['slots'][number]) {
  const court = data.value?.courts.find((item) => item.id === courtId)
  if (!court?.enabled || !slot.enabled) return '不可售'
  if (slotTimes(slot).start <= Date.now()) return '已过时段'
  if (isClosed(courtId, slot)) return '已封场'
  if (isBooked(courtId, slot)) return '已占用'
  if (!slot.price) return '未定价'
  return ''
}

async function load(resetSelection = false) {
  loading.value = true; error.value = ''
  if (resetSelection) selected.value = null
  try {
    data.value = await endpoints.availability(date.value)
    if (selected.value && (!selectedSlot.value || unavailableReason(selected.value.courtId, selectedSlot.value))) {
      selected.value = null
      uni.showToast({ title: '原时段已不可订，请重新选择', icon: 'none' })
    }
  }
  catch (cause: any) { error.value = cause.message }
  finally { loading.value = false }
}

function choose(courtId: string, slot: CourtAvailability['slots'][number]) {
  if (unavailableReason(courtId, slot)) return
  selected.value = { courtId, slotId: slot.id }
}

async function submit() {
  if (loading.value || couponLoading.value) return
  if (!session.isAuthenticated) return requestMemberLogin('/pages/booking/index')
  if (!selected.value) return
  loading.value = true
  try {
    const command = {
      date: date.value,
      ...selected.value,
      sourceChannel: 'MINI_PROGRAM',
      couponCode: couponCode.value || undefined,
    }
    const order: any = await withPendingCreationKey('venue.booking.member', command, (creationIdempotencyKey) =>
      endpoints.createBooking({ ...command, creationIdempotencyKey }),
    )
    uni.showToast({ title: '已锁定10分钟', icon: 'success' })
    openMemberPage(`/pages/order/index${order?.id ? `?id=${encodeURIComponent(order.id)}` : ''}`)
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }); await load() }
  finally { loading.value = false }
}

onShow(() => { const intent = consumeBookingIntent(); if (intent?.couponId) showCoupon.value = true; void load(); void loadCoupons(intent?.couponId) })
</script>

<template>
  <view class="page safe-bottom">
    <view class="notice"><AppIcon name="clock" :size="30" tone="accent" /><text>每格 1 小时，显示该小时费用。下单后保留 10 分钟，未付款自动取消并释放场地。</text></view>
    <view class="card row">
      <view class="date-label"><AppIcon name="booking" :size="32" /><text>预订日期</text></view>
      <picker mode="date" :value="date" :start="today()" @change="date = ($event.detail as any).value; load(true)">
        <view class="date"><text>{{ date }}</text><AppIcon name="chevron" :size="26" /></view>
      </picker>
    </view>
    <view v-if="error" class="card error"><AppIcon name="warning" :size="32" tone="danger" /><text>{{ error }}</text><button class="secondary" @tap="load()">重试</button></view>
    <view v-if="loading && !data" class="matrix-skeleton skeleton" />
    <view v-if="data?.courts.length" class="matrix-hint"><AppIcon name="info" :size="24" tone="muted" /><text>左右滑动查看全部场地</text></view>
    <scroll-view v-if="data?.courts.length" scroll-x class="matrix-wrap">
      <view class="matrix" :style="{ width: `${180 + data.courts.length * 150}rpx`, gridTemplateColumns: `180rpx repeat(${data.courts.length}, 150rpx)` }">
        <view class="head cell">时段</view>
        <view v-for="court in data.courts" :key="court.id" class="head cell">{{ court.name }}</view>
        <template v-for="slot in data.slots" :key="slot.id">
          <view class="slot-label cell"><text>{{ slotRange(slot) }}</text><text class="muted">1 小时</text></view>
          <view
            v-for="court in data.courts" :key="`${slot.id}-${court.id}`" class="cell court"
            :class="{ disabled: Boolean(unavailableReason(court.id, slot)), selected: selected?.courtId === court.id && selected?.slotId === slot.id }"
            :role="unavailableReason(court.id, slot) ? undefined : 'button'"
            :aria-label="`${court.name}，${slot.label}，${unavailableReason(court.id, slot) || money(slot.price?.priceCents)}`"
            :aria-disabled="Boolean(unavailableReason(court.id, slot))"
            :aria-pressed="selected?.courtId === court.id && selected?.slotId === slot.id"
            :tabindex="unavailableReason(court.id, slot) ? -1 : 0"
            @tap="choose(court.id, slot)"
            @keyup.enter="choose(court.id, slot)"
          >
            <text>{{ unavailableReason(court.id, slot) || money(slot.price?.priceCents) }}</text>
            <text v-if="selected?.courtId === court.id && selected?.slotId === slot.id">已选</text>
          </view>
        </template>
      </view>
    </scroll-view>
    <SectionEmpty v-else-if="!loading && !error" icon="venue" title="暂无可订时段" description="请切换日期或联系前台" />

    <view v-if="selected" class="confirm card">
      <view class="row"><text class="confirm-title">{{ selectedCourt?.name }} · {{ selectedSlot?.label }}</text><text class="money">{{ money(selectedSlot?.price?.priceCents) }}</text></view>
      <text class="muted">{{ date }} · {{ selectedSlot ? slotRange(selectedSlot) : '' }} · 共 1 小时</text>
      <button class="coupon-toggle" :aria-expanded="showCoupon" @tap="showCoupon = !showCoupon">{{ selectedCoupon ? `已选：${selectedCoupon.template?.benefitDescription || '优惠券'}` : '从我的券包选择（可选）' }}</button>
      <view v-if="showCoupon" class="coupon-picker">
        <text v-if="!session.isAuthenticated" class="muted">登录后可直接选择已有优惠券，无需填写券码。</text>
        <text v-if="couponLoading" class="muted">正在同步券包…</text>
        <view v-if="couponError" role="alert"><text class="muted">{{ couponError }}</text><button class="secondary" :disabled="couponLoading" @tap="loadCoupons()">重新同步券包</button></view>
        <button class="secondary" :aria-pressed="!couponCode" :disabled="loading" @tap="couponCode = ''">{{ !couponCode ? '已选 · ' : '' }}不使用优惠券</button>
        <button v-for="coupon in couponOptions" :key="coupon.id" class="secondary" :aria-pressed="couponCode === coupon.code" :disabled="loading" @tap="couponCode = coupon.code"><text>{{ couponCode === coupon.code ? '已选 · ' : '' }}{{ coupon.template.benefitDescription || coupon.template.name }} · {{ money(coupon.template.faceValueCents) }}</text></button>
        <text v-if="session.isAuthenticated && !couponLoading && !couponOptions.length && !couponError" class="muted">暂无可选优惠券，可以直接预约。</text>
        <text class="muted">部分券限指定时段；是否适用及最终金额由下单时核验。</text>
      </view>
      <button class="primary" :loading="loading" :disabled="loading || couponLoading || Boolean(error)" @tap="submit"><AppIcon name="success" :size="30" tone="inverse" />{{ session.isAuthenticated ? '确认预约，下一步付款' : '登录后继续预约' }}</button>
    </view>
  </view>
</template>

<style scoped>
.notice { display:flex; align-items:center; gap:12rpx; padding: 18rpx 24rpx; margin-bottom: 20rpx; color: #7b5910; background: #fff3d9; border-radius: 18rpx; font-size: 23rpx; }
.notice text { flex:1; min-width:0; line-height:1.5; overflow-wrap:anywhere; }
.date-label,.date { display:flex; align-items:center; gap:10rpx; }
.date-label { font-weight:700; }
.date { color: #17653d; font-weight: 700; }
.matrix-skeleton { width:100%; min-height:460rpx; border-radius:24rpx; }
.matrix-hint { display:flex; align-items:center; justify-content:flex-end; gap:8rpx; margin:-2rpx 2rpx 12rpx; color:#68756d; font-size:21rpx; }
.matrix-wrap { width: 100%; padding-bottom: 20rpx; }
.matrix { display: grid; overflow: hidden; background: #fff; border-radius: 24rpx; }
.cell { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 104rpx; padding: 8rpx; border-right: 1rpx solid #edf0ed; border-bottom: 1rpx solid #edf0ed; box-sizing: border-box; font-size: 22rpx; line-height:1.5; }
.head { position: sticky; top: 0; color: #fff; background: #1b5c39; font-weight: 700; }
.slot-label { padding: 8rpx; font-weight: 700; }
.court { color: #17653d; background: #f1f8f3; }
.court.disabled { color: #9ca49f; background: #f2f3f2; }
.court.selected { color: #fff; background: #17653d; box-shadow: inset 0 0 0 4rpx #c9ac54; }
.confirm { margin-top: 24rpx; box-shadow: 0 16rpx 60rpx rgba(17,62,37,.18); }
.confirm-title { min-width: 0; font-weight: 700; overflow-wrap: anywhere; }
.coupon-picker { display:grid; gap:16rpx; margin:20rpx 0; max-height:440rpx; overflow-y:auto; }.coupon-picker button { margin:0; padding:16rpx; font-size:25rpx; }.coupon-picker button[aria-pressed="true"] { outline:2rpx solid var(--color-primary); }.coupon-picker .muted { line-height:1.6; }
.coupon-toggle { width:100%; margin:10rpx 0; padding:12rpx; font-size:24rpx; color:var(--color-muted); background:transparent; }
.error { display:flex; align-items:center; gap:12rpx; color: #ae2f2f; background:#fff0ef; }
.error text { flex:1; min-width:0; overflow-wrap:anywhere; }
</style>
