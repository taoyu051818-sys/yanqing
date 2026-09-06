<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { onHide, onLoad, onPullDownRefresh, onShareAppMessage, onShareTimeline, onShow, onUnload } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { SHARE_CARD_IMAGES } from '../../config/share'
import { endpoints } from '../../services/api'
import { clearAuthSession, getAccessToken, useAccessToken } from '../../services/auth-session'
import { request } from '../../services/http'
import { eventDetailPath, eventShareTitle, eventSignupOpen, parseEventId } from '../../utils/event-detail'
import { eventSignupPath } from '../../utils/event-signup'
import { openMemberPage, openMemberRecord, requestMemberLogin } from '../../utils/member-navigation'
import { money, shortDate } from '../../utils/format'

const id = ref(''), fromShare = ref(false)
const event = ref<Record<string, any> | null>(null)
const context = ref<Record<string, any> | null>(null)
const token = useAccessToken()
const loading = ref(true), contextLoading = ref(false), error = ref(''), contextError = ref('')
const now = ref(Date.now())
let generation = 0, visible = false
const authenticated = computed(() => Boolean(token.value))
const mine = computed(() => authenticated.value ? context.value?.registration : null)
const activeRegistration = computed(() => mine.value && !['CANCELLED', 'REFUNDED'].includes(mine.value.status))
const signupOpen = computed(() => event.value && eventSignupOpen(event.value as any, now.value))
const standings = computed(() => [...(event.value?.standings || [])].sort((a, b) => a.finalRank - b.finalRank))
const actionLabel = computed(() => !authenticated.value ? '登录查看我的报名' : activeRegistration.value ? '查看我的报名' : signupOpen.value ? event.value?.status === 'FULL' ? '组队候补' : '报名这场积分赛' : '报名已结束')
const actionDisabled = computed(() => loading.value || contextLoading.value || (authenticated.value && (Boolean(contextError.value) || (!activeRegistration.value && !signupOpen.value)) ))
function login() { requestMemberLogin(eventDetailPath(id.value, fromShare.value)) }
function act() {
  if (actionDisabled.value) return
  if (!authenticated.value) return login()
  if (activeRegistration.value) return openMemberPage('/pages/community/index?tab=events&view=mine&eventId=' + encodeURIComponent(id.value))
  if (signupOpen.value) openMemberPage(eventSignupPath(id.value))
}
function openOrder() {
  const orderId = mine.value?.order?.id || mine.value?.orderId
  if (orderId) openMemberRecord('/pages/order/index?id=' + encodeURIComponent(orderId))
}
async function load() {
  const run = ++generation
  getAccessToken(); now.value = Date.now(); context.value = null; contextError.value = ''; error.value = ''; contextLoading.value = false
  if (!id.value) { loading.value = false; error.value = '分享链接不完整，请好友重新分享这场赛事。'; uni.stopPullDownRefresh(); return }
  loading.value = true
  try {
    const detail = await endpoints.event(id.value)
    if (run !== generation) return
    event.value = detail
    if (!authenticated.value) return
    contextLoading.value = true
    try {
      const result = await request<Record<string, any> | null>({ url: `/events/${encodeURIComponent(id.value)}/registration/me`, method: 'GET', redirectOnUnauthorized: false })
      if (run === generation && authenticated.value) context.value = result
    } catch (cause: any) {
      if (run !== generation) return
      if (cause?.statusCode === 401) clearAuthSession()
      else contextError.value = cause?.message || '我的报名暂未同步，请重试。'
    }
  } catch (cause: any) {
    if (run !== generation) return
    event.value = null
    error.value = cause?.statusCode === 404 ? '这场赛事暂不可查看，可能已取消或下架。' : cause?.message || '赛事暂未加载，请检查网络后重试。'
  } finally {
    if (run === generation) { loading.value = false; contextLoading.value = false; uni.stopPullDownRefresh() }
  }
}
function applyLink(query?: Record<string, unknown>) {
  const nextId = parseEventId(query?.id), changed = nextId !== id.value
  if (changed) { event.value = null; context.value = null }
  id.value = nextId; fromShare.value = query?.from === 'share'
  return changed
}
// #ifdef H5
async function shareInBrowser() {
  try {
    await uni.setClipboardData({ data: `${window.location.origin}${window.location.pathname}#${eventDetailPath(id.value, true)}` })
    uni.showToast({ title: '赛事邀请链接已复制', icon: 'none' })
  } catch { contextError.value = '复制未完成，请使用浏览器复制本页地址。' }
}
const webPage = getCurrentInstance()?.proxy as { $route?: { path: string; fullPath: string; query: Record<string, unknown> } } | null
watch(() => webPage?.$route?.fullPath, () => {
  const route = webPage?.$route
  if (visible && route?.path === '/pages/event-detail/index' && applyLink(route.query)) void load()
}, { flush: 'post' })
// #endif
onLoad(applyLink)
onShow(() => {
  visible = true
  // #ifdef H5
  if (webPage?.$route?.path === '/pages/event-detail/index') applyLink(webPage.$route.query)
  // #endif
  void load()
})
onHide(() => { visible = false })
onUnload(() => { generation++ })
onPullDownRefresh(() => { void load() })
onShareAppMessage(() => event.value ? { title: eventShareTitle(event.value as any), path: eventDetailPath(event.value.id, true), imageUrl: SHARE_CARD_IMAGES.competition } : { title: '延庆金羽｜一起参加积分赛', path: eventDetailPath(id.value, true), imageUrl: SHARE_CARD_IMAGES.competition })
onShareTimeline(() => ({ title: event.value ? eventShareTitle(event.value as any) : '延庆金羽｜积分赛详情', query: `id=${encodeURIComponent(id.value)}&from=share`, imageUrl: SHARE_CARD_IMAGES.competition }))
</script>

<template>
  <view class="page event-detail-page">
    <view v-if="loading && !event" class="card skeleton detail-skeleton" aria-label="正在加载赛事" />
    <view v-else-if="!event" class="card"><SectionEmpty icon="event" title="暂时无法查看赛事" :description="error" /><button class="secondary" @tap="load">重新加载</button><button class="secondary" @tap="openMemberPage('/pages/home/index')">返回首页</button></view>
    <template v-if="event">
      <view class="card event-hero">
        <view class="row"><text class="eyebrow">金羽积分赛 · 固定双打</text><StatusBadge :value="event.status" /></view>
        <text v-if="fromShare" class="share-context">好友邀你了解这场积分赛</text>
        <text class="event-title">{{ event.name }}</text>
        <view class="detail-line"><AppIcon name="clock" :size="30" /><text>{{ shortDate(event.startsAt) }} · 北京时间</text></view>
        <text class="muted">报名截止 {{ shortDate(event.registrationEndsAt) }}</text>
        <view class="event-facts"><view><text class="fact-value">{{ event.minimumPeople }}人</text><text class="muted">最低成赛人数</text></view><view><text class="fact-value">{{ event.capacityPeople }}人</text><text class="muted">赛事人数上限</text></view><view><text class="fact-value">{{ event.totalRounds }}轮</text><text class="muted">瑞士积分制</text></view></view>
        <text v-if="event.sponsor" class="muted">合作伙伴：{{ event.sponsor }}</text>
      </view>
      <view class="card rules"><text class="section-title">赛制与报名</text><text>固定搭档双打，两人一队，男双、女双、混双同场。</text><text>单局21分，20平不加分；男双对女双让5分，男双对混双让2分，混双对女双让2分。</text><text>可填写两位选手信息，也可在报名时邀请搭档确认。分享赛事卡片不会自动报名。</text><text v-if="event.status === 'FULL'" class="muted">当前已满员，可提交组队候补；晋级后再支付。</text></view>
      <view v-if="standings.length" class="card ranking"><text class="section-title">赛事战绩</text><view v-for="team in standings" :key="team.finalRank + '-' + team.name" class="ranking-row"><text>第{{ team.finalRank }}名 · {{ team.name }}</text><text class="muted">{{ team.points || 0 }}分 · {{ team.wins || 0 }}胜</text></view></view>
      <view v-if="mine" class="card"><text class="section-title">我的报名</text><StatusBadge :value="mine.status" /><text class="muted">{{ mine.name || '本场双打队伍' }}</text><button v-if="mine.order?.id || mine.orderId" class="secondary" @tap="openOrder">查看报名订单</button></view>
      <view v-if="contextError" class="card" role="alert"><text>{{ contextError }}</text><button class="secondary" @tap="load">重试</button></view>
      <view class="event-checkout">
        <view class="fee"><text class="price">{{ money(event.feeCents) }}<text class="price-unit"> / 队</text></text><text class="muted">{{ event.memberFeeCents != null ? '金卡 / 黑卡 ' + money(event.memberFeeCents) + ' / 队；' : '' }}以报名订单金额为准</text></view>
        <view class="checkout-actions">
          <!-- #ifdef H5 -->
          <button class="secondary" @tap="shareInBrowser"><AppIcon name="share" :size="30" />邀请球友</button>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <button class="secondary" open-type="share"><AppIcon name="share" :size="30" />邀请球友</button>
          <!-- #endif -->
          <button class="primary" :disabled="actionDisabled" :loading="contextLoading" @tap="act">{{ actionLabel }}</button>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.event-detail-page{padding-bottom:calc(290rpx + env(safe-area-inset-bottom))}.detail-skeleton{height:420rpx}.event-hero{display:flex;flex-direction:column;gap:20rpx}.eyebrow{font-size:23rpx;font-weight:700;color:var(--color-primary)}.share-context{color:var(--color-primary);font-size:25rpx}.event-title{font-size:42rpx;line-height:1.35;font-weight:800;overflow-wrap:anywhere}.detail-line{display:flex;align-items:center;gap:12rpx;font-size:28rpx}.muted{display:block;line-height:1.6}.event-facts{display:flex;justify-content:space-between;gap:16rpx;padding:22rpx 0;border-top:1rpx solid var(--color-border)}.fact-value{display:block;font-weight:750;font-size:34rpx}.event-facts .muted{font-size:22rpx}.section-title{display:block;font-size:32rpx;font-weight:750;margin-bottom:18rpx}.rules>text:not(.section-title){display:block;font-size:27rpx;line-height:1.75;margin-top:14rpx}.ranking-row{padding:18rpx 0;border-bottom:1rpx solid var(--color-border);overflow-wrap:anywhere}.event-checkout{position:fixed;bottom:0;left:0;right:0;z-index:30;padding:20rpx 28rpx calc(22rpx + env(safe-area-inset-bottom));background:var(--color-card);border-top:1rpx solid var(--color-border);box-sizing:border-box;box-shadow:0 -8rpx 28rpx rgba(18,63,41,.08)}.fee{margin-bottom:18rpx}.price{font-size:38rpx;font-weight:800;color:var(--color-primary)}.price-unit{font-size:24rpx;font-weight:500}.fee .muted{font-size:22rpx}.checkout-actions{display:flex;gap:18rpx}.checkout-actions button{margin:0;min-height:88rpx;font-size:27rpx;display:flex;align-items:center;justify-content:center;gap:10rpx}.checkout-actions .secondary{flex:0 0 230rpx}.checkout-actions .primary{flex:1;min-width:0}
</style>
