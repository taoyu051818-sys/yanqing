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
const roleLabel: Record<string, string> = {
  MEMBER: '会员',
  COACH: '教练',
  FRONT_DESK: '前台',
  HOST: '球局主理人',
  MERCHANT: '联盟商户',
  FINANCE: '财务',
  ADMIN: '管理员',
  SUPER_ADMIN: '超级管理员',
}
const displayRoles = computed(() =>
  session.roles.map((role) => roleLabel[role] || '其他岗位').join(' · '),
)

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
const primaryAction = () => session.isAuthenticated
  ? uni.switchTab({ url: '/pages/booking/index' })
  : openLogin()

onShow(async () => {
  // A share can hot-open the home page while the recipient is already logged
  // in. In that case App.onShow has just captured the inviter, so consume it
  // immediately instead of waiting for a later relaunch or profile visit.
  if (session.user) await session.applyPendingReferral()
  else if (!(await session.hydrate())) return
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
      <view class="hero-topline">
        <text class="eyebrow">YANQING GOLDEN FEATHER</text>
        <text class="open-status">今日营业</text>
      </view>
      <text class="headline">{{ greeting }}</text>
      <text class="hero-copy">延庆人的羽毛球生活方式，从订一片场开始。</text>
      <button class="hero-button" @tap="primaryAction">{{ session.isAuthenticated ? '立即订场' : '微信一键登录' }}</button>
      <view v-if="session.isAuthenticated" class="identity"><text>{{ displayRoles || '会员' }}</text></view>
    </view>

    <view class="grid-2 shortcut-grid">
      <view v-for="(item, index) in shortcuts" :key="item.title" class="shortcut" role="button" tabindex="0" :aria-label="`${item.title}，${item.subtitle}`" hover-class="is-pressed" @tap="go(item)" @keyup.enter="go(item)">
        <text class="shortcut-index">0{{ index + 1 }}</text>
        <text class="shortcut-title">{{ item.title }}</text>
        <text class="muted">{{ item.subtitle }}</text>
        <text class="arrow" aria-hidden="true">›</text>
      </view>
    </view>

    <view class="section-title">本周热场</view>
    <view class="grid-2">
      <MetricCard label="固定场地" value="20片" note="覆盖早中晚时段" />
      <MetricCard label="金羽积分赛" value="5轮" note="固定双打瑞士制" />
    </view>

    <view v-if="nextGame" class="card feature" role="button" tabindex="0" aria-label="查看下一场球局" hover-class="is-pressed" @tap="openCommunity" @keyup.enter="openCommunity">
      <view class="row"><text class="pill">下一场球局</text><text class="muted">{{ nextGame.capacity }}人上限</text></view>
      <text class="feature-title">{{ nextGame.title }}</text>
      <text class="muted">{{ nextGame.description || '主理人组织，按实际签到结算激励' }}</text>
    </view>
    <view v-if="nextEvent" class="card feature" role="button" tabindex="0" aria-label="查看金羽积分赛" hover-class="is-pressed" @tap="openCommunity" @keyup.enter="openCommunity">
      <view class="row"><text class="pill">金羽积分赛</text><text class="muted">{{ nextEvent.totalRounds || 5 }}轮</text></view>
      <text class="feature-title">{{ nextEvent.name }}</text>
      <text class="muted">24人开赛 · 48人封顶 · 成人赛事积分独立累计</text>
    </view>
  </view>
</template>

<style scoped>
.hero { position: relative; isolation: isolate; overflow: hidden; padding: 42rpx 36rpx 38rpx; margin: 8rpx 0 28rpx; color: #fff; background: linear-gradient(145deg,#103b27 0%,#17653d 62%,#a98226 125%); border: 1rpx solid rgba(255,255,255,.14); border-radius: 36rpx; box-shadow: 0 24rpx 60rpx rgba(15,70,40,.2); }
.hero::after { position: absolute; z-index: -1; right: -96rpx; bottom: -116rpx; width: 300rpx; height: 300rpx; border: 42rpx solid rgba(255,255,255,.055); border-radius: 50%; content: ''; }
.hero-topline { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.eyebrow { display: block; opacity: .72; font-size: 19rpx; letter-spacing: 3rpx; }
.open-status { flex: 0 0 auto; padding: 6rpx 13rpx; color: #fff3c8; background: rgba(255,255,255,.12); border: 1rpx solid rgba(255,243,200,.22); border-radius: 999rpx; font-size: 20rpx; }
.headline { display: block; max-width: 570rpx; margin-top: 30rpx; font-size: 46rpx; font-weight: 850; line-height: 1.25; letter-spacing: -1rpx; overflow-wrap: anywhere; }
.hero-copy { display: block; max-width: 540rpx; margin-top: 14rpx; opacity: .85; font-size: 27rpx; line-height: 1.65; }
.hero-button { width: 246rpx; margin: 30rpx 0 0; color: #123f29; background: #fff; border-radius: 20rpx; box-shadow: 0 10rpx 26rpx rgba(0,0,0,.12); font-size: 26rpx; }
.identity { display: inline-flex; max-width: 100%; margin-top: 18rpx; padding: 8rpx 16rpx; background: rgba(255,255,255,.14); border-radius: 999rpx; font-size: 20rpx; line-height: 1.5; overflow-wrap: anywhere; }
.shortcut-grid { margin-bottom: 20rpx; }
.shortcut { position: relative; box-sizing: border-box; min-height: 166rpx; padding: 24rpx; overflow: hidden; background: #fff; border: 1rpx solid rgba(28,63,43,.09); border-radius: 24rpx; box-shadow: 0 7rpx 22rpx rgba(26,56,38,.045); }
.shortcut-index { display: block; margin-bottom: 18rpx; color: #a07b20; font-size: 19rpx; font-weight: 750; letter-spacing: 2rpx; }
.shortcut-title,.feature-title { display: block; margin-bottom: 8rpx; color: #173b29; font-size: 31rpx; font-weight: 800; line-height: 1.35; overflow-wrap: anywhere; }
.shortcut .muted { display: block; padding-right: 30rpx; font-size: 23rpx; }
.arrow { position: absolute; right: 20rpx; bottom: 15rpx; color: #17653d; font-size: 38rpx; line-height: 1; }
.feature { position: relative; border-left: 6rpx solid #b68b22; }
.feature-title { margin-top: 24rpx; }
.is-pressed { opacity: .84; }
@media (max-width: 360px) {
  .hero { padding: 36rpx 30rpx; }
  .headline { font-size: 41rpx; }
  .shortcut { min-height: 156rpx; padding: 22rpx; }
}
</style>
