<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { idempotencyKey, money, shortDate } from '../../utils/format'

const session = useSessionStore()
const coupons = ref<any[]>([])
const merchants = ref<any[]>([])
const claimCode = ref('')
const redeemCode = ref('')
const selectedMerchantId = ref('')
const loading = ref(false)
const error = ref('')
const isMerchant = computed(() => session.roles.some((role) => ['MERCHANT','FRONT_DESK','ADMIN','SUPER_ADMIN'].includes(role)))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const results = await Promise.allSettled([endpoints.myCoupons(), endpoints.merchants()])
    if (results[0].status === 'fulfilled') coupons.value = results[0].value
    if (results[1].status === 'fulfilled') { merchants.value = results[1].value; selectedMerchantId.value ||= merchants.value[0]?.id || '' }
    const failed = results.filter((result) => result.status === 'rejected')
    if (failed.length) error.value = failed.length === results.length ? '卡券数据加载失败，请稍后重试' : '部分卡券数据未能同步，可重试刷新'
  } finally { loading.value = false }
}
async function claim() {
  if (!claimCode.value.trim()) return
  try { await endpoints.claimCoupon(claimCode.value.trim()); claimCode.value = ''; uni.showToast({ title: '领取成功', icon: 'success' }); await load() }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
async function scanRedeem() {
  try {
    const scan = await uni.scanCode({ scanType: ['qrCode'] })
    redeemCode.value = scan.result.split('/').pop() || scan.result
  } catch { return }
}
async function redeem() {
  if (!selectedMerchantId.value || !redeemCode.value) return uni.showToast({ title: '请选择商户并填写券码', icon: 'none' })
  try {
    await endpoints.redeemCoupon({ code: redeemCode.value, merchantId: selectedMerchantId.value, attributedAmountCents: 0, idempotencyKey: idempotencyKey('redeem') })
    uni.showToast({ title: '核销成功', icon: 'success' }); redeemCode.value = ''; await load()
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view v-if="error" class="card load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view class="claim card">
      <text class="title">领取联盟权益</text><text class="muted">输入场馆或联盟商户发放的唯一券码</text>
      <view class="inline"><input v-model="claimCode" class="input" placeholder="请输入券码" /><button class="primary" @tap="claim">领取</button></view>
    </view>
    <view class="section-title">我的券包</view>
    <view v-for="coupon in coupons" :key="coupon.id" class="coupon card">
      <view class="cut left"></view><view class="cut right"></view>
      <view class="row"><text class="merchant">{{ coupon.template?.merchant?.name }}</text><StatusBadge :value="coupon.status" /></view>
      <text class="benefit">{{ coupon.template?.benefitDescription }}</text>
      <view class="row"><text class="muted">有效至 {{ shortDate(coupon.expiresAt) }}</text><text class="money">{{ coupon.template?.faceValueCents ? money(coupon.template.faceValueCents) : '专属权益' }}</text></view>
      <text class="code">{{ coupon.code }}</text>
    </view>
    <SectionEmpty v-if="!coupons.length && !loading && !error" title="券包还是空的" description="参加活动或输入券码领取本地生活权益" />

    <view v-if="isMerchant" class="section-title">商户核销台</view>
    <view v-if="isMerchant" class="card redeem-panel">
      <picker :range="merchants" range-key="name" @change="selectedMerchantId = merchants[Number(($event.detail as any).value)]?.id"><view class="picker">{{ merchants.find(item => item.id === selectedMerchantId)?.name || '选择核销商户' }}　›</view></picker>
      <view class="inline"><input v-model="redeemCode" class="input" placeholder="扫码或输入券码" /><button class="secondary scan" @tap="scanRedeem">扫码</button></view>
      <button class="primary" @tap="redeem">确认唯一核销</button>
      <text class="muted warning">联盟商户自行收款；此处只做券核销、消费归因与结算统计。</text>
    </view>
  </view>
</template>
<style scoped>
.title { display: block; margin-bottom: 10rpx; font-size: 31rpx; font-weight: 800; }.inline { display: flex; gap: 14rpx; margin-top: 22rpx; }.inline .input { flex: 1; min-width: 0; }.inline button { flex: 0 0 150rpx; padding: 0; }
.coupon { position: relative; overflow: hidden; padding-left: 38rpx; border-left: 10rpx solid #c5a952; }.cut { position: absolute; top: 50%; width: 30rpx; height: 30rpx; margin-top: -15rpx; background: #f3f6f2; border-radius: 50%; }.cut.left { left: -20rpx; }.cut.right { right: -20rpx; }
.coupon .row { flex-wrap: wrap; }.merchant { min-width: 0; font-weight: 700; overflow-wrap: anywhere; }.benefit { display: block; margin: 26rpx 0 20rpx; font-size: 31rpx; font-weight: 800; overflow-wrap: anywhere; }.code { display: block; padding-top: 20rpx; margin-top: 20rpx; color: #758079; border-top: 1rpx dashed #dce2dd; font-family: monospace; font-size: 22rpx; letter-spacing: 2rpx; overflow-wrap: anywhere; }
.picker { padding: 22rpx; background: #f5f7f4; border-radius: 18rpx; }.warning { display: block; margin-top: 18rpx; line-height: 1.6; }.scan { margin: 0; }.redeem-panel>.primary { margin-top: 20rpx; }
.load-error { display:flex; align-items:center; gap:18rpx; color:#9a3e36; background:#fff4f2; }.load-error text { flex:1; min-width:0; line-height:1.5; overflow-wrap:anywhere; }.retry { flex:0 0 auto; min-height:64rpx; margin:0; padding:0 22rpx; line-height:64rpx; font-size:23rpx; }
</style>
