<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { requestMemberLogin, openMemberPage } from '../../utils/member-navigation'
import { couponClaimPath, couponCodeFromInput } from '../../utils/coupon-invitation'
import { selectableBookingCoupons } from '../../utils/booking-coupons'
import { money, shortDate } from '../../utils/format'

const session = useSessionStore()
const coupons = ref<any[]>([])
const showClaim = ref(false)
const shownCode = ref('')
const claimCode = ref('')
const loading = ref(false)
const error = ref('')
const claiming = ref(false)
const claimError = ref('')


async function load() {
  if (!session.isAuthenticated) return requestMemberLogin(claimCode.value ? couponClaimPath(claimCode.value) : '/pages/coupon/index')
  loading.value = true
  error.value = ''
  try { coupons.value = await endpoints.myCoupons() }
  catch (cause: any) { error.value = cause?.message || '卡券暂未同步，请重试' }
  finally { loading.value = false }
}
async function claim() {
  if (claiming.value || !claimCode.value.trim()) return
  claiming.value = true; claimError.value = ''
  try { await endpoints.claimCoupon(claimCode.value.trim()); claimCode.value = ''; showClaim.value = false; uni.showToast({ title: '领取成功', icon: 'success' }); await load() }
  catch (cause: any) { claimError.value = cause.message || '领取失败，请核对券码后重试' }
  finally { claiming.value = false }
}
async function scanClaim() {
  if (claiming.value) return
  try {
    const result = await uni.scanCode({ scanType: ['qrCode', 'barCode'] })
    const code = couponCodeFromInput(result.result)
    if (!code) { claimError.value = '未识别到有效券码，请扫描场馆提供的领券码。'; return }
    claimCode.value = code
    showClaim.value = true
  } catch (cause: any) { if (!/cancel/.test(cause?.errMsg || '')) claimError.value = '无法扫码，可在下方手动输入券码。' }
}
onLoad(query => {
  const code = couponCodeFromInput(query?.claim)
  if (code) { claimCode.value = code; showClaim.value = true }
})
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view v-if="error" class="card load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view class="section-title">我的券包</view>
    <view v-for="coupon in coupons" :key="coupon.id" class="coupon card">
      <view class="cut left"></view><view class="cut right"></view>
      <view class="row"><text class="merchant">{{ coupon.template?.merchant?.name }}</text><StatusBadge :value="coupon.status" /></view>
      <text class="benefit">{{ coupon.template?.benefitDescription }}</text>
      <text class="muted">{{ coupon.bookingUsage?.label || (coupon.template?.code?.startsWith("NEWCOMER") ? "新客体验订场（限适用时段）" : coupon.template?.allowVenueBooking ? "商户消费 / 订场抵扣" : "仅限所属商户消费，不可抵扣订场") }}</text>
      <view class="row"><text class="muted">有效至 {{ shortDate(coupon.expiresAt) }}</text><text class="money">{{ coupon.template?.faceValueCents ? money(coupon.template.faceValueCents) : '专属权益' }}</text></view>
      <button v-if="selectableBookingCoupons([coupon]).length" class="primary code-button" @tap="openMemberPage(`/pages/booking/index?couponId=${encodeURIComponent(coupon.id)}`)">选择场地，使用此券</button>
      <button v-if="coupon.status === 'CLAIMED'" class="secondary code-button" @tap="shownCode = shownCode === coupon.id ? '' : coupon.id">{{ shownCode === coupon.id ? '收起' : '到店出示券码' }}</button><text v-if="shownCode === coupon.id" class="code">仅向核销工作人员出示：{{ coupon.code }}</text>
    </view>
    <SectionEmpty v-if="!coupons.length && !loading && !error" title="券包还是空的" description="已有券码可以在下方领取；领取后在使用时出示。" />

    <!-- #ifdef MP-WEIXIN -->
    <button class="primary claim-entry" :disabled="claiming" @tap="scanClaim">扫一扫领券</button>
    <!-- #endif -->
    <text v-if="claimError" class="load-error" role="alert">{{ claimError }}</text>
    <button class="secondary claim-entry" @tap="showClaim = !showClaim">{{ showClaim ? '收起领取入口' : '其他领券方式：输入券码' }}</button>
    <view v-if="showClaim" class="claim card">
      <text class="title">{{ claimCode ? "核对并领取此券" : "输入券码领取" }}</text><text class="muted">{{ claimCode ? "已带入领取凭证。点击确认后才会领取到当前账号；不会自动扣款。" : "输入场馆或合作商户发给你的券码" }}</text>
      <view class="inline"><input v-model="claimCode" class="input" aria-label="领取券码" placeholder="请输入券码" maxlength="128" :disabled="claiming" /><button class="primary" :loading="claiming" :disabled="claiming || !claimCode.trim()" @tap="claim">确认领取</button></view>
    </view>
  </view>
</template>
<style scoped>
.claim-entry,.code-button { width:100%; margin:22rpx 0; font-size:26rpx; }
.title { display: block; margin-bottom: 10rpx; font-size: 31rpx; font-weight: 800; }.inline { display: flex; gap: 14rpx; margin-top: 22rpx; }.inline .input { flex: 1; min-width: 0; }.inline button { flex: 0 0 150rpx; padding: 0; }
.coupon { position: relative; overflow: hidden; padding-left: 38rpx; border-left: 10rpx solid #c5a952; }.cut { position: absolute; top: 50%; width: 30rpx; height: 30rpx; margin-top: -15rpx; background: #f3f6f2; border-radius: 50%; }.cut.left { left: -20rpx; }.cut.right { right: -20rpx; }
.coupon .row { flex-wrap: wrap; }.merchant { min-width: 0; font-weight: 700; overflow-wrap: anywhere; }.benefit { display: block; margin: 26rpx 0 20rpx; font-size: 31rpx; font-weight: 800; overflow-wrap: anywhere; }.code { display: block; padding-top: 20rpx; margin-top: 20rpx; color: #758079; border-top: 1rpx dashed #dce2dd; font-family: monospace; font-size: 22rpx; letter-spacing: 2rpx; overflow-wrap: anywhere; }
.load-error { display:flex; align-items:center; gap:18rpx; color:#9a3e36; background:#fff4f2; }.load-error text { flex:1; min-width:0; line-height:1.5; overflow-wrap:anywhere; }.retry { flex:0 0 auto; min-height:64rpx; margin:0; padding:0 22rpx; line-height:64rpx; font-size:23rpx; }
</style>
