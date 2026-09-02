<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShareAppMessage, onShareTimeline, onShow } from '@dcloudio/uni-app'
import { useSessionStore } from '../../stores/session'
import { endpoints } from '../../services/api'
import { money } from '../../utils/format'
import { isMockMode } from '../../services/http'
import {
  referralSharePayload,
  referralShareQuery,
} from '../../services/referral-attribution'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const session = useSessionStore()
const isRemoteStaging = !isMockMode && import.meta.env.VITE_ENABLE_REMOTE_DEV_LOGIN === 'true'
const canSwitchTestIdentity = isMockMode || isRemoteStaging
const manualInviteCode = ref('')
const bindingReferral = ref(false)
const referralInviteCode = ref('')
const referralInviteExpiresAt = ref('')
const referralInviteLoading = ref(false)
const referralInviteError = ref('')
const referralRewards = ref<any[]>([])
const erasureRequests = ref<any[]>([])
const privacyLoading = ref(false)
const privacyError = ref('')
const accountLabel: Record<string, string> = {
  CASH_PRINCIPAL: '现金本金', GIFT_BALANCE: '赠送余额', BADMINTON_COIN: '羽毛球币',
  EVENT_POINTS: '成人赛事积分', GROWTH_POINTS: '青少年成长积分', YOUTH_GROWTH_POINTS: '青少年成长积分',
}
const roleLabel: Record<string, string> = {
  MEMBER: '会员', COACH: '教练', FRONT_DESK: '前台', HOST: '主理人', MERCHANT: '联盟商户',
  FINANCE: '财务', ADMIN: '管理员', SUPER_ADMIN: '超级管理员',
}
const memberLevelLabel: Record<string, string> = {
  BASIC: '普通会员', EXPERIENCE: '体验会员', REGULAR: '年度会员', GOLD: '金卡会员', BLACK: '黑金会员',
}
const privacyStatusLabel: Record<string, string> = {
  REQUESTED: '待复核', CANCELLED: '已撤回', REJECTED: '已驳回', COMPLETED: '已匿名化',
}
const referralStatusLabel: Record<string, string> = {
  PENDING_OBSERVATION: '观察期', AVAILABLE: '待发放', GRANTED: '已到账',
  REVERSED: '已撤销', REJECTED: '未发放',
}
const displayRoles = computed(() => session.roles.map((role) => roleLabel[role] || '其他岗位').join(' · '))
const displayMemberLevel = computed(() => {
  const level = String((session.user?.memberProfile as any)?.level || 'BASIC')
  return memberLevelLabel[level] || '普通会员'
})
const hasMemberProfile = computed(() => Boolean(session.user?.memberProfile))
const openErasureRequest = computed(() => erasureRequests.value.find((item) => item.status === 'REQUESTED'))
const latestErasureRequest = computed(() => erasureRequests.value[0])
const menus = computed(() => [
  ...(canSwitchTestIdentity ? [{ title: '管理员验收通道', subtitle: '切换会员、前台、教练、主理人、商户和管理端', url: '/packages/admin/pages/switch/index' }] : []),
  { title: '我的订单', subtitle: '支付、退款及消费记录', url: '/pages/order/index' },
  { title: '我的资产', subtitle: '余额、羽球币、赛事积分与成长积分', url: '/pages/wallet/index' },
  { title: '我的课程', subtitle: '课包、消课台账、退费与试听记录', url: '/pages/training/index?tab=mine' },
  { title: '我的卡券', subtitle: '查看、领取和使用联盟权益', url: '/pages/coupon/index' },
])

function logout() {
  session.logout()
  uni.reLaunch({ url: '/pages/login/index' })
}
const openLogin = () => uni.navigateTo({ url: '/pages/login/index' })
const openPage = (url: string) => uni.navigateTo({ url })

function hasUsableReferralInvite() {
  const expiresAt = new Date(referralInviteExpiresAt.value).getTime()
  return Boolean(
    referralInviteCode.value &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000,
  )
}

async function ensureReferralInvite() {
  if (!session.user || !hasMemberProfile.value) return ''
  if (hasUsableReferralInvite()) return referralInviteCode.value
  referralInviteLoading.value = true
  referralInviteError.value = ''
  try {
    const invite = await endpoints.createReferralInvite()
    referralInviteCode.value = invite.inviteCode
    referralInviteExpiresAt.value = invite.expiresAt
    return invite.inviteCode
  } catch (cause: any) {
    referralInviteCode.value = ''
    referralInviteExpiresAt.value = ''
    referralInviteError.value = cause?.message || '安全邀请码暂时无法生成'
    return ''
  } finally {
    referralInviteLoading.value = false
  }
}

async function copyReferralCode() {
  const inviteCode = await ensureReferralInvite()
  if (!inviteCode) {
    uni.showToast({ title: referralInviteError.value || '邀请码生成失败', icon: 'none' })
    return
  }
  try {
    await uni.setClipboardData({ data: inviteCode })
  } catch {
    uni.showToast({ title: '复制失败，请长按邀请码复制', icon: 'none' })
  }
}

onShareAppMessage((options: any) => {
  const shareType = String(options?.target?.dataset?.shareType || 'app-referral')
  if (shareType === 'app-referral' && hasUsableReferralInvite()) {
    return referralSharePayload(
      referralInviteCode.value,
      session.user?.displayName,
    )
  }
  return { title: '延庆金羽羽毛球', path: '/pages/home/index' }
})

onShareTimeline(() => hasUsableReferralInvite()
  ? {
      title: `${session.user?.displayName || '好友'}邀请你使用延庆金羽小程序`,
      query: referralShareQuery(referralInviteCode.value),
    }
  : { title: '延庆金羽羽毛球' })

async function bindReferral() {
  const requested = manualInviteCode.value.trim()
  if (!session.user || !requested) {
    uni.showToast({ title: '请填写好友发来的邀请码', icon: 'none' })
    return
  }
  const confirmed = await uni.showModal({
    title: '确认直接推荐人',
    content: '推荐关系仅允许一层且绑定后不能更换，请确认邀请码来自你的推荐人。',
  })
  if (!confirmed.confirm) return
  bindingReferral.value = true
  try {
    await endpoints.bindReferral(requested)
    await session.hydrate()
    manualInviteCode.value = ''
    uni.showToast({ title: '推荐关系已绑定', icon: 'success' })
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '推荐关系绑定失败', icon: 'none' })
  } finally {
    bindingReferral.value = false
  }
}

async function loadPrivacyRequests() {
  if (!session.user || !hasMemberProfile.value) {
    erasureRequests.value = []
    return
  }
  privacyLoading.value = true
  privacyError.value = ''
  try {
    erasureRequests.value = await endpoints.myDataErasureRequests()
  } catch (cause: any) {
    privacyError.value = cause?.message || '注销申请状态暂时无法同步'
  } finally {
    privacyLoading.value = false
  }
}

async function loadReferralRewards() {
  if (!session.user || !hasMemberProfile.value) {
    referralRewards.value = []
    return
  }
  try { referralRewards.value = await endpoints.referralRewards() }
  catch { referralRewards.value = [] }
}

async function requestErasure() {
  if (!session.user || openErasureRequest.value) return
  const input = await uni.showModal({
    title: '申请账号注销与匿名化',
    content: '',
    editable: true,
    placeholderText: '请填写申请原因（至少2个字）',
  })
  const reason = input.content?.trim() || ''
  if (!input.confirm) return
  if (reason.length < 2) {
    uni.showToast({ title: '请填写至少2个字的申请原因', icon: 'none' })
    return
  }
  const confirmed = await uni.showModal({
    title: '再次确认提交',
    content: '提交不会立即删除数据。管理员会先核对余额、订单、退款、课包、报名和券；业务全部结清并停用账号后，才会做不可逆匿名化。',
  })
  if (!confirmed.confirm) return
  privacyLoading.value = true
  try {
    const command = { reason }
    await withPendingCreationKey('privacy.erasure.request', command, (idempotencyKey) =>
      endpoints.createDataErasureRequest({ ...command, idempotencyKey }),
    )
    uni.showToast({ title: '注销申请已提交', icon: 'success' })
    await loadPrivacyRequests()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '注销申请提交失败', icon: 'none' })
  } finally {
    privacyLoading.value = false
  }
}

async function cancelErasure() {
  const request = openErasureRequest.value
  if (!request) return
  const input = await uni.showModal({
    title: '撤回注销申请',
    content: '',
    editable: true,
    placeholderText: '请填写撤回原因',
  })
  const reason = input.content?.trim() || ''
  if (!input.confirm) return
  if (reason.length < 2) {
    uni.showToast({ title: '请填写至少2个字的撤回原因', icon: 'none' })
    return
  }
  privacyLoading.value = true
  try {
    const command = { requestId: request.id, reason }
    await withPendingCreationKey(`privacy.erasure.cancel.${request.id}`, command, (idempotencyKey) =>
      endpoints.cancelDataErasureRequest(request.id, { reason, idempotencyKey }),
    )
    uni.showToast({ title: '注销申请已撤回', icon: 'success' })
    await loadPrivacyRequests()
  } catch (cause: any) {
    uni.showToast({ title: cause?.message || '撤回失败', icon: 'none' })
  } finally {
    privacyLoading.value = false
  }
}

onShow(async () => {
  await session.hydrate()
  await Promise.all([
    loadPrivacyRequests(),
    loadReferralRewards(),
    ensureReferralInvite(),
  ])
})
</script>

<template>
  <view class="page safe-bottom">
    <view v-if="session.user" class="profile-card">
      <view class="avatar">{{ session.user.displayName?.slice(0, 1) }}</view>
      <view class="profile-copy">
        <text class="name">{{ session.user.displayName }}</text>
        <text class="muted">{{ displayRoles || '会员' }}</text>
      </view>
      <text class="level">{{ displayMemberLevel }}</text>
    </view>
    <view v-else class="profile-card" @tap="openLogin">
      <view class="avatar">羽</view><view class="profile-copy"><text class="name">登录后查看会员权益</text><text class="muted">点击微信一键登录</text></view>
    </view>

    <view v-if="session.user?.accounts?.length" class="account-strip">
      <view v-for="account in session.user.accounts" :key="account.id" class="account">
        <text class="account-value">{{ account.type.includes('BALANCE') || account.type.includes('CASH') ? money(account.balance) : account.balance }}</text>
        <text class="muted">{{ accountLabel[account.type] || '其他资产' }}</text>
      </view>
    </view>

    <view v-if="session.isOperator" class="operator-entry" @tap="openPage('/pages/workspace/index')">
      <view><text class="operator-entry-title">进入经营工作台</text><text class="operator-entry-note">处理今日待办、异常、审批与岗位业务</text></view>
      <text class="operator-entry-arrow">›</text>
    </view>

    <view v-if="session.user && hasMemberProfile" class="referral card">
      <view class="referral-head">
        <view class="referral-copy"><text class="invite-kind">拉新邀请</text><text class="menu-title">邀请好友使用小程序</text><text class="muted">好友通过分享卡片首次使用并完成有效首单后，双方按规则获得奖励</text></view>
        <view class="referral-actions">
          <button size="mini" class="copy" :loading="referralInviteLoading" :disabled="referralInviteLoading" @tap="copyReferralCode">复制邀请码</button>
          <button size="mini" class="share" open-type="share" data-share-type="app-referral" :disabled="referralInviteLoading || !referralInviteCode">分享小程序</button>
        </view>
      </view>
      <text v-if="referralInviteError" class="invite-error">{{ referralInviteError }}</text>
      <text v-if="referralInviteCode" class="referral-code">{{ referralInviteCode }}</text>
      <text class="invite-note">这张分享卡只用于邀请好友使用小程序，不会替好友加入球局或赛事。拼场邀请请到“活动”选择具体球局；积分赛由搭档本人生成赛事授权码，再由队长确认报名。</text>
      <view v-if="session.user.hasReferrer" class="bound-referrer">
        <text class="bound-title">已绑定推荐人</text><text class="muted">推荐关系已生效且不可更换</text>
      </view>
      <view v-else class="bind-row">
        <input v-model="manualInviteCode" maxlength="128" placeholder="粘贴好友发来的邀请码" />
        <button :loading="bindingReferral" :disabled="bindingReferral" class="bind" @tap="bindReferral">确认绑定</button>
      </view>
      <view v-if="referralRewards.length" class="reward-list">
        <view v-for="reward in referralRewards.slice(0, 3)" :key="reward.id" class="reward-row">
          <view>
            <text class="reward-title">{{ reward.recipientRole === 'REFERRER' ? '邀请好友首单奖励' : '受邀新客首单奖励' }}</text>
            <text class="muted">{{ referralStatusLabel[reward.status] || '状态更新中' }}</text>
          </view>
          <text class="reward-value">+{{ reward.recipientRewardValue }} 羽球币</text>
        </view>
      </view>
    </view>

    <view class="menu card">
      <view v-for="menu in menus" :key="menu.url" class="menu-item" @tap="openPage(menu.url)">
        <view><text class="menu-title">{{ menu.title }}</text><text class="muted">{{ menu.subtitle }}</text></view><text>›</text>
      </view>
    </view>
    <view v-if="session.user && hasMemberProfile" class="privacy-card card">
      <view class="privacy-head">
        <view><text class="menu-title">隐私与账号注销</text><text class="muted">先结清业务，再由另一名超级管理员复核匿名化</text></view>
        <text v-if="latestErasureRequest" class="privacy-status">{{ privacyStatusLabel[latestErasureRequest.status] || '处理中' }}</text>
      </view>
      <text class="privacy-note">匿名化会移除微信标识、手机号、头像、姓名和监护学员身份信息；依法需保留的订单、支付、退款、账本和审计记录只保留匿名内部编号。</text>
      <text v-if="privacyError" class="privacy-error">{{ privacyError }}</text>
      <view class="privacy-actions">
        <button v-if="!openErasureRequest" size="mini" :loading="privacyLoading" :disabled="privacyLoading" @tap="requestErasure">申请注销与匿名化</button>
        <button v-else size="mini" class="cancel-erasure" :loading="privacyLoading" :disabled="privacyLoading" @tap="cancelErasure">撤回待处理申请</button>
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
.name { display: block; font-size: 35rpx; font-weight: 800; overflow-wrap: anywhere; }
.level { flex: 0 1 auto; max-width: 180rpx; padding: 8rpx 14rpx; color: #e8d28a; border: 1rpx solid rgba(232,210,138,.5); border-radius: 999rpx; font-size: 20rpx; line-height: 1.4; text-align: center; overflow-wrap: anywhere; }
.account-strip { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14rpx; padding: 6rpx 0 24rpx; }
.account { min-width: 0; padding: 24rpx; background: #fff; border-radius: 22rpx; }
.account-value { display: block; margin-bottom: 10rpx; color: #184c30; font-size: 29rpx; font-weight: 800; overflow-wrap: anywhere; }
.operator-entry { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; padding: 26rpx 28rpx; margin-bottom: 22rpx; color: #fff; background: #17653d; border-radius: 24rpx; }
.operator-entry-title { display: block; font-size: 30rpx; font-weight: 800; }
.operator-entry-note { display: block; margin-top: 8rpx; color: rgba(255,255,255,.72); font-size: 22rpx; }
.operator-entry-arrow { flex: 0 0 auto; font-size: 42rpx; }
.referral { margin-bottom: 22rpx; padding: 28rpx; }
.referral-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 18rpx; }
.referral-copy { flex: 1 1 340rpx; min-width: 0; }
.referral-actions { display: flex; flex: 1 1 300rpx; min-width: 0; gap: 10rpx; }
.referral-actions button { min-width: 0; min-height: 72rpx; line-height: 72rpx; font-size: 22rpx; }
.invite-kind { display: inline-flex; padding: 6rpx 12rpx; margin-bottom: 10rpx; color: #17653d; background: #e7f4eb; border-radius: 999rpx; font-size: 19rpx; font-weight: 700; }
.copy { flex: 1 1 0; margin: 0; color: #17653d; background: #edf7f1; }
.share { flex: 1 1 0; margin: 0; color: #fff; background: #17653d; }
.invite-error { display: block; margin-top: 16rpx; color: #a13b35; font-size: 21rpx; line-height: 1.5; }
.referral-code { display: block; padding: 14rpx 16rpx; margin-top: 16rpx; color: #174b30; background: #f4f7f4; border-radius: 14rpx; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20rpx; line-height: 1.5; overflow-wrap: anywhere; word-break: break-all; white-space: normal; user-select: text; }
.invite-note { display: block; margin-top: 18rpx; padding: 16rpx 18rpx; color: #526258; background: #f4f7f4; border-radius: 14rpx; font-size: 21rpx; line-height: 1.6; }
.bound-referrer { margin-top: 18rpx; padding: 18rpx; background: #fff8df; border-radius: 14rpx; }
.bound-title { display: block; margin-bottom: 8rpx; color: #705921; font-weight: 700; }
.bind-row { display: flex; align-items: center; gap: 12rpx; margin-top: 18rpx; }
.bind-row input { box-sizing: border-box; flex: 1; min-width: 0; height: 72rpx; padding: 0 18rpx; background: #f6f8f6; border: 1rpx solid #dbe3de; border-radius: 14rpx; font-size: 22rpx; }
.bind { flex: 0 0 auto; min-height: 72rpx; margin: 0; color: #fff; background: #17653d; font-size: 22rpx; line-height: 72rpx; }
.reward-list { margin-top: 18rpx; border-top: 1rpx solid #e8eee9; }
.reward-row { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; padding: 18rpx 0; border-bottom: 1rpx solid #edf1ee; }
.reward-row > view { flex: 1; min-width: 0; }.reward-title { display: block; margin-bottom: 6rpx; font-size: 23rpx; font-weight: 700; overflow-wrap: anywhere; }
.reward-value { flex: 0 0 auto; color: #17653d; font-size: 23rpx; font-weight: 800; }
.menu { padding: 0 28rpx; }
.menu-item { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 28rpx 0; border-bottom: 1rpx solid #edf0ed; }
.menu-item > view { min-width: 0; }
.menu-item:last-child { border: none; }
.menu-title { display: block; margin-bottom: 8rpx; font-weight: 700; overflow-wrap: anywhere; }.menu-item .muted { display: block; overflow-wrap: anywhere; }
.privacy-card { margin-top: 22rpx; padding: 28rpx; }
.privacy-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18rpx; }.privacy-head > view { flex: 1; min-width: 0; }
.privacy-status { flex: 0 0 auto; padding: 7rpx 12rpx; color: #765d24; background: #fff3c8; border-radius: 999rpx; font-size: 20rpx; }
.privacy-note,.privacy-error { display: block; margin-top: 16rpx; color: #6b7770; font-size: 21rpx; line-height: 1.7; }
.privacy-error { color: #a13b35; }
.privacy-actions { display: flex; margin-top: 18rpx; }
.privacy-actions button { margin: 0; color: #fff; background: #8e3d36; }
.privacy-actions .cancel-erasure { color: #6b4f20; background: #fff3c8; }
@media (max-width: 420px) {
  .profile-card { padding: 32rpx 26rpx; }
  .avatar { width: 84rpx; height: 84rpx; margin-right: 18rpx; }
  .referral-actions { flex-basis: 100%; }
  .bind-row { align-items: stretch; flex-wrap: wrap; }
  .bind-row input,.bind { width: 100%; }
  .bind { flex: 1 1 100%; }
  .privacy-head { flex-wrap: wrap; }
}
</style>
