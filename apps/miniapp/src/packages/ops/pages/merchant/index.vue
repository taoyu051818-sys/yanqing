<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../../../components/OperationsFrame.vue'
import MetricCard from '../../../../components/MetricCard.vue'
import { endpoints } from '../../../../services/api'
import { useSessionStore } from '../../../../stores/session'
import { idempotencyKey } from '../../../../utils/format'

const session = useSessionStore()
const merchants = ref<any[]>([])
const redemptions = ref(0)
const loading = ref(false)
const lastRedeemedCode = ref('')
const roleLabel = computed(() => session.roles.includes('MERCHANT') ? '商户' : '前台代核销')
const pageDescription = computed(() => session.roles.includes('MERCHANT')
  ? '商户只操作本店券码核销和消费归因，平台不替商户收款，也不开放其他商户数据。'
  : '前台可代为完成联盟券核销，核销对象必须匹配商户和券码归属，结果进入结算台账。')

const merchant = computed(() => merchants.value[0])
const metrics = computed(() => [
  ['累计核销', String(redemptions.value), '仅本商户'],
  ['有效券模板', String(merchant.value?._count?.couponTemplates || 0), '当前合作活动'],
  ['核销归因', merchant.value ? '已记录' : '—', '进入结算台账'],
  ['账户隔离', '已启用', '不动用场馆余额'],
])

async function load() {
  await session.hydrate()
  loading.value = true
  try {
    merchants.value = await endpoints.merchants()
    redemptions.value = merchants.value[0]?._count?.couponRedemptions || 0
  } catch (cause: any) { uni.showToast({ title: cause.message || '商户数据加载失败', icon: 'none' }) }
  loading.value = false
}

async function redeem(code?: string) {
  const value = code || (await uni.showModal({ title: '输入券码', editable: true, placeholderText: '扫描结果或券码' })).content
  if (!value?.trim() || !merchant.value) return
  try {
    await endpoints.redeemCoupon({ code: value.trim(), merchantId: merchant.value.id, attributedAmountCents: 0, idempotencyKey: idempotencyKey(`merchant-${value.trim()}`) })
    redemptions.value += 1
    lastRedeemedCode.value = value.trim()
    uni.showToast({ title: '核销成功', icon: 'success' })
  } catch (cause: any) { uni.showToast({ title: cause.message || '券码不可核销', icon: 'none' }) }
}

async function scan() {
  try { const result = await uni.scanCode({ scanType: ['qrCode', 'barCode'] }); await redeem(result.result.split('/').pop() || result.result) }
  catch (cause: any) { uni.showToast({ title: cause.message || '扫码失败', icon: 'none' }) }
}

onShow(load)
</script>

<template>
  <OperationsFrame title="联盟商户" eyebrow="ALLIANCE MERCHANT" :role="roleLabel" :venue="merchant?.name || '商户账户'" :description="pageDescription">
    <view class="metric-grid"><MetricCard v-for="item in metrics" :key="item[0]" :label="item[0]" :value="item[1]" :note="item[2]" /></view>
    <view class="card merchant-card"><text class="merchant-title">{{ merchant?.name || '加载商户中' }}</text><text class="muted">{{ merchant?.category || '联盟合作商户' }} · 结算周期按合同执行</text><view class="merchant-actions"><button class="primary" @tap="scan">扫码核销</button><button class="secondary" @tap="redeem()">手动输入</button></view></view>
    <view v-if="lastRedeemedCode" class="notice card"><text class="notice-title">最近核销</text><text class="muted">券码 {{ lastRedeemedCode }} 已成功核销，已记录消费归因。</text></view>
    <view class="section-title">商户操作边界</view>
    <view class="card boundary"><text class="muted">可见数据仅限当前商户；重复核销、过期券和非本店券码会被拒绝并记录风险事件。周期结算由财务岗位发起、审核和发布。</text></view>
    <view v-if="!loading && !merchant" class="empty card">当前账号没有绑定联盟商户</view>
  </OperationsFrame>
</template>

<style scoped>
.metric-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:22rpx; }.merchant-card { margin-top:22rpx; padding:28rpx; }.merchant-title,.notice-title { display:block; margin-bottom:8rpx; font-size:31rpx; font-weight:800; }.merchant-actions { display:grid; grid-template-columns:1fr 1fr; gap:12rpx; margin-top:24rpx; }.merchant-actions button { margin:0; min-height:76rpx; line-height:76rpx; font-size:24rpx; }.notice { color:#17653d; background:#e8f4eb; }.notice .muted { display:block; line-height:1.6; }.boundary { line-height:1.7; }.empty { color:#758079; text-align:center; }
</style>
