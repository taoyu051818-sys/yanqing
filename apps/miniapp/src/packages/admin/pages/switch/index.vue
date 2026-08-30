<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { roleOptions } from '../../../../services/mock/core'
import { resetCatalogState } from '../../../../services/mock/state'
import { isMockMode } from '../../../../services/http'
import { useSessionStore } from '../../../../stores/session'
import type { AppRole } from '../../../../types/domain'

const session = useSessionStore()
const switching = ref<AppRole | null>(null)
const roleNames: Record<AppRole, string> = {
  MEMBER: '会员端', FRONT_DESK: '前台端', COACH: '教练端', HOST: '主理人端', MERCHANT: '商户端',
  FINANCE: '财务端', EVENT_MANAGER: '赛事端', ADMIN: '管理员端', SUPER_ADMIN: '超级管理端',
}
const current = computed(() => session.user?.primaryRole || 'MEMBER')

onShow(() => {
  if (!isMockMode) {
    uni.showToast({ title: '远程环境不开放身份切换', icon: 'none' })
    setTimeout(() => uni.switchTab({ url: '/pages/home/index' }), 250)
  }
})

async function switchRole(role: AppRole) {
  switching.value = role
  try {
    await session.loginForDevelopment(role)
    uni.showToast({ title: `已切换为${roleNames[role]}`, icon: 'success' })
    setTimeout(() => {
      if (role === 'MEMBER') uni.switchTab({ url: '/pages/home/index' })
      else uni.redirectTo({ url: '/pages/workspace/index' })
    }, 350)
  } finally { switching.value = null }
}

function resetDemo() {
  uni.removeStorageSync('yanqing_mock_orders')
  resetCatalogState()
  uni.showToast({ title: '演示数据已重置', icon: 'success' })
}
</script>

<template>
  <view class="page safe-bottom">
    <view class="hero">
      <text class="eyebrow">ADMIN DEMO CHANNEL</text>
      <text class="title">身份与端口切换</text>
      <text class="copy">当前为 {{ roleNames[current] }}。模拟模式不会访问外部服务器，所有操作仅保存在本机微信缓存。</text>
    </view>
    <view class="section-title">选择体验端</view>
    <view class="role-list">
      <view v-for="item in roleOptions" :key="item.role" class="role card" :class="{ active: current === item.role }" @tap="switchRole(item.role)">
        <view>
          <text class="role-name">{{ roleNames[item.role] }}</text>
          <text class="muted">{{ item.label }} · {{ item.description }}</text>
        </view>
        <text class="state">{{ switching === item.role ? '切换中' : current === item.role ? '当前' : '进入 ›' }}</text>
      </view>
    </view>
    <button class="secondary reset" @tap="resetDemo">重置本机演示数据</button>
    <view class="tip">正式环境设置 VITE_DATA_MODE=remote 后，本通道仍可保留为受权限控制的测试入口，也可以从构建中关闭。</view>
  </view>
</template>

<style scoped>
.hero { padding: 38rpx; color: #fff; background: linear-gradient(145deg,#172b21,#17653d); border-radius: 32rpx; }
.eyebrow { opacity: .6; font-size: 19rpx; letter-spacing: 3rpx; }.title { display:block; margin: 22rpx 0 14rpx; font-size: 42rpx; font-weight: 800; }.copy { color: rgba(255,255,255,.75); font-size: 24rpx; line-height: 1.7; }
.role-list { display: grid; gap: 16rpx; }.role { display:flex; align-items:center; justify-content:space-between; margin:0; border: 2rpx solid transparent; }.role.active { border-color:#c8a94f; background:#fffdf5; }.role-name { display:block; margin-bottom:8rpx; font-size:30rpx; font-weight:800; }.state { color:#17653d; font-weight:700; }.reset { width:100%; margin-top:30rpx; }.tip { margin-top:20rpx; padding:22rpx; color:#6d5a24; background:#fff4d8; border-radius:20rpx; font-size:22rpx; line-height:1.6; }
</style>
