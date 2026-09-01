<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { money } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const products = ref<any[]>([])
const loading = ref(false)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try { products.value = await endpoints.goods() }
  catch (cause: any) { error.value = cause?.message || '商品加载失败，请稍后重试' }
  finally { loading.value = false }
}
async function buy(product: any) {
  const result = await uni.showModal({ title: product.name, editable: true, placeholderText: '购买数量，默认1' })
  if (!result.confirm) return
  const quantity = Number(result.content || 1)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) return uni.showToast({ title: '数量无效或库存不足', icon: 'none' })
  try {
    const items = [{ itemId: product.id, quantity }]
    const order: any = await withPendingCreationKey('goods.order', { items }, (creationIdempotencyKey) =>
      endpoints.createGoodsOrder(items, creationIdempotencyKey),
    )
    uni.showModal({ title: '商品订单已创建', content: `${order.orderNo} 待支付；支付成功后自动扣减库存。`, showCancel: false })
  } catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view class="shop-head"><text class="title">金羽小店</text><text class="muted">场馆好物，在线下单，到店领取</text></view>
    <view v-if="error" class="load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view v-if="loading && !products.length" class="loading-state">商品同步中…</view>
    <view class="grid-2">
      <view v-for="product in products" :key="product.id" class="product">
        <view class="product-image">{{ product.category?.slice(0,2) }}</view>
        <text class="name">{{ product.name }}</text><text class="muted">现货 · 库存 {{ product.stock }}</text>
        <view class="row footer"><text class="money">{{ money(product.salePriceCents) }}</text><button class="secondary buy" :disabled="product.stock <= 0" @tap="buy(product)">购买</button></view>
      </view>
    </view>
    <SectionEmpty v-if="!products.length && !loading && !error" title="小店补货中" />
  </view>
</template>
<style scoped>
.shop-head { margin: 10rpx 0 28rpx; }.title { display: block; margin-bottom: 10rpx; font-size: 44rpx; font-weight: 800; }.product { min-width: 0; padding: 20rpx; background: #fff; border-radius: 24rpx; }.product-image { display: grid; place-items: center; height: 180rpx; margin-bottom: 18rpx; color: #17653d; background: linear-gradient(145deg,#edf5ee,#dce9dd); border-radius: 18rpx; font-size: 35rpx; font-weight: 800; }.name { display: block; margin-bottom: 8rpx; font-weight: 700; overflow-wrap: anywhere; }.footer { flex-wrap: wrap; margin-top: 18rpx; }.buy { min-width: 100rpx; min-height: 62rpx; margin: 0; padding: 0 16rpx; line-height: 62rpx; font-size: 22rpx; }.load-error { display:flex; align-items:center; gap:16rpx; padding:22rpx; margin-bottom:20rpx; color:#9a3e36; background:#fff4f2; border-radius:18rpx; }.load-error text { flex:1; min-width:0; overflow-wrap:anywhere; }.retry { flex:0 0 auto; min-height:64rpx; margin:0; padding:0 20rpx; line-height:64rpx; font-size:22rpx; }.loading-state { padding:30rpx; color:#758079; text-align:center; }
</style>
