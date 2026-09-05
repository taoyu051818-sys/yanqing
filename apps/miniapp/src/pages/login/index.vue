<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import type { AppRole } from '../../types/domain'
import { useSessionStore } from '../../stores/session'
import { isMockMode } from '../../services/http'
import { finishMemberLogin } from '../../utils/member-navigation'

const session = useSessionStore()
// Remote identity switching is opt-in and reserved for the isolated staging
// channel. Production builds do not receive this flag and keep the shortcut
// hidden even when they happen to be served from a developer machine.
const isRemoteStaging = !isMockMode && import.meta.env.VITE_ENABLE_REMOTE_DEV_LOGIN === 'true'
const isDev = isMockMode || isRemoteStaging
const showDevelopment = ref(false)
const error = ref('')
const profileStep = ref(false)
const nickname = ref('')
const avatarFilePath = ref('')
const developmentRoles: Array<{ role: AppRole; label: string }> = [
  { role: 'MEMBER', label: '会员' }, { role: 'FRONT_DESK', label: '前台' },
  { role: 'COACH', label: '教练' }, { role: 'HOST', label: '主理人' },
  { role: 'MERCHANT', label: '联盟商户' }, { role: 'FINANCE', label: '财务' },
  { role: 'EVENT_MANAGER', label: '赛事管理员' }, { role: 'ADMIN', label: '管理员' },
  { role: 'SUPER_ADMIN', label: '超级管理员' },
]
const finish = () => {
  if (session.referralAttributionMessage) {
    uni.showToast({
      title: session.referralAttributionMessage,
      icon: session.referralAttribution === 'bound' ? 'success' : 'none',
      duration: 2600,
    })
  }
  finishMemberLogin()
}
async function loginWechat() {
  error.value = ''
  try {
    await session.loginWithWechat()
    if (!session.user || (session.user.displayName && session.user.displayName !== '微信用户')) {
      finish()
      return
    }
    nickname.value = ''
    profileStep.value = true
  }
  catch (cause: any) { error.value = cause.message || '微信登录失败' }
}
function chooseAvatar(event: any) {
  avatarFilePath.value = event?.detail?.avatarUrl || ''
}
async function saveWechatProfile() {
  const displayName = nickname.value.trim()
  if (!displayName) {
    error.value = '请先点击昵称输入框，选择或填写微信昵称'
    return
  }
  error.value = ''
  try {
    await session.updateWechatProfile(displayName, avatarFilePath.value || undefined)
    finish()
  } catch (cause: any) {
    error.value = cause?.message || '微信资料保存失败，请重试'
  }
}
async function loginDev(role: AppRole) {
  error.value = ''
  try { await session.loginForDevelopment(role); finish() }
  catch (cause: any) { error.value = cause.message || '测试账号尚未初始化' }
}
</script>

<template>
  <view class="login-page safe-bottom">
    <view v-if="isRemoteStaging" class="staging-banner"><AppIcon name="info" :size="28" tone="accent" /><text>域名验收环境 · 仅测试数据</text></view>
    <view class="brand-mark"><AppIcon name="sport" :size="62" tone="inverse" /></view>
    <text class="title">延庆金羽羽毛球</text>
    <text class="copy">登录后继续预约，并随时查看自己的订单与安排。</text>
    <button v-if="!profileStep" class="primary login-button" :loading="session.loading" :disabled="session.loading" @tap="loginWechat"><AppIcon name="profile" :size="32" tone="inverse" />微信一键登录</button>
    <view v-else class="profile-consent card">
      <text class="profile-title">完善微信资料</text>
      <text class="profile-note">头像和昵称由你主动选择并确认，仅用于会员识别、报名和球局展示。</text>
      <button class="avatar-picker" open-type="chooseAvatar" @chooseavatar="chooseAvatar">
        <image v-if="avatarFilePath" class="avatar-preview" :src="avatarFilePath" mode="aspectFill" />
        <view v-else class="avatar-placeholder"><AppIcon name="profile" :size="40" /></view>
        <text>{{ avatarFilePath ? '已选择微信头像，点击更换' : '选择微信头像' }}</text>
      </button>
      <view class="nickname-field">
        <text class="field-label">微信昵称</text>
        <input v-model="nickname" type="nickname" maxlength="40" placeholder="点击使用微信昵称" />
      </view>
      <button class="primary save-profile" :loading="session.loading" :disabled="session.loading" @tap="saveWechatProfile">保存并进入小程序</button>
      <button class="skip-profile" :disabled="session.loading" @tap="finish">暂不设置，稍后在“我的”完善</button>
    </view>
    <view v-if="error" class="error"><AppIcon name="warning" :size="28" tone="danger" /><text>{{ error }}</text></view>

    <button v-if="isDev" class="dev-toggle" @tap="showDevelopment = !showDevelopment">{{ showDevelopment ? '收起开发验收入口' : '开发验收入口' }}</button>
    <view v-if="isDev && showDevelopment" class="dev card">
      <view class="dev-heading"><view class="dev-icon"><AppIcon name="governance" :size="30" /></view><text class="dev-title">开发联调入口</text></view>
      <text class="muted">{{ isRemoteStaging ? '连接隔离测试库，操作不会进入正式数据。' : '仅开发构建显示。请先执行数据库种子数据。' }}</text>
      <view class="role-grid">
        <button v-for="item in developmentRoles" :key="item.role" class="secondary role" @tap="loginDev(item.role)">{{ item.label }}</button>
      </view>
    </view>
    <text class="privacy">登录即表示同意《用户服务协议》和《隐私保护指引》</text>
  </view>
</template>

<style scoped>
.login-page { min-height: 100vh; box-sizing: border-box; padding: 180rpx 56rpx 40rpx; text-align: center; background: radial-gradient(circle at 70% 10%,#dfeddf,transparent 34%),#f3f6f2; }
.staging-banner { position: absolute; top: 24rpx; right: 24rpx; left: 24rpx; display:flex; align-items:center; justify-content:center; gap:10rpx; padding: 12rpx 18rpx; color: #7a5410; background: #fff3cf; border: 1rpx solid #e6c66e; border-radius: 999rpx; font-size: 22rpx; }
.brand-mark { display: grid; place-items: center; width: 132rpx; height: 132rpx; margin: 0 auto 34rpx; color: #fff; background: linear-gradient(145deg,#164b30,#c1a149); border-radius: 38rpx; font-size: 38rpx; font-weight: 800; }
.title { display: block; font-size: 48rpx; font-weight: 800; }
.copy { display: block; margin: 24rpx 20rpx 60rpx; color: #667169; font-size: 27rpx; line-height: 1.7; }
.login-button { width: 100%; }
.profile-consent { display:grid; gap:20rpx; padding:30rpx; text-align:left; }
.profile-title { display:block; color:#183e2a; font-size:32rpx; font-weight:800; text-align:center; }
.profile-note { display:block; color:#667169; font-size:22rpx; line-height:1.6; text-align:center; }
.avatar-picker { display:flex; align-items:center; justify-content:flex-start; gap:18rpx; box-sizing:border-box; width:100%; min-height:96rpx; padding:12rpx 18rpx; margin:0; color:#244c37; background:#f1f6f2; border:1rpx solid #dbe8df; border-radius:20rpx; font-size:23rpx; font-weight:700; }
.avatar-preview,.avatar-placeholder { flex:0 0 auto; width:72rpx; height:72rpx; border-radius:22rpx; }
.avatar-placeholder { display:grid; place-items:center; background:#e0eee4; }
.nickname-field { display:grid; gap:8rpx; }
.field-label { color:#667169; font-size:21rpx; }
.nickname-field input { box-sizing:border-box; width:100%; min-height:88rpx; padding:0 20rpx; color:#213b2b; background:#f6f8f6; border:1rpx solid #dbe3de; border-radius:18rpx; font-size:26rpx; }
.save-profile,.skip-profile { width:100%; margin:0; }
.skip-profile { min-height:72rpx; color:#607067; background:transparent; font-size:22rpx; }
.skip-profile::after { border:0; }
.error { display:flex; align-items:center; justify-content:center; gap:10rpx; margin-top: 18rpx; color: #b32e2e; font-size: 24rpx; }
.dev { margin-top: 70rpx; text-align: left; }
.dev-toggle { width:100%; margin:36rpx 0 0; background:transparent; color:var(--color-muted); font-size:24rpx; }
.dev-heading { display:flex; align-items:center; gap:10rpx; margin-bottom:8rpx; }
.dev-icon { display:grid; place-items:center; width:48rpx; height:48rpx; background:#e7f4eb; border-radius:15rpx; }
.dev-title { display: block; font-weight: 700; }
.role-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14rpx; margin-top: 22rpx; }
.role { width: 100%; padding: 0; min-height: 66rpx; line-height: 66rpx; font-size: 23rpx; }
.privacy { display:block; margin:56rpx auto 0; color: #7b857e; font-size: 20rpx; line-height:1.6; overflow-wrap:anywhere; }
@media (max-width: 360px) {
  .login-page { padding-right:36rpx; padding-left:36rpx; }
  .role-grid { grid-template-columns:repeat(2,1fr); }
}
</style>
