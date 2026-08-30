<script setup lang="ts">
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useSessionStore } from '../../stores/session'
import { money } from '../../utils/format'
import { isMockMode } from '../../services/http'

const session = useSessionStore()
const accountLabel: Record<string, string> = {
  CASH_PRINCIPAL: '现金本金', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币',
  EVENT_POINTS: '成人赛事积分', GROWTH_POINTS: '青少年成长积分', YOUTH_GROWTH_POINTS: '青少年成长积分',
}
const roleLabel: Record<string, string> = {
  MEMBER: '会员', COACH: '教练', FRONT_DESK: '前台', HOST: '主理人', MERCHANT: '联盟商户',
  FINANCE: '财务', ADMIN: '管理员', SUPER_ADMIN: '超级管理员',
}
const displayRoles = computed(() => session.roles.map((role) => roleLabel[role] || role).join(' · '))
const menus = computed(() => [
  ...(isMockMode ? [{ title: '管理员演示通道', subtitle: '切换会员、前台、教练、主理人、商户和管理端', url: '/packages/admin/pages/switch/index' }] : []),
  { title: '我的订单', subtitle: '支付、退款及消费记录', url: '/pages/order/index' },
  { title: '五账户明细', subtitle: '本金、赠送、羽球币、赛事积分、成长积分', url: '/pages/wallet/index' },
  { title: '培训中心', subtitle: '课包与独立消课台账', url: '/pages/training/index' },
  { title: '联盟权益', subtitle: '唯一券码与本地商户', url: '/pages/coupon/index' },
  { title: '会员卡与充值', subtitle: '升级权益或充值现金本金', url: '/pages/membership/index' },
  { title: '金羽小店', subtitle: '球、手胶、饮品与装备', url: '/pages/shop/index' },
  ...(session.isOperator ? [{ title: '员工经营中心', subtitle: '按营业对象进入今日营业、交易、培训和结算', url: '/pages/workspace/index' }] : []),
])

function logout() {
  session.logout()
  uni.reLaunch({ url: '/pages/login/index' })
}
const openLogin = () => uni.navigateTo({ url: '/pages/login/index' })
const openPage = (url: string) => uni.navigateTo({ url })
onShow(() => session.hydrate())
</script>

<template>
  <view class="page safe-bottom">
    <view v-if="session.user" class="profile-card">
      <view class="avatar">{{ session.user.displayName?.slice(0, 1) }}</view>
      <view class="profile-copy">
        <text class="name">{{ session.user.displayName }}</text>
        <text class="muted">{{ displayRoles || '会员' }}</text>
      </view>
      <text class="level">{{ (session.user.memberProfile as any)?.level || 'BASIC' }}</text>
    </view>
    <view v-else class="profile-card" @tap="openLogin">
      <view class="avatar">羽</view><view class="profile-copy"><text class="name">登录后查看会员权益</text><text class="muted">点击微信一键登录</text></view>
    </view>

    <view v-if="session.user?.accounts?.length" class="account-strip">
      <view v-for="account in session.user.accounts" :key="account.id" class="account">
        <text class="account-value">{{ account.type.includes('BALANCE') || account.type.includes('CASH') ? money(account.balance) : account.balance }}</text>
        <text class="muted">{{ accountLabel[account.type] }}</text>
      </view>
    </view>

    <view class="menu card">
      <view v-for="menu in menus" :key="menu.url" class="menu-item" @tap="openPage(menu.url)">
        <view><text class="menu-title">{{ menu.title }}</text><text class="muted">{{ menu.subtitle }}</text></view><text>›</text>
      </view>
    </view>
    <button v-if="session.user" class="danger" @tap="logout">退出登录</button>
  </view>
</template>

<style scoped>
.profile-card { display: flex; align-items: center; padding: 40rpx 32rpx; margin-bottom: 22rpx; color: #fff; background: linear-gradient(145deg,#153c29,#236d48); border-radius: 30rpx; }
.avatar { display: grid; flex: 0 0 auto; place-items: center; width: 96rpx; height: 96rpx; margin-right: 24rpx; color: #17422d; background: #e8d28a; border-radius: 30rpx; font-size: 38rpx; font-weight: 800; }
.profile-copy { flex: 1; min-width: 0; }
.profile-copy .muted { display: block; margin-top: 10rpx; color: rgba(255,255,255,.72); }
.name { display: block; font-size: 35rpx; font-weight: 800; }
.level { padding: 8rpx 14rpx; color: #e8d28a; border: 1rpx solid rgba(232,210,138,.5); border-radius: 999rpx; font-size: 20rpx; }
.account-strip { display: flex; gap: 14rpx; overflow-x: auto; padding: 6rpx 0 24rpx; }
.account { flex: 0 0 200rpx; padding: 24rpx; background: #fff; border-radius: 22rpx; }
.account-value { display: block; margin-bottom: 10rpx; color: #184c30; font-size: 29rpx; font-weight: 800; }
.menu { padding: 0 28rpx; }
.menu-item { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 0; border-bottom: 1rpx solid #edf0ed; }
.menu-item:last-child { border: none; }
.menu-title { display: block; margin-bottom: 8rpx; font-weight: 700; }
</style>
