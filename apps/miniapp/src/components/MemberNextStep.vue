<script setup lang="ts">
import { ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from './AppIcon.vue'
import { endpoints } from '../services/api'
import { useSessionStore } from '../stores/session'
import { openMemberPage } from '../utils/member-navigation'
import { shortDate } from '../utils/format'

const session = useSessionStore()
const next = ref<any>(null)
const failed = ref(false)
let generation = 0
async function load() {
  const run = ++generation
  next.value = null
  failed.value = false
  if (!session.isAuthenticated) return
  const results = await Promise.allSettled([
    endpoints.orders({ status: 'PENDING', pageSize: 1 }),
    endpoints.orders({ status: 'PAID', pageSize: 1 }),
  ])
  if (run !== generation || !session.isAuthenticated) return
  failed.value = results.some((item) => item.status === 'rejected')
  next.value = results.flatMap((item) => item.status === 'fulfilled' ? item.value.items : [])[0] || null
}
watch(() => session.isAuthenticated, load)
onShow(load)
</script>

<template>
  <view v-if="session.isAuthenticated && (next || failed)" class="next-step card">
    <template v-if="next">
      <view class="next-heading"><AppIcon :name="next.status === 'PENDING' ? 'clock' : 'booking'" :size="32" /><text>{{ next.status === 'PENDING' ? '你有待付款订单' : '你有待使用订单' }}</text></view>
      <text class="next-title">{{ next.title }}</text>
      <text v-if="next.bookings?.[0]?.startsAt" class="muted">{{ shortDate(next.bookings[0].startsAt) }} · {{ next.bookings[0].court?.name || '查看订单了解安排' }}</text>
      <text v-else class="muted">{{ next.status === 'PENDING' ? '查看订单金额与支付期限' : '查看安排、使用说明与售后' }}</text>
      <button class="secondary" @tap="openMemberPage(`/pages/order/index?id=${encodeURIComponent(next.id)}`)">{{ next.status === 'PENDING' ? next.businessType === 'VENUE' ? '去付款 / 取消' : '查看订单与付款' : '查看订单与安排' }}<AppIcon name="chevron" :size="28" /></button>
    </template>
    <text v-if="failed" class="muted">部分订单暂未同步，不能据此判断没有待办。</text>
    <button v-if="!next && failed" class="secondary" @tap="load">重新同步订单</button>
  </view>
</template>

<style scoped>
.next-step { border-left:6rpx solid var(--color-primary); }
.next-heading { display:flex; align-items:center; gap:12rpx; color:var(--color-primary); font-size:26rpx; font-weight:700; }
.next-title { display:block; margin:16rpx 0 8rpx; font-size:30rpx; font-weight:750; overflow-wrap:anywhere; }
.next-step .muted { display:block; }
.next-step button { width:100%; margin:20rpx 0 0; }
</style>
