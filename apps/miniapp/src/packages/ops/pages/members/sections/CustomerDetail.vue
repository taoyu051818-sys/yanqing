<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Member360View } from '../../../../../types/domain'
import BusinessSection from '../../../components/BusinessSection.vue'
import InfoRow from '../../../components/InfoRow.vue'
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
const levels: Record<string,string> = { EXPERIENCE:'体验会员', REGULAR:'普通会员', GOLD:'金卡会员', BLACK:'黑金会员' }
</script>
<template>
  <view class="customer-detail">
    <view class="detail-tabs"><button v-for="tab in tabs" :key="tab.key" :class="{ active: active === tab.key }" @tap="active = tab.key">{{ tab.label }}</button></view>
    <template v-if="active === 'overview'">
      <BusinessSection title="基本资料"><InfoRow label="会员姓名" :value="customer.member.displayName" /><InfoRow label="会员等级" :value="levels[customer.member.level || customer.member.memberProfile?.level || ''] || '未设置'" /><InfoRow label="联系电话" :value="customer.member.phone || (customer.financialsRedacted ? '按岗位隐藏' : '未填写')" /><InfoRow v-if="customer.member.status" label="账号状态"><StatusBadge :value="customer.member.status" /></InfoRow></BusinessSection>
      <BusinessSection title="近期记录"><InfoRow v-if="!coach" label="订单" :value="`${customer.recentOrders.length}笔`" link @select="active = 'orders'" /><InfoRow label="培训" :value="`${customer.recentTraining.length}项`" link @select="active = 'activity'" /><InfoRow v-if="!coach" label="球局与赛事" :value="`${customer.recentGames.length + customer.recentEvents.length}次`" link @select="active = 'activity'" /></BusinessSection>
      <text class="scope-note">{{ coach ? '仅展示与你任教班级相关的培训信息。' : customer.financialsRedacted ? '联系方式及财务信息按岗位脱敏。' : '记录数量为本次返回的近期记录，不代表历史总量。' }}</text>
    </template>
    <BusinessSection v-else-if="active === 'orders' && !coach" title="近期订单">
      <view v-if="!customer.recentOrders.length" class="empty">暂无可查看的近期订单</view>
      <view v-for="order in customer.recentOrders" :key="order.id" class="record"><view class="row"><text class="heading">{{ order.title || '订单' }}</text><StatusBadge :value="order.status" /></view><text class="muted">{{ order.orderNo }}</text><view class="row"><text class="muted">{{ shortDate(order.createdAt) }}</text><text v-if="!customer.financialsRedacted && order.payableCents != null">{{ money(order.payableCents) }}</text></view></view>
    </BusinessSection>
    <template v-else-if="active === 'accounts' && !coach">
      <BusinessSection v-if="customer.paymentSummary" title="可用额度"><InfoRow label="储值可支付" :value="money(customer.paymentSummary.storedValueAvailableCents)" /><InfoRow label="可用羽毛球币" :value="customer.paymentSummary.badmintonCoinAvailable" /></BusinessSection>
      <BusinessSection title="账户明细"><InfoRow v-for="account in customer.accounts" :key="account.id" :label="labels[account.type] || '其他账户'" :value="balance(account)" /><view v-if="!customer.accounts.length" class="empty">{{ customer.financialsRedacted ? '当前岗位不展示账户明细' : '暂无账户' }}</view></BusinessSection>
      <view v-if="canAdjust && customer.accounts.length" class="action-space"><view class="detail-footer"><button class="primary" @tap="$emit('adjust')">申请账户调整</button></view></view>
    </template>
    <template v-else-if="active === 'activity'">
      <BusinessSection v-for="group in groups" :key="group.title" :title="group.title"><view v-if="!group.items.length" class="empty">暂无可查看的近期记录</view><view v-for="item in group.items" :key="item.id" class="record"><view class="row"><text class="heading">{{ title(item) }}</text><StatusBadge v-if="item.status" :value="item.status" /></view><text v-if="item.class?.name" class="muted">{{ item.class.name }}</text><text v-if="item.totalSessions != null">已用 {{ item.consumedSessions || 0 }} / {{ item.totalSessions }} 课时</text></view></BusinessSection>
    </template>
  </view>
</template>
<style scoped>
.detail-tabs { display:flex; position:sticky; top:0; z-index:5; background:#fff; padding:0 12rpx; border-radius:16rpx; margin:8rpx 0; }
.detail-tabs button { flex:1; margin:0; padding:20rpx 4rpx; min-height:96rpx; line-height:1.5; font-size:28rpx; display:flex; align-items:center; justify-content:center; color:#687079; background:transparent; border-radius:0; border-bottom:4rpx solid transparent; }
.detail-tabs button::after { border:0; }
.detail-tabs .active { color:#17653d; border-bottom-color:#17653d; font-weight:600; }
.record { display:grid; gap:16rpx; padding:28rpx 24rpx; border-bottom:1rpx solid #edf0f2; font-size:28rpx; }.record:last-child { border:0; }
.heading { font-size:30rpx; font-weight:600; color:#20252b; }
.row { display:flex; align-items:center; justify-content:space-between; gap:16rpx; }
.row>.heading { flex:1; overflow-wrap:anywhere; }
.muted { line-height:1.6; color:#727982; font-size:25rpx; overflow-wrap:anywhere; }
.empty { padding:30rpx 24rpx; color:#727982; font-size:27rpx; }
.scope-note { display:block; color:#727982; font-size:24rpx; line-height:1.7; padding:0 20rpx; }
.action-space { height:calc(140rpx + env(safe-area-inset-bottom)); }
.detail-footer { position:fixed; bottom:0; left:0; right:0; z-index:30; padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #e9ecef; }
.detail-footer button { margin:0; width:100%; min-height:88rpx; font-size:28rpx; }
</style>
