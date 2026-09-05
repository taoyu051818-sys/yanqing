<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { shortDate } from '../../utils/format'
import { accountAmount, accountLabels, relevantAccounts, walletGroup } from '../../utils/member-wallet'
import { openMemberPage, requestMemberLogin } from '../../utils/member-navigation'
const session = useSessionStore()
const transactions = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const showAll = ref(false)
const showRules = ref(false)
const selectedType = ref('')
const accounts = computed(() => relevantAccounts(session.user?.accounts || [], transactions.value, showAll.value))
const groups = computed(() => ['场馆余额', '奖励权益', '运动记录'].map((title) => ({ title, accounts: accounts.value.filter((account) => walletGroup(account.type) === title) })).filter((group) => group.accounts.length))
const recordTypes = computed(() => (session.user?.accounts || []).map((account) => ({ type: account.type, label: accountLabels[account.type] || '其他权益' })))
const visibleTransactions = computed(() => transactions.value.filter((item) => !selectedType.value || item.account?.type === selectedType.value))
function filterRecords(event: any) { selectedType.value = recordTypes.value[Number(event.detail.value) - 1]?.type || '' }
async function load() {
  if (!session.isAuthenticated) return requestMemberLogin('/pages/wallet/index')
  loading.value = true
  error.value = ''
  try {
    const refreshed = await session.hydrate()
    if (!refreshed) throw new Error('余额暂未同步，请重试；这不代表余额为零。')
    transactions.value = await endpoints.accountTransactions()
  } catch (cause: any) { error.value = cause?.message || '钱包暂未同步，请稍后重试' }
  finally { loading.value = false }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view v-if="error" class="card load-error"><text>{{ error }}</text><button class="secondary" @tap="load">重试</button></view>
    <view v-if="loading" class="muted">正在同步余额与记录…</view>
    <view v-for="group in groups" :key="group.title">
      <text class="section-title">{{ group.title }}</text>
      <view class="card wallet-group">
        <view v-for="account in group.accounts" :key="account.id" class="balance-row"><view><text class="account-label">{{ accountLabels[account.type] || '其他权益' }}</text><text v-if="account.frozenBalance" class="muted">其中暂不可用 {{ accountAmount(account.type, account.frozenBalance) }}</text></view><text class="balance">{{ accountAmount(account.type, account.balance) }}</text></view>
      </view>
    </view>
    <view class="wallet-actions"><button class="secondary" @tap="openMemberPage('/pages/membership/index')">充值与会员</button><button class="secondary" @tap="openMemberPage('/pages/coupon/index')">我的卡券</button></view>
    <view class="disclosures"><button @tap="showAll = !showAll">{{ showAll ? '收起未使用权益' : '查看全部权益' }}</button><button @tap="showRules = !showRules">{{ showRules ? '收起说明' : '余额使用说明' }}</button></view>
    <view v-if="showRules" class="card rules">充值余额与赠送余额分别记录，适用范围以支付页为准。羽毛球币和积分不是现金，不与余额合计。退款与暂不可用金额可在相关订单中查看。</view>
    <text class="section-title">收支与变动记录</text>
    <picker :range="['全部记录', ...recordTypes.map(item => item.label)]" @change="filterRecords"><view class="record-filter">{{ accountLabels[selectedType] || '全部记录' }} · 点击筛选</view></picker>
    <view v-for="item in visibleTransactions" :key="item.id" class="transaction card"><view><text class="reason">{{ item.reason || '账户变动' }}</text><text class="muted">{{ accountLabels[item.account?.type] || '权益记录' }} · {{ shortDate(item.createdAt) }}</text></view><text class="amount">{{ item.amount >= 0 ? '+' : '' }}{{ accountAmount(item.account?.type, item.amount) }}</text></view>
    <SectionEmpty v-if="!visibleTransactions.length && !loading && !error" title="暂无变动记录" description="充值、消费或获得奖励后，可以在这里查看明细。" />
  </view>
</template>
<style scoped>
.wallet-group { padding:4rpx 26rpx; }
.balance-row { display:flex; align-items:center; justify-content:space-between; gap:20rpx; padding:26rpx 0; border-bottom:1rpx solid var(--color-border); }
.balance-row:last-child { border:0; }
.balance-row>view { flex:1; min-width:0; }
.account-label { display:block; font-size:28rpx; }
.balance-row .muted { display:block; margin-top:8rpx; font-size:23rpx; }
.balance { font-size:34rpx; font-weight:800; color:var(--color-primary-strong); overflow-wrap:anywhere; }
.wallet-actions,.disclosures { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14rpx; }
.wallet-actions button,.disclosures button { width:100%; margin:0; font-size:26rpx; }
.disclosures { margin-top:18rpx; }
.disclosures button { color:var(--color-muted); background:transparent; font-size:24rpx; }
.rules { font-size:25rpx; line-height:1.7; color:var(--color-muted); }
.record-filter { padding:20rpx; margin-bottom:20rpx; background:var(--color-surface); border-radius:16rpx; font-size:25rpx; }
.transaction { display:flex; align-items:flex-start; justify-content:space-between; gap:18rpx; }
.transaction>view { flex:1; min-width:0; }
.reason { display:block; margin-bottom:8rpx; font-size:27rpx; overflow-wrap:anywhere; }
.amount { max-width:42%; font-size:28rpx; font-weight:700; overflow-wrap:anywhere; }
.load-error { display:grid; gap:16rpx; color:var(--color-danger); }
</style>
