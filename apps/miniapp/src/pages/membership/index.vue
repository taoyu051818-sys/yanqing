<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { money } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const products = ref<any[]>([])
const loading = ref(false)
const levelName: Record<string,string> = { REGULAR: '年度会员', GOLD: '金卡会员', BLACK: '黑金会员' }
async function load() {
  loading.value = true
  try { products.value = await endpoints.membershipProducts() }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
  finally { loading.value = false }
}
async function purchase(product: any) {
  try {
    const command = { productId: product.id }
    const order: any = await withPendingCreationKey('membership.purchase', command, (creationIdempotencyKey) =>
      endpoints.purchaseMembership(product.id, creationIdempotencyKey),
    )
    uni.showModal({ title: '会员订单已创建', content: `${order.orderNo} 待支付，支付后权益立即生效。`, showCancel: false })
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
async function recharge() {
  const result = await uni.showModal({ title: '现金本金充值', editable: true, placeholderText: '请输入充值金额（元）' })
  if (!result.confirm) return
  const cents = Math.round(Number(result.content) * 100)
  if (!Number.isSafeInteger(cents) || cents < 100) return uni.showToast({ title: '充值金额无效', icon: 'none' })
  try {
    const command = { principalCents: cents, giftCents: 0 }
    const order: any = await withPendingCreationKey('membership.recharge', command, (creationIdempotencyKey) =>
      endpoints.recharge(cents, 0, creationIdempotencyKey),
    )
    uni.showModal({ title: '充值订单已创建', content: `${order.orderNo} 仅可使用微信支付，到账后进入现金本金账户。`, showCancel: false })
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view class="hero"><text class="eyebrow">GOLDEN FEATHER MEMBER</text><text class="hero-title">让每次到场更有价值</text><button class="recharge" @tap="recharge">充值现金本金</button></view>
    <view v-for="product in products" :key="product.id" class="card product" :class="product.level.toLowerCase()">
      <view class="row"><text class="pill">{{ levelName[product.level] || product.level }}</text><text class="muted">{{ product.durationDays }}天</text></view>
      <text class="name">{{ product.name }}</text>
      <view class="benefits"><text v-for="(_, key) in product.benefits" :key="key">✓ {{ key }}</text></view>
      <view class="row"><text class="price">{{ money(product.priceCents) }}</text><button class="primary buy" @tap="purchase(product)">立即开通</button></view>
    </view>
    <SectionEmpty v-if="!products.length && !loading" title="暂无会员产品" />
  </view>
</template>
<style scoped>
.hero { padding: 38rpx; margin-bottom: 24rpx; color: #fff; background: linear-gradient(145deg,#181f1b,#315940); border-radius: 30rpx; }.eyebrow { opacity: .55; font-size: 18rpx; letter-spacing: 3rpx; }.hero-title { display: block; margin: 28rpx 0; font-size: 40rpx; font-weight: 800; }.recharge { width: 240rpx; margin: 0; color: #193d2b; background: #e5cd7f; font-size: 24rpx; }
.name { display: block; margin: 25rpx 0; font-size: 35rpx; font-weight: 800; }.benefits { display: flex; flex-wrap: wrap; gap: 12rpx; margin-bottom: 28rpx; }.benefits text { padding: 9rpx 14rpx; color: #5f695f; background: #f3f6f2; border-radius: 999rpx; font-size: 21rpx; }.price { color: #17492f; font-size: 38rpx; font-weight: 800; }.buy { min-width: 180rpx; margin: 0; }.black { border-top: 8rpx solid #262d29; }.gold { border-top: 8rpx solid #c8aa51; }
</style>
