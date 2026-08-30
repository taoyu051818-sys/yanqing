<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { money, shortDate } from '../../utils/format'

const session = useSessionStore()
const transactions = ref<any[]>([])
const labels: Record<string, string> = { CASH_PRINCIPAL: '现金本金', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币', EVENT_POINTS: '成人赛事积分', GROWTH_POINTS: '青少年成长积分', YOUTH_GROWTH_POINTS: '青少年成长积分' }
const grouped = computed(() => session.user?.accounts || [])
onShow(async () => {
  await session.hydrate()
  try { transactions.value = await endpoints.accountTransactions() }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
})
</script>
<template>
  <view class="page safe-bottom">
    <view class="tip">五类账户严格隔离，不相互冲抵；联盟商户不可使用场馆余额收款。</view>
    <view class="grid-2">
      <view v-for="account in grouped" :key="account.id" class="wallet-card">
        <text class="muted">{{ labels[account.type] }}</text>
        <text class="balance">{{ ['CASH_PRINCIPAL','GIFT_BALANCE'].includes(account.type) ? money(account.balance) : account.balance }}</text>
        <text class="frozen">冻结 {{ account.frozenBalance }}</text>
      </view>
    </view>
    <view class="section-title">最近明细</view>
    <view v-for="item in transactions" :key="item.id" class="transaction card row">
      <view><text class="reason">{{ item.reason }}</text><text class="muted">{{ labels[item.account?.type] }} · {{ shortDate(item.createdAt) }}</text></view>
      <text :class="item.amount >= 0 ? 'credit' : 'debit'">{{ item.amount >= 0 ? '+' : '' }}{{ item.amount }}</text>
    </view>
    <SectionEmpty v-if="!transactions.length" title="暂无账户流水" />
  </view>
</template>
<style scoped>
.tip { padding: 22rpx; margin-bottom: 22rpx; color: #795a16; background: #fff4da; border-radius: 20rpx; font-size: 23rpx; line-height: 1.6; }
.wallet-card { padding: 28rpx; background: #fff; border-radius: 24rpx; }
.balance { display: block; margin: 18rpx 0 8rpx; color: #17492f; font-size: 38rpx; font-weight: 800; }
.frozen { color: #a0a6a1; font-size: 20rpx; }
.reason { display: block; margin-bottom: 8rpx; font-weight: 700; }
.credit { color: #17653d; font-weight: 800; }.debit { color: #2f3431; font-weight: 800; }
</style>
