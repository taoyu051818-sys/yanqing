<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useSessionStore } from '../../stores/session'
import { endpoints } from '../../services/api'
import { money } from '../../utils/format'
import { isMockMode } from '../../services/http'
import { withPendingCreationKey } from '../../utils/pending-creation-key'

const session = useSessionStore()
const referrerId = ref('')
const bindingReferral = ref(false)
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
const privacyStatusLabel: Record<string, string> = {
  REQUESTED: '待复核', CANCELLED: '已撤回', REJECTED: '已驳回', COMPLETED: '已匿名化',
}
const displayRoles = computed(() => session.roles.map((role) => roleLabel[role] || role).join(' · '))
const hasMemberProfile = computed(() => Boolean(session.user?.memberProfile))
const openErasureRequest = computed(() => erasureRequests.value.find((item) => item.status === 'REQUESTED'))
const latestErasureRequest = computed(() => erasureRequests.value[0])
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

function copyReferralCode() {
  if (!session.user?.id) return
  uni.setClipboardData({ data: session.user.id })
}

async function bindReferral() {
  const requested = referrerId.value.trim()
  if (!session.user || !requested) {
    uni.showToast({ title: '请填写推荐人会员码', icon: 'none' })
    return
  }
  if (requested === session.user.id) {
    uni.showToast({ title: '不能绑定自己为推荐人', icon: 'none' })
    return
  }
  const confirmed = await uni.showModal({
    title: '确认直接推荐人',
    content: '推荐关系仅允许一层且绑定后不能更换，请确认会员码无误。',
  })
  if (!confirmed.confirm) return
  bindingReferral.value = true
  try {
    await endpoints.bindReferral(requested)
    await session.hydrate()
    referrerId.value = ''
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
  await loadPrivacyRequests()
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

    <view v-if="session.user && hasMemberProfile" class="referral card">
      <view class="referral-head">
        <view><text class="menu-title">一层直接推荐</text><text class="muted">奖励只来自直接推荐的有效首单，不发展下级</text></view>
        <button size="mini" class="copy" @tap="copyReferralCode">复制我的会员码</button>
      </view>
      <text class="code">{{ session.user.id }}</text>
      <view v-if="session.user.referrerId" class="bound-referrer">
        <text class="bound-title">已绑定推荐人</text><text class="muted">{{ session.user.referrerId }} · 不可更换</text>
      </view>
      <view v-else class="bind-row">
        <input v-model="referrerId" maxlength="100" placeholder="粘贴推荐人的会员码" />
        <button :loading="bindingReferral" :disabled="bindingReferral" class="bind" @tap="bindReferral">确认绑定</button>
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
        <text v-if="latestErasureRequest" class="privacy-status">{{ privacyStatusLabel[latestErasureRequest.status] || latestErasureRequest.status }}</text>
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
.name { display: block; font-size: 35rpx; font-weight: 800; }
.level { padding: 8rpx 14rpx; color: #e8d28a; border: 1rpx solid rgba(232,210,138,.5); border-radius: 999rpx; font-size: 20rpx; }
.account-strip { display: flex; gap: 14rpx; overflow-x: auto; padding: 6rpx 0 24rpx; }
.account { flex: 0 0 200rpx; padding: 24rpx; background: #fff; border-radius: 22rpx; }
.account-value { display: block; margin-bottom: 10rpx; color: #184c30; font-size: 29rpx; font-weight: 800; }
.referral { margin-bottom: 22rpx; padding: 28rpx; }
.referral-head { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.copy { flex: 0 0 auto; margin: 0; color: #17653d; background: #edf7f1; }
.code { display: block; margin-top: 18rpx; padding: 14rpx 18rpx; color: #365244; background: #f4f7f4; border-radius: 14rpx; font-family: monospace; font-size: 21rpx; word-break: break-all; }
.bound-referrer { margin-top: 18rpx; padding: 18rpx; background: #fff8df; border-radius: 14rpx; }
.bound-title { display: block; margin-bottom: 8rpx; color: #705921; font-weight: 700; }
.bind-row { display: flex; align-items: center; gap: 12rpx; margin-top: 18rpx; }
.bind-row input { box-sizing: border-box; flex: 1; min-width: 0; height: 72rpx; padding: 0 18rpx; background: #f6f8f6; border: 1rpx solid #dbe3de; border-radius: 14rpx; font-size: 22rpx; }
.bind { flex: 0 0 auto; margin: 0; color: #fff; background: #17653d; font-size: 22rpx; }
.menu { padding: 0 28rpx; }
.menu-item { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 0; border-bottom: 1rpx solid #edf0ed; }
.menu-item:last-child { border: none; }
.menu-title { display: block; margin-bottom: 8rpx; font-weight: 700; }
.privacy-card { margin-top: 22rpx; padding: 28rpx; }
.privacy-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18rpx; }
.privacy-status { flex: 0 0 auto; padding: 7rpx 12rpx; color: #765d24; background: #fff3c8; border-radius: 999rpx; font-size: 20rpx; }
.privacy-note,.privacy-error { display: block; margin-top: 16rpx; color: #6b7770; font-size: 21rpx; line-height: 1.7; }
.privacy-error { color: #a13b35; }
.privacy-actions { display: flex; margin-top: 18rpx; }
.privacy-actions button { margin: 0; color: #fff; background: #8e3d36; }
.privacy-actions .cancel-erasure { color: #6b4f20; background: #fff3c8; }
</style>
