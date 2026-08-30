<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import type { CourtAvailability } from '../../types/domain'
import { money, today } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const session = useSessionStore()
const date = ref(today())
const data = ref<CourtAvailability | null>(null)
const loading = ref(false)
const selected = ref<{ courtId: string; slotId: string } | null>(null)
const couponCode = ref('')
const error = ref('')

const selectedSlot = computed(() => data.value?.slots.find((slot) => slot.id === selected.value?.slotId))
const selectedCourt = computed(() => data.value?.courts.find((court) => court.id === selected.value?.courtId))

function slotRange(slot: CourtAvailability['slots'][number]) {
  const format = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  return `${format(slot.startMinutes)}-${format(slot.endMinutes)}`
}

function isBooked(courtId: string, slot: CourtAvailability['slots'][number]) {
  const start = new Date(`${date.value}T${String(Math.floor(slot.startMinutes / 60)).padStart(2, '0')}:${String(slot.startMinutes % 60).padStart(2, '0')}:00+08:00`).getTime()
  const end = new Date(`${date.value}T${String(Math.floor(slot.endMinutes / 60)).padStart(2, '0')}:${String(slot.endMinutes % 60).padStart(2, '0')}:00+08:00`).getTime()
  return Boolean(data.value?.bookings.some((booking) => booking.courtId === courtId && new Date(booking.startsAt).getTime() < end && new Date(booking.endsAt).getTime() > start))
}

async function load() {
  loading.value = true; error.value = ''; selected.value = null
  try { data.value = await endpoints.availability(date.value) }
  catch (cause: any) { error.value = cause.message }
  finally { loading.value = false }
}

function choose(courtId: string, slot: CourtAvailability['slots'][number]) {
  if (isBooked(courtId, slot) || !slot.price) return
  selected.value = { courtId, slotId: slot.id }
}

async function submit() {
  if (!session.isAuthenticated) return uni.navigateTo({ url: '/pages/login/index' })
  if (!selected.value) return
  loading.value = true
  try {
    const command = {
      date: date.value,
      ...selected.value,
      sourceChannel: 'MINI_PROGRAM',
      couponCode: couponCode.value || undefined,
    }
    await withPendingCreationKey('venue.booking.member', command, (creationIdempotencyKey) =>
      endpoints.createBooking({ ...command, creationIdempotencyKey }),
    )
    uni.showToast({ title: '已锁定10分钟', icon: 'success' })
    setTimeout(() => uni.navigateTo({ url: '/pages/order/index' }), 500)
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }); await load() }
  finally { loading.value = false }
}

onShow(load)
</script>

<template>
  <view class="page safe-bottom">
    <view class="notice">场地订单创建后保留 10 分钟，请及时完成支付。</view>
    <view class="card row">
      <text>预订日期</text>
      <picker mode="date" :value="date" :start="today()" @change="date = ($event.detail as any).value; load()">
        <text class="date">{{ date }}　›</text>
      </picker>
    </view>
    <view v-if="error" class="card error">{{ error }}</view>
    <scroll-view v-if="data?.courts.length" scroll-x class="matrix-wrap">
      <view class="matrix" :style="{ width: `${180 + data.courts.length * 150}rpx` }">
        <view class="head cell">时段</view>
        <view v-for="court in data.courts" :key="court.id" class="head cell">{{ court.name }}</view>
        <template v-for="slot in data.slots" :key="slot.id">
          <view class="slot-label cell"><text>{{ slot.label }}</text><text class="muted">{{ slotRange(slot) }}</text></view>
          <view
            v-for="court in data.courts" :key="`${slot.id}-${court.id}`" class="cell court"
            :class="{ disabled: isBooked(court.id, slot) || !slot.price, selected: selected?.courtId === court.id && selected?.slotId === slot.id }"
            @tap="choose(court.id, slot)"
          >
            <text>{{ isBooked(court.id, slot) ? '已占用' : slot.price ? money(slot.price.priceCents) : '未定价' }}</text>
          </view>
        </template>
      </view>
    </scroll-view>
    <SectionEmpty v-else-if="!loading" title="暂无可订时段" description="请切换日期或联系前台" />

    <view v-if="selected" class="confirm card">
      <view class="row"><text class="confirm-title">{{ selectedCourt?.name }} · {{ selectedSlot?.label }}</text><text class="money">{{ money(selectedSlot?.price?.priceCents) }}</text></view>
      <input v-model="couponCode" class="input coupon-input" placeholder="联盟券码（可选）" />
      <button class="primary" :loading="loading" @tap="submit">锁定场地并创建订单</button>
    </view>
  </view>
</template>

<style scoped>
.notice { padding: 18rpx 24rpx; margin-bottom: 20rpx; color: #7b5910; background: #fff3d9; border-radius: 18rpx; font-size: 23rpx; }
.date { color: #17653d; font-weight: 700; }
.matrix-wrap { width: 100%; padding-bottom: 20rpx; }
.matrix { display: grid; grid-template-columns: 180rpx repeat(20,150rpx); overflow: hidden; background: #fff; border-radius: 24rpx; }
.cell { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90rpx; padding: 8rpx; border-right: 1rpx solid #edf0ed; border-bottom: 1rpx solid #edf0ed; box-sizing: border-box; font-size: 22rpx; }
.head { position: sticky; top: 0; color: #fff; background: #1b5c39; font-weight: 700; }
.slot-label { align-items: flex-start; padding-left: 20rpx; font-weight: 700; }
.court { color: #17653d; background: #f1f8f3; }
.court.disabled { color: #9ca49f; background: #f2f3f2; }
.court.selected { color: #fff; background: #17653d; box-shadow: inset 0 0 0 4rpx #c9ac54; }
.confirm { position: sticky; bottom: 18rpx; margin-top: 24rpx; box-shadow: 0 16rpx 60rpx rgba(17,62,37,.18); }
.confirm-title { font-weight: 700; }
.coupon-input { margin: 22rpx 0; }
.error { color: #ae2f2f; }
</style>
