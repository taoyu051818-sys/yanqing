<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MetricCard from '../../components/MetricCard.vue'
import { endpoints } from '../../services/api'
import { useSessionStore } from '../../stores/session'

const session = useSessionStore()
const loading = ref(false)
const nextGame = ref<any>(null)
const nextEvent = ref<any>(null)
const greeting = computed(() => session.user ? `${session.user.displayName}，好久不见` : '每一次挥拍，都算数')

const shortcuts = [
  { title: '在线订场', subtitle: '20片场地实时可订', url: '/pages/booking/index', tab: true },
  { title: '找球搭子', subtitle: '按水平参加球局', url: '/pages/community/index', tab: true },
  { title: '培训报名', subtitle: '成人与青少课程', url: '/pages/training/index' },
  { title: '异业权益', subtitle: '吃喝玩乐联盟券', url: '/pages/coupon/index' },
  { title: '会员权益', subtitle: '会员卡与账户充值', url: '/pages/membership/index' },
  { title: '金羽小店', subtitle: '羽球耗材与装备', url: '/pages/shop/index' },
]

const go = (item: typeof shortcuts[number]) => item.tab
  ? uni.switchTab({ url: item.url })
  : uni.navigateTo({ url: item.url })
const openLogin = () => uni.navigateTo({ url: '/pages/login/index' })
const openCommunity = () => uni.switchTab({ url: '/pages/community/index' })

onShow(async () => {
  if (!session.user && !(await session.hydrate())) return
  loading.value = true
  try {
    const [games, events] = await Promise.all([endpoints.games(), endpoints.events()])
    nextGame.value = games.find((item) => ['OPEN', 'PUBLISHED'].includes(item.status)) || games[0]
    nextEvent.value = events.find((item) => ['REGISTRATION', 'PUBLISHED'].includes(item.status)) || events[0]
  } catch { /* 首页允许降级 */ }
  finally { loading.value = false }
})
</script>

<template>
  <view class="page safe-bottom">
    <view class="hero">
      <text class="eyebrow">YANQING GOLDEN FEATHER</text>
      <text class="headline">{{ greeting }}</text>
      <text class="hero-copy">延庆人的羽毛球生活方式，从订一片场开始。</text>
      <button v-if="!session.isAuthenticated" class="hero-button" @tap="openLogin">微信一键登录</button>
      <view v-else class="identity"><text>{{ session.roles.join(' · ') || 'MEMBER' }}</text></view>
    </view>

    <view class="grid-2 shortcut-grid">
      <view v-for="item in shortcuts" :key="item.title" class="shortcut" @tap="go(item)">
        <text class="shortcut-title">{{ item.title }}</text>
        <text class="muted">{{ item.subtitle }}</text>
        <text class="arrow">→</text>
      </view>
    </view>

    <view class="section-title">本周热场</view>
    <view class="grid-2">
      <MetricCard label="固定场地" value="20片" note="覆盖早中晚时段" />
      <MetricCard label="金羽积分赛" value="5轮" note="固定双打瑞士制" />
    </view>

    <view v-if="nextGame" class="card feature" @tap="openCommunity">
      <view class="row"><text class="pill">下一场球局</text><text class="muted">{{ nextGame.capacity }}人上限</text></view>
      <text class="feature-title">{{ nextGame.title }}</text>
      <text class="muted">{{ nextGame.description || '主理人组织，按实际签到结算激励' }}</text>
    </view>
    <view v-if="nextEvent" class="card feature" @tap="openCommunity">
      <view class="row"><text class="pill">金羽积分赛</text><text class="muted">{{ nextEvent.totalRounds || 5 }}轮</text></view>
      <text class="feature-title">{{ nextEvent.name }}</text>
      <text class="muted">24人开赛 · 48人封顶 · 成人赛事积分独立累计</text>
    </view>
  </view>
</template>

<style scoped>
.hero { padding: 44rpx 36rpx; margin: 8rpx 0 28rpx; color: #fff; background: linear-gradient(145deg,#123d27,#1d7447 65%,#c9a846); border-radius: 36rpx; box-shadow: 0 24rpx 60rpx rgba(15,70,40,.2); }
.eyebrow { display: block; opacity: .7; font-size: 19rpx; letter-spacing: 3rpx; }
.headline { display: block; margin-top: 28rpx; font-size: 46rpx; font-weight: 800; }
.hero-copy { display: block; max-width: 540rpx; margin-top: 14rpx; opacity: .85; font-size: 27rpx; line-height: 1.65; }
.hero-button { width: 260rpx; margin: 34rpx 0 0; color: #153f29; background: #fff; border-radius: 18rpx; font-size: 26rpx; }
.identity { display: inline-flex; margin-top: 28rpx; padding: 10rpx 18rpx; background: rgba(255,255,255,.16); border-radius: 999rpx; font-size: 21rpx; }
.shortcut-grid { margin-bottom: 20rpx; }
.shortcut { position: relative; min-height: 140rpx; padding: 24rpx; background: #fff; border-radius: 24rpx; }
.shortcut-title,.feature-title { display: block; margin-bottom: 10rpx; font-size: 31rpx; font-weight: 700; }
.arrow { position: absolute; right: 22rpx; bottom: 18rpx; color: #17653d; }
.feature-title { margin-top: 26rpx; }
</style>
