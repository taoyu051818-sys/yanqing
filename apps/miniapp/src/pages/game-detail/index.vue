<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { onHide, onLoad, onPullDownRefresh, onShareAppMessage, onShareTimeline, onShow, onUnload } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import SectionEmpty from '../../components/SectionEmpty.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { SHARE_CARD_IMAGES } from '../../config/share'
import { endpoints } from '../../services/api'
import { clearAuthSession, getAccessToken, useAccessToken } from '../../services/auth-session'
import { resolveApiAssetUrl } from '../../services/http'
import type { GameDetail, GameParticipants } from '../../types/game'
import { dateTimeRange, money, venueDateLabel, venueTimeRange } from '../../utils/format'
import { gameAction, gameDetailPath, gameLevelLabel, gameShareTitle, parseGameId } from '../../utils/game-detail'
import { openMemberPage, openMemberRecord, requestMemberLogin } from '../../utils/member-navigation'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const id = ref('')
const fromShare = ref(false)
const game = ref<GameDetail | null>(null)
const members = ref<GameParticipants | null>(null)
const token = useAccessToken()
const loading = ref(true)
const membersLoading = ref(false)
const submitting = ref(false)
const error = ref('')
const memberError = ref('')
const actionError = ref('')
const missing = ref(false)
const failedAvatars = ref<Record<string, boolean>>({})
const now = ref(Date.now())
let generation = 0
let visible = false

const authenticated = computed(() => Boolean(token.value))
const mine = computed(() => authenticated.value ? members.value?.myRegistration ?? null : null)
const action = computed(() => game.value ? gameAction(game.value, mine.value, authenticated.value, now.value) : { kind: 'none', label: '暂不可报名' })
const actionDisabled = computed(() => submitting.value || membersLoading.value || (authenticated.value && !members.value) || action.value.kind === 'none')
const remaining = computed(() => Math.max(0, (game.value?.capacity || 0) - (game.value?.occupiedCount || 0)))
const waitlisting = computed(() => game.value?.status === 'FULL' || remaining.value === 0 || Number(game.value?.waitlistCount) > 0)
const myStatus = computed(() => ({
  REGISTERED: '已占位，待支付', PAID: '报名已确认', CHECKED_IN: '已到场签到',
  COMPLETED: '本场已完成', WAITLISTED: '正在候补', CANCELLED: '报名已取消', REFUNDED: '报名已退款',
}[mine.value?.status || ''] || '报名状态同步中'))
const myDescription = computed(() => {
  if (mine.value?.status === 'WAITLISTED') return `当前候补第 ${mine.value.waitlistPosition || '—'} 位。候补不收费；有名额释放并按顺序晋级后，请回来查看并支付订单。`
  if (mine.value?.order?.status === 'PENDING') return '支付后才进入正式名单。你可以在订单中支付或取消；未付款不代表报名成功。'
  if (mine.value?.order?.status === 'REFUND_PENDING') return '退款正在处理中，请在订单中查看处理进度。'
  if (mine.value?.status === 'PAID') return '已进入球友名单，请按球局时间到场。订单中可查看支付和售后信息。'
  if (mine.value?.status === 'CHECKED_IN') return '已完成到场签到，祝你打球愉快。'
  if (mine.value?.status === 'COMPLETED') return '这场球局已完成，订单记录仍可查看。'
  return '请以订单的最新状态为准。'
})

function login() { requestMemberLogin(gameDetailPath(id.value, fromShare.value)) }
function openOrder(orderId = mine.value?.order?.id) {
  if (orderId) openMemberRecord(`/pages/order/index?id=${encodeURIComponent(orderId)}`)
}
function browseGames() { openMemberPage('/pages/community/index?tab=games&view=browse') }
function avatar(url: string | null | undefined) { return url && !failedAvatars.value[url] ? resolveApiAssetUrl(url) : '' }

async function load() {
  const run = ++generation
  now.value = Date.now()
  getAccessToken()
  members.value = null
  error.value = ''
  memberError.value = ''
  missing.value = !id.value
  if (!id.value) { loading.value = false; uni.stopPullDownRefresh(); return }
  loading.value = true
  try {
    const detail = await endpoints.game(id.value)
    if (run !== generation) return
    game.value = detail
    loading.value = false
    if (!authenticated.value) return
    membersLoading.value = true
    try {
      const context = await endpoints.gameParticipants(id.value)
      if (run === generation && authenticated.value) members.value = context
    } catch (cause: any) {
      if (run !== generation) return
      if (cause?.statusCode === 401) {
        clearAuthSession()
        memberError.value = '登录已过期，请重新登录后查看球友。'
      } else memberError.value = cause?.message || '球友名单暂未同步，请重试。'
    }
  } catch (cause: any) {
    if (run !== generation) return
    game.value = null
    missing.value = cause?.statusCode === 404
    error.value = cause?.message || '球局暂未加载，请检查网络后重试。'
  } finally {
    if (run === generation) { loading.value = false; membersLoading.value = false; uni.stopPullDownRefresh() }
  }
}

async function act() {
  if (submitting.value || loading.value || membersLoading.value) return
  if (action.value.kind === 'login') return login()
  if (action.value.kind === 'order') return openOrder()
  if (action.value.kind !== 'join' || !game.value || !members.value) return
  submitting.value = true
  actionError.value = ''
  try {
    const confirmation = await uni.showModal({
      title: waitlisting.value ? '加入候补队列' : '确认报名球局',
      content: `${game.value.title}\n${dateTimeRange(game.value.startsAt, game.value.endsAt)} · ${money(game.value.feeCents)} / 人\n${waitlisting.value ? '候补期间不收费，晋级后再支付。' : '提交后生成待支付订单，支付后才确认报名。'}`,
      confirmText: waitlisting.value ? '确认候补' : '确认报名',
    })
    if (!confirmation.confirm) return
    const result: any = await withPendingCreationKey('game.register', { gameId: id.value, sourceChannel: 'MINI_PROGRAM' }, (key) => endpoints.registerGame(id.value, key))
    if (result?.status === 'WAITLISTED' || result?.registration?.status === 'WAITLISTED') {
      await load()
      uni.showToast({ title: '已加入候补，暂不收费', icon: 'none' })
    } else if (result?.id) {
      openOrder(result.id)
    } else {
      await load()
      actionError.value = '报名状态已更新，请核对下方的我的报名。'
    }
  } catch (cause: any) {
    actionError.value = cause?.message || '报名未完成，请重试。'
    if (cause?.statusCode === 401) { clearAuthSession(); login() }
    else await load()
  } finally { submitting.value = false }
}

// #ifdef H5
async function shareInBrowser() {
  try {
    const url = `${window.location.origin}${window.location.pathname}#${gameDetailPath(id.value, true)}`
    await uni.setClipboardData({ data: url })
    uni.showToast({ title: '球局邀请链接已复制', icon: 'none' })
  } catch { actionError.value = '复制未完成，请使用浏览器复制本页地址。' }
}
// #endif

function applyLink(options?: Record<string, unknown>) {
  const nextId = parseGameId(options?.id)
  const changed = nextId !== id.value
  if (changed) { game.value = null; members.value = null; actionError.value = ''; failedAvatars.value = {} }
  id.value = nextId
  fromShare.value = options?.from === 'share'
  return changed
}

// H5 may reuse this page for a same-path URL with a different game ID.
// Observe the installed router's reactive route without shipping a web router to WeChat.
// #ifdef H5
const webPage = getCurrentInstance()?.proxy as { $route?: { path: string; fullPath: string; query: Record<string, unknown> } } | null
watch(() => webPage?.$route?.fullPath, () => {
  const route = webPage?.$route
  if (visible && route?.path === '/pages/game-detail/index' && applyLink(route.query)) void load()
}, { flush: 'post' })
// #endif

onLoad(applyLink)
onShow(() => {
  visible = true
  // #ifdef H5
  if (webPage?.$route?.path === '/pages/game-detail/index') applyLink(webPage.$route.query)
  // #endif
  void load()
})
onHide(() => { visible = false })
onPullDownRefresh(() => { void load() })
onUnload(() => { generation += 1 })
onShareAppMessage(() => game.value ? {
  title: gameShareTitle(game.value), path: gameDetailPath(game.value.id, true), imageUrl: SHARE_CARD_IMAGES.competition,
} : { title: '延庆金羽｜一起打球', path: '/pages/home/index', imageUrl: SHARE_CARD_IMAGES.miniapp })
onShareTimeline(() => game.value ? {
  title: gameShareTitle(game.value), query: `id=${encodeURIComponent(game.value.id)}&from=share`, imageUrl: SHARE_CARD_IMAGES.competition,
} : { title: '延庆金羽｜球局详情', imageUrl: SHARE_CARD_IMAGES.competition })
</script>

<template>
  <view class="page game-detail-page">
    <view v-if="loading" aria-label="正在加载球局" class="detail-loading">
      <view class="card skeleton hero-skeleton" /><view class="card skeleton roster-skeleton" />
    </view>
    <view v-else-if="!game" class="card unavailable">
      <SectionEmpty icon="sport" :title="missing ? '暂时无法查看这场球局' : '球局加载失败'" :description="missing ? '邀请链接无效，或球局尚未发布。可以请好友重新分享，或看看其他球局。' : error" />
      <button v-if="!missing" class="primary" @tap="load"><AppIcon name="refresh" tone="inverse" :size="30" />重新加载</button>
      <button class="secondary" @tap="browseGames">查看其他球局</button>
    </view>
    <template v-else>
      <view v-if="fromShare" class="invitation-note"><AppIcon name="share" :size="30" /><text>好友邀你一起打球，先看看这场安排</text></view>
      <view class="card detail-hero">
        <view class="hero-eyebrow"><text>日常球局</text><StatusBadge :value="game.status" /></view>
        <text class="game-title" role="heading" aria-level="1">{{ game.title }}</text>
        <view class="tag-list"><text class="pill">{{ gameLevelLabel(game.level) }}</text><text v-if="game.newcomerOnly" class="pill">仅限新客</text></view>
        <view class="game-facts">
          <view class="fact"><AppIcon name="clock" :size="34" /><view><text class="fact-label">打球时间（北京时间）</text><text class="fact-value">{{ venueDateLabel(game.startsAt) }}</text><text class="fact-caption">{{ venueTimeRange(game.startsAt, game.endsAt) }}</text></view></view>
          <view class="fact"><AppIcon name="venue" :size="34" /><view><text class="fact-label">球场安排</text><text class="fact-value">{{ game.courtNames.length ? game.courtNames.join('、') : '待主理人安排场地' }}</text></view></view>
        </view>
        <view class="fee-row"><view><text class="fact-label">报名费用</text><text class="fee">{{ money(game.feeCents) }}<text class="fee-unit"> / 人</text></text></view><text class="fee-hint">候补不收费<br />支付后确认报名</text></view>
      </view>

      <view v-if="['CANCELLED', 'COMPLETED', 'IN_PROGRESS'].includes(game.status)" class="state-note" role="status"><AppIcon name="info" :size="32" /><text>{{ game.status === 'CANCELLED' ? '这场球局已取消，不再接受报名。已报名球友请查看订单及退款进度。' : game.status === 'COMPLETED' ? '这场球局已结束，可以回看报名记录。' : '球局正在进行，报名已结束。' }}</text></view>

      <view v-if="mine" class="card my-registration" role="status" aria-live="polite">
        <text class="section-heading">我的报名 · {{ myStatus }}</text>
        <text class="body-copy">{{ myDescription }}</text>
        <button v-if="mine.order?.id" class="secondary" @tap="openOrder()"><AppIcon name="receipt" :size="30" />查看这笔订单</button>
      </view>

      <view class="card roster-card">
        <view class="section-header"><text class="section-heading" role="heading" aria-level="2">一起打球的球友</text><text class="count-label">{{ game.confirmedCount }} 人已确认</text></view>
        <view class="capacity-track"><view :style="{ width: `${Math.min(100, game.occupiedCount / Math.max(1, game.capacity) * 100)}%` }" /></view>
        <text class="capacity-copy">{{ game.occupiedCount }} / {{ game.capacity }} 个名额已占用<text v-if="game.pendingCount">，含 {{ game.pendingCount }} 人待支付</text><text v-if="game.waitlistCount">，{{ game.waitlistCount }} 人候补</text></text>
        <view v-if="!authenticated" class="roster-login">
          <view class="roster-lock"><AppIcon name="members" :size="44" /></view>
          <text class="section-heading">登录后看看谁会来</text>
          <text class="body-copy">仅向已登录球友展示昵称和头像，不公开联系方式。</text>
          <text v-if="memberError" class="error-copy">{{ memberError }}</text>
          <button class="secondary" @tap="login">登录查看球友</button>
        </view>
        <view v-else-if="membersLoading" class="roster-loading" role="status">正在同步球友名单…</view>
        <view v-else-if="memberError" class="roster-login" role="alert"><text class="error-copy">{{ memberError }}</text><button class="secondary" @tap="load">重试同步名单</button></view>
        <view v-else-if="members?.participants.length" class="member-grid">
          <view v-for="(person, index) in members.participants" :key="index" class="member-item">
            <image v-if="avatar(person.avatarUrl)" class="avatar" :src="avatar(person.avatarUrl)" mode="aspectFill" :alt="`${person.displayName}的头像`" @error="failedAvatars[person.avatarUrl!] = true" />
            <view v-else class="avatar avatar-fallback" aria-hidden="true">{{ person.displayName.slice(0, 1) || '羽' }}</view>
            <text class="member-name">{{ person.displayName }}</text><text v-if="person.isMe" class="me-label">我</text>
          </view>
        </view>
        <text v-else class="empty-roster">暂时没有已确认报名的球友。支付成功后会出现在这里。</text>
      </view>

      <view class="card host-card">
        <view class="host-row"><image v-if="avatar(game.host?.avatarUrl)" class="avatar host-avatar" :src="avatar(game.host?.avatarUrl)" mode="aspectFill" alt="主理人头像" @error="failedAvatars[game.host!.avatarUrl!] = true" /><view v-else class="avatar host-avatar avatar-fallback"><AppIcon name="sport" :size="34" /></view><view class="host-name"><text class="fact-label">本场主理人</text><text class="section-heading">{{ game.host?.displayName || '待主理人确认' }}</text></view></view>
        <view class="description-section"><text class="section-heading" role="heading" aria-level="2">球局说明</text><text class="body-copy description">{{ game.description || '主理人暂未填写补充说明。请以本页时间、费用和场地安排为准。' }}</text></view>
      </view>
      <button class="secondary browse-button" @tap="browseGames">查看其他球局<AppIcon name="chevron" :size="30" /></button>

      <view class="detail-actions">
        <text v-if="actionError" class="error-copy action-error" role="alert">{{ actionError }}</text>
        <view class="action-buttons">
          <!-- #ifdef H5 -->
          <button class="secondary share-button" @tap="shareInBrowser"><AppIcon name="share" :size="30" /><text>邀请球友</text></button>
          <!-- #endif -->
          <!-- #ifndef H5 -->
          <button class="secondary share-button" open-type="share"><AppIcon name="share" :size="30" /><text>邀请球友</text></button>
          <!-- #endif -->
          <button class="primary main-action" role="button" :aria-disabled="actionDisabled" :loading="submitting" :disabled="actionDisabled" @tap="act">{{ action.label }}</button>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.game-detail-page { padding-bottom: calc(230rpx + env(safe-area-inset-bottom)); }
.invitation-note { display: flex; align-items: center; gap: 12rpx; margin-bottom: 22rpx; color: var(--color-primary-strong); font-size: 25rpx; }
.invitation-note text, .fact > view, .host-name { min-width: 0; overflow-wrap: anywhere; }
.detail-hero { padding: 32rpx; border-top: 6rpx solid var(--color-primary); }
.hero-eyebrow, .section-header, .fee-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14rpx; }
.hero-eyebrow { color: var(--color-muted); font-size: 25rpx; }
.game-title { display: block; margin: 20rpx 0; font-size: 44rpx; font-weight: 800; line-height: 1.35; overflow-wrap: anywhere; }
.tag-list { display: flex; flex-wrap: wrap; gap: 12rpx; }
.game-facts { display: grid; gap: 26rpx; margin: 32rpx 0; }
.fact { display: flex; align-items: flex-start; gap: 18rpx; }
.fact > .app-icon { margin-top: 4rpx; }
.fact-label, .fact-value, .fact-caption { display: block; }
.fact-label { color: var(--color-muted); font-size: 25rpx; }
.fact-value { margin-top: 4rpx; font-size: 30rpx; font-weight: 650; }
.fact-caption { color: var(--color-muted); font-size: 25rpx; margin-top: 2rpx; }
.fee-row { padding-top: 24rpx; border-top: 1rpx solid var(--color-border); }
.fee { display: block; color: var(--color-primary-strong); font-size: 44rpx; font-weight: 800; font-variant-numeric: tabular-nums; }
.fee-unit { font-size: 25rpx; font-weight: 500; color: var(--color-muted); }
.fee-hint { color: var(--color-muted); font-size: 24rpx; text-align: right; line-height: 1.7; }
.section-heading { font-size: 30rpx; font-weight: 750; overflow-wrap: anywhere; }
.count-label { color: var(--color-primary); font-size: 25rpx; font-weight: 650; }
.body-copy { display: block; margin-top: 14rpx; font-size: 28rpx; line-height: 1.65; color: var(--color-muted); overflow-wrap: anywhere; }
.capacity-track { height: 10rpx; margin: 22rpx 0 14rpx; overflow: hidden; border-radius: 10rpx; background: var(--color-primary-soft); }
.capacity-track > view { height: 100%; background: var(--color-primary); border-radius: inherit; }
.capacity-copy { display: block; font-size: 25rpx; line-height: 1.6; color: var(--color-muted); }
.roster-login { margin-top: 24rpx; padding: 26rpx 20rpx; border-radius: 20rpx; background: var(--color-surface-subtle); text-align: center; }
.roster-lock { width: 76rpx; height: 76rpx; display: grid; place-items: center; margin: 0 auto 16rpx; border-radius: 50%; background: var(--color-primary-soft); }
.roster-login button, .my-registration button { margin-top: 22rpx; }
.member-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28rpx 16rpx; margin-top: 30rpx; }
.member-item { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 10rpx; text-align: center; }
.avatar { display: block; flex: 0 0 auto; width: 88rpx; height: 88rpx; border-radius: 50%; }
.avatar-fallback { display: flex; align-items: center; justify-content: center; background: var(--color-primary-soft); color: var(--color-primary-strong); font-size: 32rpx; font-weight: 750; }
.member-name { width: 100%; color: var(--color-foreground); font-size: 26rpx; line-height: 1.5; overflow-wrap: anywhere; }
.me-label { font-size: 22rpx; color: var(--color-primary); background: var(--color-primary-soft); border-radius: 8rpx; padding: 0 12rpx; }
.empty-roster, .roster-loading { display: block; padding: 28rpx 0 4rpx; font-size: 28rpx; line-height: 1.6; color: var(--color-muted); }
.state-note { display: flex; gap: 16rpx; align-items: flex-start; margin-bottom: 22rpx; padding: 24rpx; background: var(--color-primary-soft); border-radius: 20rpx; font-size: 28rpx; line-height: 1.6; }
.state-note text { flex: 1; min-width: 0; }
.host-row { display: flex; align-items: center; gap: 20rpx; }
.host-avatar { width: 76rpx; height: 76rpx; }
.host-name .section-heading { display: block; margin-top: 4rpx; }
.description-section { margin-top: 28rpx; padding-top: 24rpx; border-top: 1rpx solid var(--color-border); }
.description { white-space: pre-wrap; }
.error-copy { display: block; color: var(--color-danger); font-size: 26rpx; line-height: 1.6; overflow-wrap: anywhere; }
.action-error { margin-bottom: 14rpx; max-height: 100rpx; overflow-y: auto; }
.detail-actions { position: fixed; bottom: 0; left: 0; right: 0; z-index: 10; padding: 20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background: var(--color-surface); border-top: 1rpx solid var(--color-border); box-shadow: 0 -6rpx 24rpx rgba(26,56,38,.04); }
.action-buttons { display: flex; align-items: stretch; gap: 16rpx; }
.share-button { flex: 0 0 34%; }
.main-action { flex: 1; min-width: 0 !important; }
.action-buttons button { margin: 0; min-height: 92rpx; padding: 14rpx 18rpx; overflow-wrap: anywhere; }
.unavailable button { margin-top: 20rpx; }
.hero-skeleton { height: 490rpx; }
.roster-skeleton { height: 300rpx; }
.browse-button { margin-top: 12rpx; }
button:focus-visible { outline: 3px solid var(--color-primary-strong); outline-offset: 3px; }
</style>
