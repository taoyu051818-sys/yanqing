<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import ReasonForm from '../../components/ReasonForm.vue'
import AppIcon from '../../components/AppIcon.vue'
import { useSessionStore } from '../../stores/session'
import { endpoints } from '../../services/api'
import { resolveApiAssetUrl } from '../../services/http'
import { requestMemberLogin } from '../../utils/member-navigation'
import { withPendingCreationKey } from '../../utils/pending-creation-key'
const session = useSessionStore()
const erasureRequests = ref<any[]>([])
const privacyLoading = ref(false)
const privacyError = ref('')
const privacyForm = ref<'request' | 'cancel' | ''>('')
const profileNickname = ref('')
const profileAvatarFile = ref('')
const profileError = ref('')
const privacyStatusLabel: Record<string, string> = { REQUESTED: '待处理', CANCELLED: '已撤回', REJECTED: '未通过', COMPLETED: '已注销' }
const hasMemberProfile = computed(() => Boolean(session.user?.memberProfile))
const profileAvatarUrl = computed(() => profileAvatarFile.value || resolveApiAssetUrl(session.user?.avatarUrl))
const openErasureRequest = computed(() => erasureRequests.value.find((item) => item.status === 'REQUESTED'))
const latestErasureRequest = computed(() => erasureRequests.value[0])
function logout() { session.logout(); uni.switchTab({ url: '/pages/profile/index' }) }
function openProfileEditor() {
  profileNickname.value = session.user?.displayName || ''
  profileAvatarFile.value = ''
  profileError.value = ''
}

function chooseProfileAvatar(event: any) {
  profileAvatarFile.value = event?.detail?.avatarUrl || ''
}

async function saveProfile() {
  const displayName = profileNickname.value.trim()
  if (!displayName) {
    profileError.value = '请选择或填写微信昵称'
    return
  }
  profileError.value = ''
  try {
    await session.updateWechatProfile(displayName, profileAvatarFile.value || undefined)
    profileAvatarFile.value = ''
    uni.showToast({ title: '微信资料已更新', icon: 'success' })
  } catch (cause: any) {
    profileError.value = cause?.message || '资料保存失败，请重试'
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


async function requestErasure(reason: string) {
  if (!session.user || openErasureRequest.value) return
  if (privacyLoading.value || reason.trim().length < 2) return
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
    privacyForm.value = ''
    uni.showToast({ title: '注销申请已提交', icon: 'success' })
    await loadPrivacyRequests()
  } catch (cause: any) {
    privacyError.value = cause?.message || '注销申请提交失败'
  } finally {
    privacyLoading.value = false
  }
}

async function cancelErasure(reason: string) {
  const request = openErasureRequest.value
  if (!request) return
  if (privacyLoading.value || reason.trim().length < 2) return
  privacyLoading.value = true
  try {
    const command = { requestId: request.id, reason }
    await withPendingCreationKey(`privacy.erasure.cancel.${request.id}`, command, (idempotencyKey) =>
      endpoints.cancelDataErasureRequest(request.id, { reason, idempotencyKey }),
    )
    privacyForm.value = ''
    uni.showToast({ title: '注销申请已撤回', icon: 'success' })
    await loadPrivacyRequests()
  } catch (cause: any) {
    privacyError.value = cause?.message || '撤回失败'
  } finally {
    privacyLoading.value = false
  }
}


let initializedUser = ''
async function loadSettings() {
  if (!session.isAuthenticated) return requestMemberLogin('/pages/settings/index')
  if (!(await session.hydrate())) { profileError.value = '资料暂未同步，请稍后重试。'; return }
  if (session.user && initializedUser !== session.user.id) { openProfileEditor(); initializedUser = session.user.id }
  await loadPrivacyRequests()
}
onShow(loadSettings)
</script>
<template>
  <view class="page safe-bottom">
    <text class="section-title">个人资料</text>
    <view v-if="profileError && !session.user" class="card"><text class="profile-error">{{ profileError }}</text><button class="secondary" @tap="loadSettings">重试</button></view>
    <view v-if="session.user" class="profile-editor card">
      <view class="editor-heading"><view><text class="menu-title">微信头像与昵称</text><text class="muted">仅在你主动选择并确认后更新</text></view></view>
      <button class="avatar-picker" open-type="chooseAvatar" @chooseavatar="chooseProfileAvatar">
        <image v-if="profileAvatarUrl" class="editor-avatar" :src="profileAvatarUrl" mode="aspectFill" />
        <view v-else class="editor-avatar avatar-placeholder"><AppIcon name="profile" :size="38" /></view>
        <text>{{ profileAvatarFile ? '已选择新头像，点击更换' : '选择微信头像' }}</text>
      </button>
      <view><text class="editor-label">微信昵称</text><input v-model="profileNickname" type="nickname" maxlength="40" placeholder="点击使用微信昵称" /></view>
      <text v-if="profileError" class="profile-error">{{ profileError }}</text>
      <button class="primary editor-save" :loading="session.loading" :disabled="session.loading" @tap="saveProfile">保存资料</button>
    </view>

    <view v-if="session.user && hasMemberProfile" class="privacy-card card">
      <view class="privacy-head">
        <view class="privacy-title"><view class="privacy-icon"><AppIcon name="governance" :size="30" /></view><view><text class="menu-title">隐私与账号注销</text><text class="muted">查看隐私说明，申请关闭账号</text></view></view>
        <text v-if="latestErasureRequest" class="privacy-status">{{ privacyStatusLabel[latestErasureRequest.status] || '处理中' }}</text>
      </view>
      <text class="privacy-note">匿名化会移除微信标识、手机号、头像、姓名和监护学员身份信息；依法需保留的订单、支付、退款、账本和审计记录只保留匿名内部编号。</text>
      <text v-if="privacyError" class="privacy-error">{{ privacyError }}</text>
      <view class="privacy-actions">
        <button v-if="!openErasureRequest" size="mini" :loading="privacyLoading" :disabled="privacyLoading" @tap="privacyError = ''; privacyForm = 'request'">申请注销与匿名化</button>
        <button v-else size="mini" class="cancel-erasure" :loading="privacyLoading" :disabled="privacyLoading" @tap="privacyError = ''; privacyForm = 'cancel'">撤回待处理申请</button>
      </view>
    </view>

    <ReasonForm v-if="privacyForm" :key="privacyForm" :title="privacyForm === 'request' ? '申请账号注销' : '撤回注销申请'" :description="privacyForm === 'request' ? '申请不立即删除数据；完成业务核查后匿名化不可逆。下一步仍须明确确认。' : '只撤回尚未处理的申请，保留账号继续使用。'" :reasons="privacyForm === 'request' ? ['不再使用本服务','注册了重复账号'] : ['仍需继续使用账号']" :busy="privacyLoading" :error="privacyError" :confirm-text="privacyForm === 'request' ? '核对并申请注销' : '确认撤回申请'" @cancel="privacyForm = ''" @submit="privacyForm === 'request' ? requestErasure($event) : cancelErasure($event)" />
    <button v-if="session.user" class="danger" @tap="logout">退出登录</button>
  </view>
</template>
<style scoped>
.profile-editor { display:grid; gap:20rpx; }
.editor-heading,.privacy-head,.privacy-title,.privacy-actions,.avatar-picker { display:flex; align-items:center; gap:16rpx; }
.editor-heading>view,.privacy-title>view:last-child { flex:1; min-width:0; }
.menu-title { display:block; font-weight:750; font-size:29rpx; }
.muted,.privacy-note,.privacy-error { display:block; margin-top:12rpx; color:var(--color-muted); font-size:25rpx; line-height:1.65; }
.avatar-picker { width:100%; justify-content:flex-start; padding:18rpx; background:var(--color-surface-subtle); font-size:26rpx; }
.editor-avatar { width:88rpx; height:88rpx; flex:none; border-radius:24rpx; }
.avatar-placeholder { display:grid; place-items:center; background:var(--color-primary-soft); }
.editor-label { display:block; margin-bottom:10rpx; font-size:25rpx; }
input { width:100%; padding:14rpx 20rpx; background:var(--color-surface-subtle); border-radius:16rpx; }
.editor-save,.danger { width:100%; margin:0; }
.profile-error,.privacy-error { color:var(--color-danger); }
.privacy-title { align-items:flex-start; }
.privacy-icon { flex:none; }
.privacy-head { flex-wrap:wrap; }
.privacy-status { font-size:24rpx; color:var(--color-primary); }
.privacy-actions { margin-top:24rpx; }
.privacy-actions button { width:100%; margin:0; font-size:26rpx; color:var(--color-danger); background:var(--color-danger-soft); }
</style>
