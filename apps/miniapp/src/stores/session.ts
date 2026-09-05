import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { endpoints } from '../services/api'
import {
  clearPendingReferral,
  pendingReferralInvite,
} from '../services/referral-attribution'
import {
  clearAuthSession,
  saveAuthSession,
  useAccessToken,
} from '../services/auth-session'
import type { AppRole, SessionUser } from '../types/domain'
import { isMockMode } from '../services/http'

const normalizeRoles = (user?: SessionUser | null): AppRole[] =>
  (user?.roles || []).map((item) => typeof item === 'string' ? item : item.role)

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null)
  const loading = ref(false)
  const accessToken = useAccessToken()
  const roles = computed(() => normalizeRoles(user.value))
  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const isOperator = computed(() => roles.value.some((role) => role !== 'MEMBER'))
  const referralAttribution = ref<'idle' | 'bound' | 'already-bound' | 'failed'>('idle')
  const referralAttributionMessage = ref('')

  const saveSession = (result: { accessToken: string; user: SessionUser }) => {
    saveAuthSession(result.accessToken, result.user.id)
    user.value = result.user
  }

  async function applyPendingReferral() {
    const inviteCode = pendingReferralInvite()
    if (!inviteCode || !user.value) return referralAttribution.value
    if (user.value.hasReferrer) {
      clearPendingReferral()
      referralAttribution.value = 'already-bound'
      referralAttributionMessage.value = '账号已有推荐关系，原关系保持不变'
      return referralAttribution.value
    }
    try {
      await endpoints.bindReferral(inviteCode)
      user.value = await endpoints.me()
      clearPendingReferral()
      referralAttribution.value = 'bound'
      referralAttributionMessage.value = '邀请关系已绑定，首单完成后双方可获得奖励'
    } catch (cause: any) {
      referralAttribution.value = 'failed'
      referralAttributionMessage.value = cause?.message || '邀请关系绑定失败'
      // A transport failure may recover on the next launch. Business-rule
      // failures are terminal and must not create an endless retry loop.
      if (cause?.statusCode !== 0) clearPendingReferral()
    }
    return referralAttribution.value
  }

  async function loginWithWechat() {
    loading.value = true
    try {
      const login = await uni.login({ provider: 'weixin' })
      saveSession(await endpoints.wechatLogin(login.code))
      user.value = await endpoints.me()
      await applyPendingReferral()
    } finally { loading.value = false }
  }

  async function loginForDevelopment(role: AppRole) {
    loading.value = true
    try {
      saveSession(await endpoints.devLogin(role))
      user.value = await endpoints.me()
      await applyPendingReferral()
    } finally { loading.value = false }
  }

  async function hydrate() {
    if (!isAuthenticated.value) return false
    try {
      user.value = await endpoints.me()
      await applyPendingReferral()
      return true
    }
    catch (cause: any) {
      // A temporary transport/server failure must not destroy a valid session.
      // Authorization is still checked by the API on every protected action.
      if (cause?.statusCode === 401 || !isAuthenticated.value) logout()
      return false
    }
  }

  async function updateWechatProfile(displayName: string, avatarFilePath?: string) {
    loading.value = true
    try {
      if (avatarFilePath && !isMockMode) user.value = await endpoints.uploadMyAvatar(avatarFilePath)
      user.value = await endpoints.updateMyProfile(displayName)
      return user.value
    } finally { loading.value = false }
  }

  function logout() {
    clearAuthSession()
    user.value = null
    referralAttribution.value = 'idle'
    referralAttributionMessage.value = ''
  }

  return {
    user, roles, loading, isAuthenticated, isOperator,
    referralAttribution, referralAttributionMessage,
    loginWithWechat, loginForDevelopment, updateWechatProfile, hydrate, applyPendingReferral, logout,
  }
})
