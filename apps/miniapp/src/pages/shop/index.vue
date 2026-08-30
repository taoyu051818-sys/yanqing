<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import SectionEmpty from '../../components/SectionEmpty.vue'
import { endpoints } from '../../services/api'
import { money } from '../../utils/format'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const products = ref<any[]>([])
const loading = ref(false)
async function load() {
  loading.value = true
  try { products.value = await endpoints.goods() }
  catch (cause: any) { uni.showToast({ title: cause.message, icon: 'none' }) }
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
    <view class="shop-head"><text class="title">金羽小店</text><text class="muted">采购与寄售分账、库存流水全程可追溯</text></view>
    <view class="grid-2">
      <view v-for="product in products" :key="product.id" class="product">
        <view class="product-image">{{ product.category?.slice(0,2) }}</view>
        <text class="name">{{ product.name }}</text><text class="muted">{{ product.mode === 'CONSIGNMENT' ? '寄售' : '采购' }} · 库存{{ product.stock }}</text>
        <view class="row footer"><text class="money">{{ money(product.salePriceCents) }}</text><button class="secondary buy" :disabled="product.stock <= 0" @tap="buy(product)">购买</button></view>
      </view>
    </view>
    <SectionEmpty v-if="!products.length && !loading" title="小店补货中" />
  </view>
</template>
<style scoped>
.shop-head { margin: 10rpx 0 28rpx; }.title { display: block; margin-bottom: 10rpx; font-size: 44rpx; font-weight: 800; }.product { padding: 20rpx; background: #fff; border-radius: 24rpx; }.product-image { display: grid; place-items: center; height: 180rpx; margin-bottom: 18rpx; color: #17653d; background: linear-gradient(145deg,#edf5ee,#dce9dd); border-radius: 18rpx; font-size: 35rpx; font-weight: 800; }.name { display: block; margin-bottom: 8rpx; font-weight: 700; }.footer { margin-top: 18rpx; }.buy { min-width: 100rpx; min-height: 62rpx; margin: 0; padding: 0 16rpx; line-height: 62rpx; font-size: 22rpx; }
</style>
