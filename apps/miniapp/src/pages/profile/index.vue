<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import MemberNextStep from '../../components/MemberNextStep.vue'
import { useSessionStore } from '../../stores/session'
import { isMockMode, resolveApiAssetUrl } from '../../services/http'
import { openMemberPage, requestMemberLogin } from '../../utils/member-navigation'
import { SHARE_CARD_IMAGES } from '../../config/share'
const session = useSessionStore()
const refreshFailed = ref(false)
const avatar = computed(() => resolveApiAssetUrl(session.user?.avatarUrl))
const isTestEnvironment = isMockMode || import.meta.env.VITE_ENABLE_REMOTE_DEV_LOGIN === 'true'
const showTestTools = ref(false)
const menus = [
  { icon: 'receipt', title: '我的订单', note: '预约、付款与退款', url: '/pages/order/index' },
  { icon: 'training', title: '我的课程', note: '剩余课时、上课记录', url: '/pages/training/index?tab=mine' },
  { icon: 'sport', title: '我的活动', note: '球局报名、比赛与成绩', url: '/pages/community/index?view=mine' },
]
const personalServices = [
  { icon: 'finance', title: '钱包与权益', url: '/pages/wallet/index' },
  { icon: 'ticket', title: '我的卡券', url: '/pages/coupon/index' },
  { icon: 'share', title: '邀请好友', url: '/pages/invite/index' },
  { icon: 'profile', title: '资料与设置', url: '/pages/settings/index' },
]
const openWorkbench = () => uni.navigateTo({ url: '/pages/workspace/index' })
const openTestTools = () => uni.navigateTo({ url: '/packages/admin/pages/switch/index' })
onShow(async () => {
  refreshFailed.value = false
  if (session.isAuthenticated) refreshFailed.value = !(await session.hydrate()) && session.isAuthenticated
})
onShareAppMessage(() => ({ title: '一起到延庆金羽打球', path: '/pages/home/index', imageUrl: SHARE_CARD_IMAGES.miniapp }))
onShareTimeline(() => ({ title: '一起到延庆金羽打球', imageUrl: SHARE_CARD_IMAGES.miniapp }))
</script>
<template>
  <view class="page safe-bottom">
    <button class="profile-card" @tap="session.isAuthenticated ? openMemberPage('/pages/settings/index') : requestMemberLogin('/pages/profile/index')">
      <image v-if="avatar && session.isAuthenticated" class="avatar" :src="avatar" mode="aspectFill" />
      <view v-else class="avatar avatar-placeholder"><AppIcon name="profile" :size="42" /></view>
      <view class="profile-copy"><text class="name">{{ session.isAuthenticated ? session.user?.displayName || '我的账号' : '登录，查看我的安排' }}</text><text class="muted">{{ session.isAuthenticated ? '查看和编辑个人资料' : '订单、课程和权益，登录后同步' }}</text></view>
      <AppIcon name="chevron" :size="28" tone="muted" />
    </button>
    <text v-if="refreshFailed" class="refresh-warning">资料暂未同步，已有登录仍然保留，请稍后重试。</text>
    <MemberNextStep />
    <view class="card menu">
      <button v-for="menu in menus" :key="menu.url" class="menu-row" @tap="openMemberPage(menu.url)"><view class="menu-icon"><AppIcon :name="menu.icon" :size="34" /></view><view class="menu-copy"><text class="menu-title">{{ menu.title }}</text><text class="muted">{{ menu.note }}</text></view><AppIcon name="chevron" :size="28" tone="muted" /></button>
    </view>
    <text class="section-title">我的服务</text>
    <view class="card menu">
      <button v-for="service in personalServices" :key="service.url" class="menu-row compact" @tap="openMemberPage(service.url)"><AppIcon :name="service.icon" :size="32" /><text class="menu-copy menu-title">{{ service.title }}</text><AppIcon name="chevron" :size="28" tone="muted" /></button>
    </view>
    <button v-if="session.isAuthenticated && session.isOperator" class="secondary work-entry" @tap="openWorkbench"><AppIcon name="work" :size="32" />进入经营工作台<AppIcon name="chevron" :size="28" /></button>
    <view v-if="isTestEnvironment" class="test-tools"><button @tap="showTestTools = !showTestTools">开发验收工具 {{ showTestTools ? '收起' : '展开' }}</button><button v-if="showTestTools" class="secondary" @tap="openTestTools">切换测试身份</button></view>
  </view>
</template>
<style scoped>
.profile-card { display:flex; align-items:center; gap:20rpx; width:100%; margin:0 0 26rpx; padding:24rpx 0; background:transparent; text-align:left; }
.avatar { width:96rpx; height:96rpx; border-radius:28rpx; flex:none; }
.avatar-placeholder { display:grid; place-items:center; background:var(--color-primary-soft); }
.profile-copy,.menu-copy { flex:1; min-width:0; }
.name { display:block; margin-bottom:8rpx; font-size:35rpx; font-weight:800; overflow-wrap:anywhere; }
.profile-copy .muted { display:block; font-size:24rpx; }
.menu { padding:0 24rpx; }
.menu-row { width:100%; margin:0; padding:24rpx 0; gap:20rpx; text-align:left; border-bottom:1rpx solid var(--color-border); border-radius:0; background:transparent; }
.menu-row:last-child { border-bottom:0; }
.menu-icon { display:grid; place-items:center; width:66rpx; height:66rpx; flex:none; border-radius:20rpx; background:var(--color-primary-soft); }
.menu-title { display:block; color:var(--color-foreground); font-size:29rpx; font-weight:700; }
.menu-copy .muted { display:block; margin-top:6rpx; font-size:24rpx; }
.compact { padding:22rpx 0; }
.work-entry { width:100%; margin-top:24rpx; }
.refresh-warning { display:block; margin-bottom:22rpx; color:var(--color-warning); font-size:24rpx; }
.test-tools { margin-top:36rpx; }
.test-tools button { width:100%; margin:0; font-size:23rpx; color:var(--color-muted); background:transparent; }
</style>
