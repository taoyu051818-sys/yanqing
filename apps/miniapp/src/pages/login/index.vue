<script setup lang="ts">
import { ref } from 'vue'
import type { AppRole } from '../../types/domain'
import { useSessionStore } from '../../stores/session'
import { isMockMode } from '../../services/http'

const session = useSessionStore()
// A remote API must never expose the development identity shortcut, even
// when the bundle is launched with a local dev server.  The mock transport is
// the explicit, opt-in test environment for this channel.
const isDev = isMockMode
const error = ref('')
const developmentRoles: Array<{ role: AppRole; label: string }> = [
  { role: 'MEMBER', label: '会员' }, { role: 'FRONT_DESK', label: '前台' },
  { role: 'COACH', label: '教练' }, { role: 'HOST', label: '主理人' },
  { role: 'MERCHANT', label: '联盟商户' }, { role: 'FINANCE', label: '财务' },
  { role: 'EVENT_MANAGER', label: '赛事管理员' }, { role: 'ADMIN', label: '管理员' },
  { role: 'SUPER_ADMIN', label: '超级管理员' },
]
const finish = () => uni.switchTab({ url: '/pages/home/index' })
async function loginWechat() {
  error.value = ''
  try { await session.loginWithWechat(); finish() }
  catch (cause: any) { error.value = cause.message || '微信登录失败' }
}
async function loginDev(role: AppRole) {
  error.value = ''
  try { await session.loginForDevelopment(role); finish() }
  catch (cause: any) { error.value = cause.message || '测试账号尚未初始化' }
}
</script>

<template>
  <view class="login-page safe-bottom">
    <view class="brand-mark">金羽</view>
    <text class="title">延庆金羽羽毛球</text>
    <text class="copy">会员服务、竞技社交与本地生活权益，一次登录全部连接。</text>
    <button class="primary login-button" :loading="session.loading" @tap="loginWechat">微信一键登录</button>
    <text v-if="error" class="error">{{ error }}</text>

    <view v-if="isDev" class="dev card">
      <text class="dev-title">开发联调入口</text>
      <text class="muted">仅开发构建显示。请先执行数据库种子数据。</text>
      <view class="role-grid">
        <button v-for="item in developmentRoles" :key="item.role" class="secondary role" @tap="loginDev(item.role)">{{ item.label }}</button>
      </view>
    </view>
    <text class="privacy">登录即表示同意《用户服务协议》和《隐私保护指引》</text>
  </view>
</template>

<style scoped>
.login-page { min-height: 100vh; box-sizing: border-box; padding: 180rpx 56rpx 40rpx; text-align: center; background: radial-gradient(circle at 70% 10%,#dfeddf,transparent 34%),#f3f6f2; }
.brand-mark { display: grid; place-items: center; width: 132rpx; height: 132rpx; margin: 0 auto 34rpx; color: #fff; background: linear-gradient(145deg,#164b30,#c1a149); border-radius: 38rpx; font-size: 38rpx; font-weight: 800; }
.title { display: block; font-size: 48rpx; font-weight: 800; }
.copy { display: block; margin: 24rpx 20rpx 60rpx; color: #667169; font-size: 27rpx; line-height: 1.7; }
.login-button { width: 100%; }
.error { display: block; margin-top: 18rpx; color: #b32e2e; font-size: 24rpx; }
.dev { margin-top: 70rpx; text-align: left; }
.dev-title { display: block; margin-bottom: 8rpx; font-weight: 700; }
.role-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14rpx; margin-top: 22rpx; }
.role { padding: 0; min-height: 66rpx; line-height: 66rpx; font-size: 23rpx; }
.privacy { position: fixed; right: 30rpx; bottom: 32rpx; left: 30rpx; color: #919993; font-size: 20rpx; }
</style>
