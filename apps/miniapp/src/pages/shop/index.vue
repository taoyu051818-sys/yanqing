<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { money } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import { useSessionStore } from '../../stores/session'
import { openMemberPage, requestMemberLogin } from '../../utils/member-navigation'

const session = useSessionStore()
const quantities = ref<Record<string, number>>({})
const busy = ref('')
const actionError = ref('')
const quantityOf = (product: any) => Math.min(Math.max(0, Number(product.stock)), quantities.value[product.id] || 1)
function changeQuantity(product: any, delta: number) {
  if (!busy.value) quantities.value[product.id] = Math.max(1, Math.min(product.stock, quantityOf(product) + delta))
}
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
  if (!session.isAuthenticated) return requestMemberLogin('/pages/shop/index')
  if (busy.value) return
  const quantity = quantityOf(product)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) return uni.showToast({ title: '数量无效或库存不足', icon: 'none' })
  busy.value = product.id
  actionError.value = ''
  try {
    const items = [{ itemId: product.id, quantity }]
    const order: any = await withPendingCreationKey('goods.order', { items }, (creationIdempotencyKey) =>
      endpoints.createGoodsOrder(items, creationIdempotencyKey),
    )
    await openMemberPage(`/pages/order/index?id=${encodeURIComponent(order.id)}`)
  } catch (cause: any) { actionError.value = cause.message || '下单失败，请重试'; await load() }
  finally { busy.value = '' }
}
onShow(load)
</script>
<template>
  <view class="page safe-bottom">
    <view class="shop-head"><text class="title">金羽小店</text><text class="muted">场馆好物，在线下单，到店领取</text></view>
    <view v-if="error" class="load-error"><text>{{ error }}</text><button class="secondary retry" @tap="load">重试</button></view>
    <view v-if="actionError" class="load-error" role="alert">{{ actionError }}</view>
    <view v-if="loading && !products.length" class="loading-state">商品同步中…</view>
    <view class="grid-2">
      <view v-for="product in products" :key="product.id" class="product">
        <view class="product-image">{{ product.category?.slice(0,2) }}</view>
        <text class="name">{{ product.name }}</text><text class="muted">现货 · 库存 {{ product.stock }}</text>
        <text class="muted">单价 {{ money(product.salePriceCents) }}</text>
        <view v-if="product.stock > 0" class="quantity"><button role="button" :aria-label="`减少${product.name}数量`" :disabled="Boolean(busy) || quantityOf(product) <= 1" @tap="changeQuantity(product, -1)">−</button><text>{{ quantityOf(product) }}</text><button role="button" :aria-label="`增加${product.name}数量`" :disabled="Boolean(busy) || quantityOf(product) >= product.stock" @tap="changeQuantity(product, 1)">＋</button></view>
        <view class="row footer"><text class="money">合计 {{ money(product.salePriceCents * quantityOf(product)) }}</text><button class="secondary buy" :loading="busy === product.id" :disabled="Boolean(busy) || product.stock <= 0" @tap="buy(product)">{{ product.stock <= 0 ? '暂时售罄' : '下单，下一步付款' }}</button></view>
      </view>
    </view>
    <SectionEmpty v-if="!products.length && !loading && !error" title="小店补货中" />
  </view>
</template>
<style scoped>
.quantity { display:flex; align-items:center; justify-content:space-between; gap:16rpx; margin-top:18rpx; }.quantity button { flex:none; width:44px; min-height:44px; padding:0; margin:0; font-size:30rpx; background:var(--color-primary-soft); }.quantity text { min-width:24rpx; text-align:center; }.footer .buy { width:100%; padding:16rpx 8rpx; }.footer .money { font-size:28rpx; overflow-wrap:anywhere; }
@media (max-width:360px) { .grid-2 { grid-template-columns:1fr; } }
.shop-head { margin: 10rpx 0 28rpx; }.title { display: block; margin-bottom: 10rpx; font-size: 44rpx; font-weight: 800; }.product { min-width: 0; padding: 20rpx; background: #fff; border-radius: 24rpx; }.product-image { display: grid; place-items: center; height: 180rpx; margin-bottom: 18rpx; color: #17653d; background: linear-gradient(145deg,#edf5ee,#dce9dd); border-radius: 18rpx; font-size: 35rpx; font-weight: 800; }.name { display: block; margin-bottom: 8rpx; font-weight: 700; overflow-wrap: anywhere; }.footer { flex-wrap: wrap; margin-top: 18rpx; }.buy { min-width: 100rpx; min-height: 62rpx; margin: 0; padding: 0 16rpx; line-height: 62rpx; font-size: 22rpx; }.load-error { display:flex; align-items:center; gap:16rpx; padding:22rpx; margin-bottom:20rpx; color:#9a3e36; background:#fff4f2; border-radius:18rpx; }.load-error text { flex:1; min-width:0; overflow-wrap:anywhere; }.retry { flex:0 0 auto; min-height:64rpx; margin:0; padding:0 20rpx; line-height:64rpx; font-size:22rpx; }.loading-state { padding:30rpx; color:#758079; text-align:center; }
</style>
