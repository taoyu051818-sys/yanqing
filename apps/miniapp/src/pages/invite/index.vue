<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShareAppMessage, onShareTimeline, onShow } from '@dcloudio/uni-app'
import AppIcon from '../../components/AppIcon.vue'
import { useSessionStore } from '../../stores/session'
import { endpoints } from '../../services/api'
import { requestMemberLogin } from '../../utils/member-navigation'
import { referralSharePath, referralSharePayload, referralShareQuery } from '../../services/referral-attribution'
import { SHARE_CARD_IMAGES } from '../../config/share'
const session = useSessionStore()
const hasMemberProfile = computed(() => Boolean(session.user?.memberProfile))
const showBinding = ref(false)
const manualInviteCode = ref('')
const bindingReferral = ref(false)
const referralInviteCode = ref('')
const referralInviteExpiresAt = ref('')
const referralInviteLoading = ref(false)
const referralInviteError = ref('')
const referralRewards = ref<any[]>([])
const showAllRewards = ref(false)
const loadError = ref('')
const referralStatusLabel: Record<string, string> = { PENDING_OBSERVATION: '核验中', AVAILABLE: '待发放', GRANTED: '已到账', REVERSED: '已撤销', REJECTED: '未发放' }
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

// #ifdef H5
async function shareReferralLink() {
  const code = await ensureReferralInvite()
  if (!code) return
  const url = window.location.origin + window.location.pathname + '#' + referralSharePath(code)
  try {
    if (navigator.share) {
      try { await navigator.share({ title: '邀请你使用延庆金羽', url }); return }
      catch (cause: any) { if (cause?.name === 'AbortError') return }
    }
    await uni.setClipboardData({ data: url })
    uni.showToast({ title: '邀请链接已复制，好友打开即可', icon: 'none' })
  } catch { referralInviteError.value = '分享未完成，请重试或在小程序内发送邀请卡片。' }
}
// #endif

onShareAppMessage((options: any) => {
  const shareType = String(options?.target?.dataset?.shareType || 'app-referral')
  if (shareType === 'app-referral' && hasUsableReferralInvite()) {
    return referralSharePayload(
      referralInviteCode.value,
      session.user?.displayName,
    )
  }
  return {
    title: '延庆金羽羽毛球',
    path: '/pages/home/index',
    imageUrl: SHARE_CARD_IMAGES.miniapp,
  }
})

onShareTimeline(() => hasUsableReferralInvite()
  ? {
      title: `${session.user?.displayName || '好友'}邀请你使用延庆金羽小程序`,
      query: referralShareQuery(referralInviteCode.value),
      imageUrl: SHARE_CARD_IMAGES.miniapp,
    }
  : {
      title: '延庆金羽羽毛球',
      imageUrl: SHARE_CARD_IMAGES.miniapp,
    })

async function bindReferral() {
  if (bindingReferral.value) return
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


async function loadReferralRewards() {
  if (!session.user || !hasMemberProfile.value) {
    referralRewards.value = []
    return
  }
  try { referralRewards.value = await endpoints.referralRewards() }
  catch { referralRewards.value = [] }
}


async function loadInvite() {
  if (!session.isAuthenticated) return requestMemberLogin('/pages/invite/index')
  loadError.value = ''
  if (!(await session.hydrate())) { loadError.value = '邀请信息暂未同步，请稍后重试。'; return }
  if (!hasMemberProfile.value) { loadError.value = '当前账号暂无会员资料，请联系前台完善。'; return }
  await Promise.all([loadReferralRewards(), ensureReferralInvite()])
}
onShow(loadInvite)
</script>
<template><view class="page safe-bottom"><view v-if="loadError" class="card"><text class="invite-error">{{ loadError }}</text><button class="secondary" @tap="loadInvite">重试</button></view><view v-if="session.user && hasMemberProfile" class="referral card">
      <view class="referral-head">
        <view class="referral-copy"><view class="referral-title-row"><view class="referral-icon"><AppIcon name="share" :size="32" /></view><view><text class="menu-title">邀请好友使用小程序</text></view></view><text class="muted">好友通过分享卡片首次使用并完成有效首单后，双方按规则获得奖励</text></view>
        <view class="referral-actions">
          <!-- #ifdef MP-WEIXIN -->
          <button size="mini" class="share" open-type="share" data-share-type="app-referral" :disabled="referralInviteLoading || !referralInviteCode"><AppIcon name="share" :size="26" tone="inverse" />发送微信邀请卡片</button>
          <!-- #endif -->
          <!-- #ifdef H5 -->
          <button class="share" :loading="referralInviteLoading" :disabled="referralInviteLoading || !referralInviteCode" @tap="shareReferralLink">分享邀请链接</button>
          <!-- #endif -->
        </view>
      </view>
      <text v-if="referralInviteError" class="invite-error">{{ referralInviteError }}</text>
      <text class="invite-note">好友点击卡片或链接后直接进入小程序，登录后自动承接邀请，无需抄写邀请码。邀请一起打球？请到具体球局点击“邀请球友”。</text>
      <view v-if="session.user.hasReferrer" class="bound-referrer">
        <text class="bound-title">已绑定推荐人</text><text class="muted">推荐关系已生效且不可更换</text>
      </view>
      <button v-else-if="!showBinding" class="secondary" @tap="showBinding = true">其他方式：填写已有邀请码</button>
      <view v-if="!session.user.hasReferrer && showBinding" class="bind-row">
        <text class="muted">已有邀请码（仅旧邀请或线下补录时填写）</text>
        <input aria-label="好友邀请码" v-model="manualInviteCode" maxlength="128" placeholder="粘贴好友发来的邀请码" />
        <button :loading="bindingReferral" :disabled="bindingReferral" class="bind" @tap="bindReferral">确认绑定</button>
      </view>
      <view v-if="referralRewards.length" class="reward-list">
        <view v-for="reward in (showAllRewards ? referralRewards : referralRewards.slice(0, 3))" :key="reward.id" class="reward-row">
          <view>
            <text class="reward-title">{{ reward.recipientRole === 'REFERRER' ? '邀请好友首单奖励' : '受邀新客首单奖励' }}</text>
            <text class="muted">{{ referralStatusLabel[reward.status] || '状态更新中' }}</text>
          </view>
          <text class="reward-value">+{{ reward.recipientRewardValue }} 羽球币</text>
        </view>
      </view>
      <button v-if="referralRewards.length > 3" class="secondary" @tap="showAllRewards = !showAllRewards">{{ showAllRewards ? '收起邀请记录' : '查看全部邀请记录' }}</button>
    </view>

</view></template>
<style scoped>
.referral-head,.referral-title-row,.referral-actions,.bind-row,.reward-row { display:flex; align-items:center; gap:16rpx; }
.referral-head { flex-direction:column; align-items:stretch; }
.referral-title-row { margin-bottom:20rpx; }
.referral-icon { display:grid; place-items:center; width:72rpx; height:72rpx; background:var(--color-primary-soft); border-radius:20rpx; flex:none; }
.referral-title-row>view:last-child { flex:1; min-width:0; }
.menu-title { display:block; font-size:32rpx; font-weight:750; }
.referral-actions button { flex:1; margin:0; font-size:25rpx; padding:18rpx 12rpx; }
.share { color:#fff; background:var(--color-primary); }
.invite-note,.invite-error { display:block; margin:24rpx 0; font-size:25rpx; line-height:1.65; color:var(--color-muted); }
.invite-error { color:var(--color-danger); }
.bound-referrer { padding:24rpx; background:var(--color-surface-subtle); border-radius:20rpx; }
.bound-title,.reward-title { display:block; margin-bottom:8rpx; font-size:26rpx; }
.bind-row { flex-wrap:wrap; margin-top:24rpx; }
.bind-row input { width:100%; padding:18rpx; background:var(--color-surface-subtle); }
.bind-row button { width:100%; font-size:26rpx; color:#fff; background:var(--color-primary); }
.reward-list { margin-top:24rpx; }
.reward-row { padding:22rpx 0; border-top:1rpx solid var(--color-border); flex-wrap:wrap; }
.reward-value { font-size:26rpx; font-weight:750; color:var(--color-primary); }
</style>
