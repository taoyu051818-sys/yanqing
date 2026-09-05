<script setup lang="ts">
import { computed } from 'vue'
import {
  hasOperationsAccess,
  type OperationsAccessScope,
} from '../../../config/operations'
import { useSessionStore } from '../../../stores/session'
import AppIcon from '../../../components/AppIcon.vue'

const props = defineProps<{
  title: string
  eyebrow: string
  description: string
  role: string
  access: OperationsAccessScope
  venue?: string
  shift?: string
  icon?: string
}>()

const session = useSessionStore()
const canAccess = computed(() => hasOperationsAccess(session.roles, props.access))

const businessDate = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
})

function backToMember() {
  uni.switchTab({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="ops-page safe-bottom">
    <view class="ops-header">
      <view class="eyebrow-row">
        <view class="header-icon"><AppIcon :name="props.icon || 'work'" :size="34" tone="inverse" /></view>
        <text class="eyebrow">{{ props.eyebrow }}</text>
      </view>
      <view class="header-row">
        <view>
          <text class="title">{{ props.title }}</text>
          <text class="description">{{ props.description }}</text>
        </view>
        <text class="role-chip">{{ canAccess ? props.role : '会员端' }}</text>
      </view>
      <view v-if="canAccess" class="context-bar">
        <text>{{ props.venue || '延庆金羽主馆' }}</text>
        <text>{{ businessDate }} · {{ props.shift || '全日营业' }}</text>
      </view>
    </view>
    <slot v-if="canAccess" />
    <view v-else class="access-denied">
      <view class="denied-icon"><AppIcon name="warning" :size="40" tone="danger" /></view>
      <text class="access-title">无经营权限</text>
      <text class="access-copy">当前账号不具备此经营中心的访问权限，经营数据不会加载。请返回会员端继续使用订场、活动和会员服务。</text>
      <button class="primary access-action" @tap="backToMember">返回会员端</button>
    </view>
  </view>
</template>

<style scoped>
.ops-page { min-height: 100vh; padding: 24rpx 28rpx 56rpx; box-sizing: border-box; overflow-x:clip; background: #f3f6f2; }
.ops-header { position:relative; overflow:hidden; padding: 32rpx; color: #fff; background: linear-gradient(145deg,#103b27,#17653d 74%,#6f6b2a 145%); border:1rpx solid rgba(255,255,255,.12); border-radius: 28rpx; box-shadow: 0 14rpx 34rpx rgba(22,61,41,.16); }
.ops-header::after { position:absolute; right:-80rpx; bottom:-120rpx; width:260rpx; height:260rpx; border:36rpx solid rgba(255,255,255,.045); border-radius:50%; content:''; }
.eyebrow-row { position:relative; z-index:1; display:flex; align-items:center; gap:12rpx; }
.header-icon { display:grid; place-items:center; width:52rpx; height:52rpx; background:rgba(255,255,255,.12); border:1rpx solid rgba(255,255,255,.14); border-radius:16rpx; }
.eyebrow { display: block; opacity: .62; font-size: 19rpx; letter-spacing: 3rpx; }
.header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16rpx; margin-top: 14rpx; }
.header-row > view { flex: 1 1 auto; min-width: 0; }
.title { display: block; font-size: 40rpx; font-weight: 850; line-height:1.25; }
.description { display: block; max-width: 580rpx; margin-top: 12rpx; color: rgba(255,255,255,.74); font-size: 23rpx; line-height: 1.55; }
.role-chip { flex: 0 0 auto; padding: 9rpx 14rpx; color: #e8d28a; border: 1rpx solid rgba(232,210,138,.52); border-radius: 999rpx; font-size: 20rpx; }
.context-bar { display: flex; justify-content: space-between; gap: 16rpx; margin-top: 24rpx; padding-top: 18rpx; color: rgba(255,255,255,.72); border-top: 1rpx solid rgba(255,255,255,.16); font-size: 21rpx; }
.access-denied { margin-top: 24rpx; padding: 38rpx 30rpx; background: #fff; border: 1rpx solid #e2e8e2; border-radius: 24rpx; box-shadow: 0 8rpx 24rpx rgba(22,61,41,.06); }
.denied-icon { display:grid; place-items:center; width:72rpx; height:72rpx; margin-bottom:20rpx; background:#fff0ef; border-radius:20rpx; }
.access-title { display: block; color: #183d2a; font-size: 32rpx; font-weight: 800; }
.access-copy { display: block; margin-top: 14rpx; color: #67736b; font-size: 24rpx; line-height: 1.65; }
.access-action { width: 100%; margin-top: 26rpx; }

@media screen and (max-width: 420px) {
  .header-row,
  .context-bar {
    align-items: flex-start;
    flex-direction: column;
  }
  .role-chip {
    align-self: flex-start;
  }
}
</style>
