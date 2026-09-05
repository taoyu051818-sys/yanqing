<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import MemberNextStep from '../../components/MemberNextStep.vue'
import { useSessionStore } from '../../stores/session'
import { openMemberPage } from '../../utils/member-navigation'
const session = useSessionStore()
onShow(() => { if (session.isAuthenticated) void session.hydrate() })
const services = [
  { icon: 'sport', title: '参加球局', note: '一个人也能约球', url: '/pages/community/index?tab=games&view=browse' },
  { icon: 'training', title: '找课程', note: '成人 · 青少年', url: '/pages/training/index?tab=products' },
  { icon: 'event', title: '报名比赛', note: '查看赛事与赛程', url: '/pages/community/index?tab=events&view=browse' },
]
</script>
<template>
  <view class="page safe-bottom">
    <view class="venue-heading"><view class="venue-icon"><AppIcon name="sport" :size="38" /></view><view><text class="venue-name">延庆金羽羽毛球馆</text><text class="muted">订场、约球、上课，都在这里</text></view></view>
    <view class="booking-hero">
      <text class="hero-eyebrow">今天，来打场球</text>
      <text class="hero-title">先找一片合适的场地</text>
      <text class="hero-copy">选日期，看时段和价格，再决定预约。</text>
      <button class="book-button" @tap="openMemberPage('/pages/booking/index')"><AppIcon name="booking" :size="34" />查看场地与价格<AppIcon name="chevron" :size="28" /></button>
    </view>
    <MemberNextStep />
    <text class="section-title">还想怎么打？</text>
    <view class="service-list card">
      <button v-for="service in services" :key="service.title" class="service-row" @tap="openMemberPage(service.url)">
        <view class="service-icon"><AppIcon :name="service.icon" :size="36" /></view>
        <view class="service-copy"><text class="service-title">{{ service.title }}</text><text class="muted">{{ service.note }}</text></view>
        <AppIcon name="chevron" :size="28" tone="muted" />
      </button>
    </view>
    <view class="other-services"><button @tap="openMemberPage('/pages/membership/index')">会员与充值</button><button @tap="openMemberPage('/pages/shop/index')">羽球装备</button></view>
    <text class="home-note">已经预约或报名？到“我的”查看订单与安排。</text>
  </view>
</template>
<style scoped>
.venue-heading { display:flex; align-items:center; gap:18rpx; margin:6rpx 0 28rpx; }
.venue-icon,.service-icon { display:grid; place-items:center; flex:none; background:var(--color-primary-soft); border-radius:20rpx; width:76rpx; height:76rpx; }
.venue-name { display:block; font-size:34rpx; font-weight:800; }
.venue-heading .muted { display:block; margin-top:5rpx; }
.booking-hero { padding:34rpx 30rpx; margin-bottom:24rpx; border-radius:var(--radius-lg); background:var(--color-primary-strong); color:#fff; }
.hero-eyebrow { display:block; color:#e6d89d; font-size:25rpx; }
.hero-title { display:block; margin-top:14rpx; font-size:40rpx; font-weight:800; line-height:1.35; }
.hero-copy { display:block; margin-top:12rpx; font-size:26rpx; color:#e3eee6; line-height:1.65; }
.book-button { justify-content:space-between; width:100%; padding:23rpx 24rpx; margin:28rpx 0 0; color:var(--color-primary-strong); background:#fff; border-radius:20rpx; font-size:29rpx; }
.service-list { padding:0 24rpx; }
.service-row { width:100%; margin:0; padding:24rpx 0; gap:20rpx; border-bottom:1rpx solid var(--color-border); border-radius:0; background:transparent; text-align:left; }
.service-row:last-child { border-bottom:0; }
.service-copy { flex:1; min-width:0; }
.service-title { display:block; margin-bottom:6rpx; color:var(--color-foreground); font-size:30rpx; font-weight:750; }
.other-services { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16rpx; }
.other-services button { width:100%; margin:0; padding:16rpx; color:var(--color-muted); background:transparent; font-size:26rpx; }
.home-note { display:block; margin:18rpx 0 8rpx; text-align:center; color:var(--color-muted); font-size:24rpx; line-height:1.6; }
</style>
