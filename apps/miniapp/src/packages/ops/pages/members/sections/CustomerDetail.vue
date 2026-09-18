<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Member360View } from '../../../../../types/domain'
import StatusBadge from '../../../../../components/StatusBadge.vue'
import { money, shortDate } from '../../../../../utils/format'
const props = defineProps<{ customer: Member360View; canAdjust: boolean }>()
defineEmits<{ adjust: [] }>()
const active = ref('overview')
const coach = computed(() => props.customer.privacyScope === 'COACH_ASSIGNED')
const tabs = computed(() => [
  { key: 'overview', label: '概览' },
  ...(!coach.value ? [{ key: 'orders', label: '订单' }, { key: 'accounts', label: '账户' }] : []),
  { key: 'activity', label: coach.value ? '培训' : '参与记录' },
])
const groups = computed(() => [
  { title: '培训', items: props.customer.recentTraining },
  ...(!coach.value ? [
    { title: '球局', items: props.customer.recentGames },
    { title: '赛事', items: props.customer.recentEvents },
    { title: '优惠券', items: props.customer.recentCoupons },
  ] : []),
])
const labels: Record<string, string> = { CASH_PRINCIPAL: '现金本金', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币', EVENT_POINTS: '赛事积分', GROWTH_POINTS: '成长积分', YOUTH_GROWTH_POINTS: '青少年成长积分' }
const balance = (account: any) => ['CASH_PRINCIPAL', 'GIFT_BALANCE'].includes(account.type) ? money(account.balance) : String(account.balance ?? 0)
const title = (item: any) => item.product?.name || item.game?.title || item.game?.name || item.event?.title || item.event?.name || item.template?.name || item.name || '参与记录'
</script>
<template>
  <view class="customer-detail">
    <view class="card identity"><text class="name">{{ customer.member.displayName || '会员' }}</text><text class="muted">{{ customer.member.phone || '联系方式按岗位隐藏' }}</text></view>
    <view class="detail-tabs"><button v-for="tab in tabs" :key="tab.key" :class="{ active: active === tab.key }" @tap="active = tab.key">{{ tab.label }}</button></view>
    <view v-if="active === 'overview'" class="card overview">
      <text class="heading">客户概览</text>
      <text v-if="!coach">近期订单 {{ customer.recentOrders.length }} 笔</text>
      <text>近期培训 {{ customer.recentTraining.length }} 项</text>
      <text v-if="!coach">球局 {{ customer.recentGames.length }} 次 · 赛事 {{ customer.recentEvents.length }} 次</text>
      <text class="muted">以上为已返回的近期记录，不代表历史总量。点击上方分类查看。</text>
      <text v-if="coach" class="muted">仅展示与你任教班级相关的培训信息。</text>
      <text v-else-if="customer.financialsRedacted" class="muted">联系方式及财务信息按岗位脱敏。</text>
    </view>
    <template v-else-if="active === 'orders' && !coach">
      <view v-if="!customer.recentOrders.length" class="card muted">暂无可查看的近期订单</view>
      <view v-for="order in customer.recentOrders" :key="order.id" class="card record"><view class="row"><text class="heading">{{ order.title || '订单' }}</text><StatusBadge :value="order.status" /></view><text class="muted">{{ order.orderNo }} · {{ shortDate(order.createdAt) }}</text><text v-if="!customer.financialsRedacted && order.payableCents != null">应付 {{ money(order.payableCents) }}</text></view>
    </template>
    <template v-else-if="active === 'accounts' && !coach">
      <view v-if="customer.paymentSummary" class="card overview"><text>储值可支付 {{ money(customer.paymentSummary.storedValueAvailableCents) }}</text><text>可用羽毛球币 {{ customer.paymentSummary.badmintonCoinAvailable }}</text></view>
      <view v-for="account in customer.accounts" :key="account.id" class="card row"><text>{{ labels[account.type] || '其他账户' }}</text><text class="heading">{{ balance(account) }}</text></view>
      <view v-if="!customer.accounts.length" class="card muted">{{ customer.financialsRedacted ? '当前岗位不展示账户明细' : '暂无账户' }}</view>
      <view v-if="canAdjust && customer.accounts.length" class="action-space"><view class="detail-footer"><button class="primary" @tap="$emit('adjust')">申请账户调整</button></view></view>
    </template>
    <template v-else-if="active === 'activity'">
      <view v-for="group in groups" :key="group.title"><text class="section-title">{{ group.title }}</text><view v-if="!group.items.length" class="card muted">暂无可查看的近期记录</view><view v-for="item in group.items" :key="item.id" class="card record"><view class="row"><text class="heading">{{ title(item) }}</text><StatusBadge v-if="item.status" :value="item.status" /></view><text v-if="item.class?.name" class="muted">{{ item.class.name }}</text><text v-if="item.totalSessions != null">已用 {{ item.consumedSessions || 0 }} / {{ item.totalSessions }} 课时</text></view></view>
    </template>
  </view>
</template>
<style scoped>
.identity,.overview,.record { display:grid; gap:16rpx; }
.identity { margin-top:20rpx; }
.name { font-size:34rpx; font-weight:750; color:#173e29; }
.heading { font-size:28rpx; font-weight:650; }
.detail-tabs { display:flex; gap:8rpx; position:sticky; top:0; z-index:5; background:#f3f6f2; padding:16rpx 0; }
.detail-tabs button { flex:1; margin:0; padding:12rpx 4rpx; min-height:88rpx; line-height:1.5; font-size:26rpx; display:flex; align-items:center; justify-content:center; background:#fff; border-radius:16rpx; }
.detail-tabs button::after { border:0; }
.detail-tabs .active { color:#fff; background:#17653d; }
.row { display:flex; align-items:center; justify-content:space-between; gap:16rpx; }
.row>.heading { flex:1; overflow-wrap:anywhere; }
.muted { line-height:1.6; }
.action-space { height:calc(140rpx + env(safe-area-inset-bottom)); }
.detail-footer { position:fixed; bottom:0; left:0; right:0; z-index:30; padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #dce7de; }
.detail-footer button { margin:0; width:100%; min-height:88rpx; }
</style>
