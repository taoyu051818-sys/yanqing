<script setup lang="ts">
import { ref } from 'vue'
import { onUnload } from '@dcloudio/uni-app'
import LoginAgreements from './components/LoginAgreements.vue'
import { useLoginConsent } from './use-login-consent'
import AppIcon from '../../components/AppIcon.vue'
import type { AppRole } from '../../types/domain'
import { useSessionStore } from '../../stores/session'
import { isMockMode } from '../../services/http'
import { cancelMemberLogin, finishMemberLogin } from '../../utils/member-navigation'

const session = useSessionStore()
// Remote identity switching is opt-in and reserved for the isolated staging
// channel. Production builds do not receive this flag and keep the shortcut
// hidden even when they happen to be served from a developer machine.
const isRemoteStaging = !isMockMode && import.meta.env.VITE_ENABLE_REMOTE_DEV_LOGIN === 'true'
const isDev = isMockMode || isRemoteStaging
const showDevelopment = ref(false)
const agreement = ref<'terms' | 'privacy' | null>(null)
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
const { agreed, error, pending, login, cancel, abandon } = useLoginConsent(
  () => session.logout(), finish, cancelMemberLogin,
)
function changeConsent(event: { detail: { value: string[] } }) {
  agreed.value = event.detail.value.includes('agreed')
  error.value = ''
}
function loginWechat() { return login(() => session.loginWithWechat()) }
function loginDev(role: AppRole) { return login(() => session.loginForDevelopment(role)) }
onUnload(abandon)
</script>

<template>
  <view class="login-page safe-bottom">
    <view v-if="isRemoteStaging" class="staging-banner"><AppIcon name="info" :size="28" tone="accent" /><text>域名验收环境 · 仅测试数据</text></view>
    <view class="brand-mark"><AppIcon name="sport" :size="62" tone="inverse" /></view>
    <text class="title">延庆金羽羽毛球</text>
    <text class="copy">先浏览，再决定。登录用于预约、报名和查询个人订单。</text>
    <view class="consent-panel">
      <checkbox-group @change="changeConsent">
        <label class="consent-label"><checkbox value="agreed" :checked="agreed" :disabled="pending" color="#17653d" /><text>我已阅读并同意以下协议</text></label>
      </checkbox-group>
      <view class="agreement-links">
        <button @tap="agreement = 'terms'">《用户服务协议》</button>
        <button @tap="agreement = 'privacy'">《隐私保护指引》</button>
      </view>
    </view>
    <button class="primary login-button" :loading="pending" :disabled="pending" @tap="loginWechat"><AppIcon name="profile" :size="32" tone="inverse" />微信一键登录</button>
    <button class="secondary browse-button" @tap="cancel">暂不登录，继续浏览</button>
    <text class="privacy">浏览场地和活动无需登录。头像、昵称可稍后自主完善。</text>
    <LoginAgreements v-if="agreement" :kind="agreement" @close="agreement = null" @decline="cancel" />
    <view v-if="error" class="error"><AppIcon name="warning" :size="28" tone="danger" /><text>{{ error }}</text></view>

    <button v-if="isDev" class="dev-toggle" @tap="showDevelopment = !showDevelopment">{{ showDevelopment ? '收起开发验收入口' : '开发验收入口' }}</button>
    <view v-if="isDev && showDevelopment" class="dev card">
      <view class="dev-heading"><view class="dev-icon"><AppIcon name="governance" :size="30" /></view><text class="dev-title">开发联调入口</text></view>
      <text class="muted">{{ isRemoteStaging ? '连接隔离测试库，操作不会进入正式数据。' : '仅开发构建显示。请先执行数据库种子数据。' }}</text>
      <view class="role-grid">
        <button v-for="item in developmentRoles" :key="item.role" class="secondary role" :disabled="pending" @tap="loginDev(item.role)">{{ item.label }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.login-page { min-height: 100vh; box-sizing: border-box; padding: 180rpx 56rpx 40rpx; text-align: center; background: radial-gradient(circle at 70% 10%,#dfeddf,transparent 34%),#f3f6f2; }
.staging-banner { position: absolute; top: 24rpx; right: 24rpx; left: 24rpx; display:flex; align-items:center; justify-content:center; gap:10rpx; padding: 12rpx 18rpx; color: #7a5410; background: #fff3cf; border: 1rpx solid #e6c66e; border-radius: 999rpx; font-size: 22rpx; }
.brand-mark { display: grid; place-items: center; width: 132rpx; height: 132rpx; margin: 0 auto 34rpx; color: #fff; background: linear-gradient(145deg,#164b30,#c1a149); border-radius: 38rpx; font-size: 38rpx; font-weight: 800; }
.title { display: block; font-size: 48rpx; font-weight: 800; }
.copy { display: block; margin: 24rpx 20rpx 60rpx; color: #667169; font-size: 27rpx; line-height: 1.7; }
.login-button { width: 100%; }
.consent-panel { margin:0 0 24rpx; text-align:left; }
.consent-label { display:flex; align-items:center; justify-content:center; gap:14rpx; min-height:88rpx; color:#344a3b; font-size:27rpx; }
.agreement-links { display:flex; justify-content:center; flex-wrap:wrap; }
.agreement-links button { min-height:88rpx; margin:0; padding:0 8rpx; background:transparent; color:#17653d; font-size:25rpx; line-height:88rpx; text-decoration:underline; }
.agreement-links button::after { border:0; }
.browse-button { width:100%; margin-top:24rpx; min-height:88rpx; font-size:28rpx; }
.error { display:flex; align-items:center; justify-content:center; gap:10rpx; margin-top: 18rpx; color: #b32e2e; font-size: 24rpx; }
.dev { margin-top: 70rpx; text-align: left; }
.dev-toggle { width:100%; margin:36rpx 0 0; background:transparent; color:var(--color-muted); font-size:24rpx; }
.dev-heading { display:flex; align-items:center; gap:10rpx; margin-bottom:8rpx; }
.dev-icon { display:grid; place-items:center; width:48rpx; height:48rpx; background:#e7f4eb; border-radius:15rpx; }
.dev-title { display: block; font-weight: 700; }
.role-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14rpx; margin-top: 22rpx; }
.role { width: 100%; padding: 0; min-height: 66rpx; line-height: 66rpx; font-size: 23rpx; }
.privacy { display:block; margin:28rpx auto 0; color: #7b857e; font-size: 24rpx; line-height:1.7; overflow-wrap:anywhere; }
@media (max-width: 360px) {
  .login-page { padding-right:36rpx; padding-left:36rpx; }
  .role-grid { grid-template-columns:repeat(2,1fr); }
}
</style>
