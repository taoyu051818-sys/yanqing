<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import { endpoints } from '../../services/api'
import { resolveApiAssetUrl } from '../../services/http'
import { useSessionStore } from '../../stores/session'
import { openMemberPage, requestMemberLogin } from '../../utils/member-navigation'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
import { eventSignupPath, participantError, participantPhone, rememberTeamInvite, pendingTeamInvite, forgetTeamInvite } from '../../utils/event-signup'
import { money, shortDate } from '../../utils/format'
import { SHARE_CARD_IMAGES } from '../../config/share'
import type { DoublesCategory, TeamInviteView } from '../../types/event-signup'

const session = useSessionStore()
const id = ref(''), code = ref(''), mode = ref<'MANUAL' | 'INVITE'>('MANUAL')
const event = ref<Record<string, any> | null>(null)
const invite = ref<TeamInviteView | null>(null)
const loading = ref(false), busy = ref(false), error = ref(''), result = ref('')
const consent = ref(false), captainPlays = ref(true)
const registration = ref<any>(null)
const form = reactive({ name: '', playerAName: '', playerAPhone: '', playerBName: '', playerBPhone: '' })
const fieldErrors = reactive<Record<string, string>>({})
const category = ref<DoublesCategory>('MIXED_DOUBLES')
const categories: Array<{ value: DoublesCategory; label: string }> = [
  { value: 'MEN_DOUBLES', label: '男双' }, { value: 'WOMEN_DOUBLES', label: '女双' }, { value: 'MIXED_DOUBLES', label: '混双' },
]
const participants = [
  { label: '选手一', name: 'playerAName', phone: 'playerAPhone' },
  { label: '选手二', name: 'playerBName', phone: 'playerBPhone' },
] as const
const visibleParticipants = computed(() => mode.value === 'MANUAL' ? participants : participants.slice(0, 1))
const activeRegistration = computed(() => registration.value && !['CANCELLED', 'REFUNDED'].includes(registration.value.status))
const inviteCaption = computed(() => ({ PENDING: '等待搭档确认', ACCEPTED: '搭档已确认', SUBMITTED: '队伍已提交报名', EXPIRED: '邀请已过期' })[invite.value?.status || 'PENDING'])
const categoryLabel = computed(() => categories.find(item => item.value === (invite.value?.category || category.value))?.label || '双打')
const fee = computed(() => {
  const info = event.value || invite.value?.event
  if (event.value && ['GOLD', 'BLACK'].includes(String(session.user?.memberProfile?.level)) && event.value.memberFeeCents != null) return event.value.memberFeeCents
  return info?.feeCents || 0
})
const signupOpen = computed(() => event.value && ['OPEN', 'FULL'].includes(event.value.status) &&
  new Date(event.value.registrationEndsAt).getTime() > Date.now() && new Date(event.value.startsAt).getTime() > Date.now())
const canAccept = computed(() => invite.value?.role === 'VISITOR' && invite.value.status === 'PENDING')
const returnPath = () => eventSignupPath(id.value, code.value)
const openMine = () => openMemberPage('/pages/community/index?tab=events&view=mine&eventId=' + encodeURIComponent(id.value))

function prefill() {
  if (!form.playerAName && !code.value) form.playerAName = session.user?.displayName || ''
  if (code.value && invite.value?.role === 'VISITOR' && !form.playerBName) {
    form.playerBName = session.user?.displayName || ''
  }
}
async function load() {
  if (loading.value || !id.value) return
  loading.value = true
  error.value = ''
  try {
    if (session.isAuthenticated && !await session.hydrate()) throw new Error('账号资料暂未同步，请重试')
    if (!code.value && session.user) code.value = pendingTeamInvite(session.user.id, id.value)
    if (code.value) invite.value = await endpoints.teamInvite(id.value, code.value, session.isAuthenticated)
    if (session.user && invite.value?.role === 'CAPTAIN' && ['EXPIRED', 'SUBMITTED'].includes(invite.value.status)) forgetTeamInvite(session.user.id, id.value)
    if (session.isAuthenticated) {
      event.value = await endpoints.event(id.value)
      const mine = await endpoints.myEventRegistration(id.value)
      registration.value = mine?.registration || null
    }
    prefill()
  } catch (cause: any) { error.value = cause?.message || '报名资料加载失败，请重试' }
  finally { loading.value = false }
}
function checkParticipant(which: 'playerAName' | 'playerBName') {
  const phoneKey = which === 'playerAName' ? 'playerAPhone' : 'playerBPhone'
  const issue = participantError(form[which], form[phoneKey])
  fieldErrors[which] = !form[which].trim() ? '请填写选手姓名' : ''
  fieldErrors[phoneKey] = form[which].trim() ? issue : ''
  return issue
}
function validate(receiver = false) {
  error.value = ''
  let issue = ''
  if (!receiver && !form.name.trim()) { fieldErrors.name = '请填写队伍名称'; issue = fieldErrors.name }
  if (!receiver) issue ||= checkParticipant('playerAName')
  if (receiver || mode.value === 'MANUAL') issue ||= checkParticipant('playerBName')
  if (!receiver && mode.value === 'MANUAL' && participantPhone(form.playerAPhone) === participantPhone(form.playerBPhone)) issue ||= '两位选手不能使用相同的联系电话'
  if (!consent.value) issue ||= receiver ? '请先确认同意组队及报名信息使用说明' : '请先确认已征得两位选手同意'
  if (issue) {
    error.value = issue
    uni.showToast({ title: issue, icon: 'none' })
  }
  return !issue
}
async function createInvite() {
  if (busy.value || !validate()) return
  busy.value = true
  try {
    const created = await endpoints.createTeamInvite(id.value, {
      name: form.name.trim(), playerAName: form.playerAName.trim(), playerAPhone: participantPhone(form.playerAPhone), category: category.value, consent: true,
    })
    rememberTeamInvite(session.user!.id, id.value, created)
    // Replace the form with an addressable invitation. Returning from WeChat,
    // app relaunch and login all use the same event-scoped token, never a phone.
    await uni.redirectTo({ url: eventSignupPath(id.value, created.partnerInviteCode) })
  } catch (cause: any) { error.value = cause?.message || '邀请创建失败，请重试' }
  finally { busy.value = false }
}
async function accept() {
  if (!session.isAuthenticated) return requestMemberLogin(returnPath())
  if (busy.value || !validate(true)) return
  busy.value = true
  try {
    invite.value = await endpoints.acceptTeamInvite(id.value, {
      partnerInviteCode: code.value, playerBName: form.playerBName.trim(), playerBPhone: participantPhone(form.playerBPhone), consent: true,
    })
    form.playerBPhone = ''
    result.value = '组队已确认，请提醒队长提交报名并支付。'
  } catch (cause: any) { error.value = cause?.message || '确认失败，请刷新邀请状态后重试' }
  finally { busy.value = false }
}
async function submit() {
  if (busy.value) return
  const invited = Boolean(code.value)
  if (!invited && !validate()) return
  const confirmed = await uni.showModal({
    title: event.value?.status === 'FULL' ? '确认加入候补' : '确认双打报名',
    content: (invite.value?.teamName || form.name.trim()) + ' · ' + categoryLabel.value + '\n' +
      (invited ? invite.value?.playerAName + ' / ' + invite.value?.playerBName : form.playerAName.trim() + ' / ' + form.playerBName.trim()) +
      '\n一队两人，参考费用 ' + money(fee.value) + '。有名额时生成待支付订单；满员进入候补，不提前收费。',
    confirmText: '确认提交',
  })
  if (!confirmed.confirm) return
  busy.value = true
  error.value = ''
  try {
    const command = invited ? {
      registrationMode: 'INVITE', name: invite.value!.teamName, category: invite.value!.category, partnerInviteCode: code.value,
    } : {
      registrationMode: 'MANUAL', name: form.name.trim(), category: category.value, captainPlays: captainPlays.value, consent: true,
      playerAName: form.playerAName.trim(), playerAPhone: participantPhone(form.playerAPhone),
      playerBName: form.playerBName.trim(), playerBPhone: participantPhone(form.playerBPhone),
    }
    const response: any = await withPendingCreationKey('event.register', { eventId: id.value, ...command }, key =>
      endpoints.registerEvent(id.value, { ...command, creationIdempotencyKey: key }))
    form.playerAPhone = ''; form.playerBPhone = ''
    forgetTeamInvite(session.user!.id, id.value)
    if (response.status === 'WAITLISTED' || response.registration?.status === 'WAITLISTED') {
      registration.value = response.registration
      result.value = '已加入候补，当前第 ' + (response.waitlistPosition || '—') + ' 位。晋级后再支付。'
    } else {
      registration.value = response.eventTeam
      result.value = '报名已提交，请在订单有效期内支付，支付成功后进入正式名单。'
      openMemberPage('/pages/order/index?id=' + encodeURIComponent(response.id))
    }
    if (invited) await load()
  } catch (cause: any) { error.value = cause?.message || '提交失败。可重试原报名，系统不会重复创建订单。' }
  finally { busy.value = false }
}
async function copyLink() {
  // #ifdef H5
  try { await uni.setClipboardData({ data: location.origin + location.pathname + '#' + returnPath() }) }
  catch { error.value = '浏览器不允许复制，请复制当前地址栏链接' }
  // #endif
}
function restart() {
  if (session.user) forgetTeamInvite(session.user.id, id.value)
  uni.redirectTo({ url: eventSignupPath(id.value) })
}
onLoad((query) => {
  id.value = typeof query?.id === 'string' ? query.id : ''
  code.value = typeof query?.invite === 'string' && /^EP_[A-Za-z0-9_-]{17,97}$/.test(query.invite) ? query.invite : ''
  if (query?.invite && !code.value) { error.value = '邀请链接不完整，请好友重新分享'; id.value = '' }
  if (!id.value && !error.value) error.value = '缺少赛事信息，请从活动页面重新进入'
})
onShow(load)
onShareAppMessage(() => ({
  title: invite.value?.role === 'CAPTAIN' && invite.value.status === 'PENDING'
    ? invite.value.captain.displayName + ' 邀你组队｜' + invite.value.event.name
    : '一起参加' + (event.value?.name || invite.value?.event.name || '金羽双打赛'),
  path: eventSignupPath(id.value, invite.value?.role === 'CAPTAIN' && invite.value.status === 'PENDING' ? code.value : ''),
  imageUrl: SHARE_CARD_IMAGES.competition,
}))
</script>

<template>
  <view class="signup-page">
    <view v-if="loading && !event && !invite" class="panel"><text class="muted">正在读取赛事资料…</text></view>
    <view v-if="event || invite" class="hero panel">
      <text class="eyebrow">固定双打 · 两人一队</text>
      <text class="title">{{ event?.name || invite?.event.name }}</text>
      <text class="muted">{{ shortDate(event?.startsAt || invite?.event.startsAt) }} · 北京时间</text>
      <view class="price-row"><text class="price">{{ money(fee) }}</text><text class="muted">/ 队 · 最终金额以订单为准</text></view>
    </view>

    <view v-if="result" class="notice" role="status"><AppIcon name="success" :size="36" /><text>{{ result }}</text></view>
    <view v-if="activeRegistration" class="panel">
      <text class="heading">{{ registration.status === 'WAITLISTED' ? '已在候补队列' : '你已提交本场赛事报名' }}</text>
      <text class="muted">无需再次填写。支付、退出或候补进度，可在我的报名中处理。</text>
      <button v-if="registration.order?.id || registration.orderId" class="primary" @tap="openMemberPage('/pages/order/index?id=' + encodeURIComponent(registration.order?.id || registration.orderId))">查看报名订单</button>
      <button class="secondary" @tap="openMine">查看我的报名</button>
    </view>

    <template v-else-if="invite">
      <view class="panel invite-panel">
        <view class="identity">
          <image v-if="invite.captain.avatarUrl" class="avatar" :src="resolveApiAssetUrl(invite.captain.avatarUrl)" mode="aspectFill" aria-label="邀请人头像" />
          <view v-else class="avatar fallback"><AppIcon name="members" :size="44" /></view>
          <view class="identity-copy"><text class="heading">{{ invite.captain.displayName }}</text><text class="muted">{{ invite.role === 'CAPTAIN' ? '你的搭档邀请' : '邀请你成为双打搭档' }}</text></view>
        </view>
        <text class="team-name">{{ invite.teamName }} · {{ categoryLabel }}</text>
        <text class="state">{{ inviteCaption }}</text>
        <text class="muted">有效期至 {{ shortDate(invite.expiresAt) }}；邀请不占名额，提交报名时以剩余名额为准。</text>
        <view v-if="invite.role === 'CAPTAIN' || invite.role === 'PARTNER'" class="summary">
          <text>选手一：{{ invite.playerAName }}</text>
          <text>选手二：{{ invite.playerBName || '等待好友确认' }}</text>
        </view>
        <template v-if="invite.role === 'CAPTAIN' && invite.status === 'PENDING'">
          <text class="muted">点击下方按钮，在微信分享面板中选择好友。好友确认后，返回此页提交报名。</text>
          <!-- #ifdef MP-WEIXIN -->
          <button class="primary" open-type="share"><AppIcon name="share" :size="32" />发送给微信好友</button>
          <!-- #endif -->
          <!-- #ifdef H5 -->
          <button class="primary" @tap="copyLink">复制搭档邀请链接</button>
          <text class="muted">浏览器用于联调；微信卡片须在小程序中发送。</text>
          <!-- #endif -->
        </template>
        <button v-if="invite.role === 'CAPTAIN' && invite.status === 'ACCEPTED'" class="primary" :loading="busy" :disabled="busy || loading" @tap="submit">提交两人报名</button>
        <text v-if="invite.role === 'PARTNER' && invite.status === 'ACCEPTED'" class="muted">你已确认，等待队长提交并付款。尚未进入正式参赛名单。</text>
        <text v-if="invite.role === 'VISITOR' && invite.status === 'ACCEPTED'" class="muted">这份邀请已有搭档确认，请联系好友重新发起。</text>
        <button class="secondary" :disabled="loading || busy" :loading="loading" @tap="load">刷新邀请状态</button>
      </view>
      <view v-if="canAccept && !session.isAuthenticated" class="panel">
        <text class="heading">先登录，再确认搭档</text>
        <text class="muted">登录后填写你的姓名和联系电话。打开邀请不会自动报名。</text>
        <button class="primary" @tap="requestMemberLogin(returnPath())">登录并继续确认</button>
      </view>
      <view v-else-if="canAccept" class="panel">
        <text class="heading">确认我的参赛信息</text>
        <text class="muted">当前账号：{{ session.user?.displayName }}。公开展示姓名，联系电话仅用于赛事联系和防重复报名。</text>
        <label for="partner-name">姓名（必填）</label>
        <input id="partner-name" v-model="form.playerBName" maxlength="40" placeholder="请填写参赛姓名" @blur="checkParticipant('playerBName')" />
        <text v-if="fieldErrors.playerBName" class="field-error">{{ fieldErrors.playerBName }}</text>
        <label for="partner-phone">联系电话（必填）</label>
        <input id="partner-phone" v-model="form.playerBPhone" type="number" maxlength="11" placeholder="11位手机号，不公开展示" @blur="checkParticipant('playerBName')" />
        <text v-if="fieldErrors.playerBPhone" class="field-error">{{ fieldErrors.playerBPhone }}</text>
        <checkbox-group @change="consent = $event.detail.value.includes('yes')"><label class="consent"><checkbox value="yes" :checked="consent" color="#17653d" /><text>我同意与该队长组队，并授权场馆使用以上资料联系和办理本次报名。</text></label></checkbox-group>
        <button class="primary" :disabled="busy || loading" :loading="busy" @tap="accept">确认成为搭档</button>
        <button class="secondary" @tap="openMemberPage('/pages/settings/index')">完善我的微信头像与昵称</button>
      </view>
      <button v-if="['EXPIRED', 'SUBMITTED'].includes(invite.status)" class="secondary" @tap="openMine">查看赛事与我的报名</button>
      <button v-if="invite.role === 'CAPTAIN' && invite.status !== 'SUBMITTED'" class="secondary" @tap="restart">返回填写报名资料</button>
    </template>

    <view v-else-if="!session.isAuthenticated" class="panel">
      <text class="heading">一个账号，即可报名两人</text><text class="muted">登录后可代填两位选手资料，搭档不需要注册小程序。</text>
      <button class="primary" @tap="requestMemberLogin(returnPath())">登录并填写报名</button>
    </view>
    <template v-else-if="event && signupOpen">
      <view class="panel">
        <text class="heading">选择报名方式</text>
        <view class="mode-row">
          <button class="mode" :class="{ selected: mode === 'MANUAL' }" :disabled="busy" @tap="mode = 'MANUAL'; consent = false">我填写两人资料</button>
          <button class="mode" :class="{ selected: mode === 'INVITE' }" :disabled="busy" @tap="mode = 'INVITE'; captainPlays = true; consent = false">微信邀请搭档</button>
        </view>
        <text class="muted">{{ mode === 'MANUAL' ? '只需一个账号提交并支付，另一位选手无需注册。' : '先填写你的信息，再发卡片给好友；对方确认后由你统一报名支付。' }}</text>
        <label for="team-name">队伍名称（必填）</label>
        <input id="team-name" v-model="form.name" maxlength="80" placeholder="给你们的队伍起个名字" @blur="fieldErrors.name = form.name.trim() ? '' : '请填写队伍名称'" />
        <text v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</text>
        <text class="field-label">参赛组别（必选）</text>
        <view class="category-row"><button v-for="item in categories" :key="item.value" class="mode" :class="{ selected: category === item.value }" :disabled="busy" @tap="category = item.value">{{ item.label }}</button></view>
        <checkbox-group v-if="mode === 'MANUAL'" @change="captainPlays = $event.detail.value.includes('yes')">
          <label class="consent"><checkbox value="yes" :checked="captainPlays" color="#17653d" /><text>我本人是选手一</text></label>
        </checkbox-group>
        <text v-if="mode === 'MANUAL' && !captainPlays" class="muted">你仅代为报名和支付，不占参赛席位，也不领取两位选手的赛事积分。</text>
      </view>
      <view v-for="person in visibleParticipants" :key="person.name" class="panel">
        <text class="heading">{{ person.label }}{{ person.name === 'playerAName' && captainPlays ? ' · 本人' : '' }}</text>
        <label :for="person.name">姓名（必填）</label>
        <input :id="person.name" v-model="form[person.name]" maxlength="40" placeholder="请填写参赛姓名" @blur="checkParticipant(person.name)" />
        <text v-if="fieldErrors[person.name]" class="field-error">{{ fieldErrors[person.name] }}</text>
        <label :for="person.phone">联系电话（必填）</label>
        <input :id="person.phone" v-model="form[person.phone]" type="number" maxlength="11" placeholder="11位手机号，不公开展示" @blur="checkParticipant(person.name)" />
        <text v-if="fieldErrors[person.phone]" class="field-error">{{ fieldErrors[person.phone] }}</text>
      </view>
      <view class="panel">
        <text class="muted">姓名用于参赛名单；联系电话仅供场馆联系和防重复报名，不出现在分享卡片和公开名单中。代填资料不会自动绑定他人账号。</text>
        <checkbox-group @change="consent = $event.detail.value.includes('yes')"><label class="consent"><checkbox value="yes" :checked="consent" color="#17653d" /><text>{{ mode === 'MANUAL' ? '我已征得两位选手同意，确认资料准确，并授权场馆用于本次报名。' : '我确认本人参赛信息准确，并同意用于本次组队和赛事报名。' }}</text></label></checkbox-group>
        <button class="primary" :disabled="busy || loading" :loading="busy" @tap="mode === 'MANUAL' ? submit() : createInvite()">{{ mode === 'MANUAL' ? (event.status === 'FULL' ? '提交两人候补' : '核对并提交报名') : '生成搭档邀请卡片' }}</button>
        <text class="muted">有名额时生成限时待支付订单；超时未付释放名额。满员进入候补，不提前收费。</text>
      </view>
    </template>
    <view v-else-if="event && !loading" class="panel"><text class="heading">本赛事当前不可报名</text><text class="muted">报名可能已截止，请返回查看其他赛事。</text></view>
    <view v-if="error" class="error-panel" role="alert"><text>{{ error }}</text><button class="secondary" :disabled="loading || busy" @tap="load">重新同步状态</button><button v-if="code && !invite && session.isAuthenticated" class="secondary" @tap="restart">重新填写报名资料</button></view>
    <button class="back-link" @tap="openMemberPage('/pages/community/index?tab=events')">返回赛事列表</button>
  </view>
</template>

<style scoped>
.signup-page { padding: 24rpx 24rpx calc(40rpx + env(safe-area-inset-bottom)); color: var(--color-foreground); }
.panel { padding: 28rpx; margin-bottom: 24rpx; border: 1rpx solid var(--color-border); border-radius: 24rpx; background: var(--color-surface); }
.panel > text, .summary > text { display: block; overflow-wrap: anywhere; }
.eyebrow { color: var(--color-primary); font-size: 26rpx; font-weight: 650; }
.title { font-size: 40rpx; font-weight: 750; margin: 12rpx 0; line-height: 1.4; }
.heading { display: block; font-size: 32rpx; font-weight: 700; }
.muted { color: var(--color-muted); font-size: 28rpx; line-height: 1.65; margin-top: 12rpx; }
.price-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12rpx; margin-top: 16rpx; }
.price { font-size: 40rpx; font-weight: 750; color: var(--color-primary); }
.price-row .muted { margin: 0; }
.mode-row, .category-row { display: flex; flex-wrap: wrap; gap: 16rpx; margin-top: 20rpx; }
.mode { flex: 1 1 220rpx; min-width: 0; margin: 0; border: 2rpx solid var(--color-border); color: var(--color-muted); background: var(--color-surface); }
.category-row .mode { flex-basis: 140rpx; }
.mode.selected { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-soft); }
button { font-size: 28rpx; padding: 24rpx 18rpx; border-radius: 16rpx; overflow-wrap: anywhere; cursor: pointer; }
.primary, .secondary { width: 100%; margin-top: 20rpx; }
.primary { background: var(--color-primary); color: #fff; }
.secondary { background: var(--color-primary-soft); color: var(--color-primary); }
.back-link { color: var(--color-muted); background: transparent; margin: 12rpx 0 0; width: 100%; }
label:not(.consent), .field-label { display: block; font-size: 28rpx; margin: 24rpx 0 12rpx; font-weight: 600; }
input { display: block; width: 100%; min-height: 48px !important; height: 96rpx; padding: 12rpx 20rpx; border: 2rpx solid var(--color-border); border-radius: 14rpx; background: var(--color-surface-subtle); font-size: 32rpx; }
.consent { display: flex; align-items: flex-start; gap: 12rpx; margin-top: 24rpx; padding: 12rpx 0; min-height: 44px; font-size: 28rpx; line-height: 1.65; }
.consent checkbox { flex: 0 0 auto; }
.consent text { flex: 1; min-width: 0; }
.field-error { color: var(--color-danger); font-size: 26rpx; margin-top: 8rpx; }
.error-panel { padding: 24rpx; background: var(--color-danger-soft); color: var(--color-danger); border-radius: 20rpx; overflow-wrap: anywhere; }
.notice { display: flex; gap: 16rpx; padding: 24rpx; margin-bottom: 24rpx; background: var(--color-primary-soft); color: var(--color-primary); border-radius: 20rpx; }
.notice text { flex: 1; min-width: 0; }
.identity { display: flex; align-items: center; gap: 20rpx; }
.identity-copy { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.identity-copy text { display: block; }
.avatar { width: 96rpx; height: 96rpx; border-radius: 50%; flex: 0 0 96rpx; }
.fallback { display: flex; align-items: center; justify-content: center; background: var(--color-primary-soft); }
.team-name { margin-top: 24rpx; font-size: 32rpx; font-weight: 650; }
.state { margin-top: 20rpx; color: var(--color-primary); font-size: 30rpx; font-weight: 700; }
.summary { margin: 20rpx 0; padding: 20rpx; border-radius: 16rpx; background: var(--color-surface-subtle); line-height: 1.8; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
