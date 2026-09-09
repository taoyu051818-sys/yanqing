import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { endpoints } from '../services/api'
import {
  clearPendingReferral,
  pendingReferralInvite,
} from '../services/referral-attribution'
import {
  AuthSessionChangedError,
  assertAuthSessionCurrent,
  captureAuthSession,
  isAuthSessionCurrent,
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

  let loginAttempt = 0
  let loadingOperation = 0

  function resetUser() {
    user.value = null
    referralAttribution.value = 'idle'
    referralAttributionMessage.value = ''
  }

  // The transport may invalidate authentication without calling store.logout().
  watch(accessToken, (token) => {
    resetUser()
    if (!token) {
      loginAttempt += 1
      loadingOperation += 1
      loading.value = false
    }
  }, { flush: 'sync' })

  const saveSession = (result: { accessToken: string; user: SessionUser }) => {
    saveAuthSession(result.accessToken, result.user.id)
    user.value = result.user
  }

  async function applyPendingReferral() {
    const session = captureAuthSession()
    const inviteCode = pendingReferralInvite()
    if (!inviteCode || !user.value) return referralAttribution.value
    if (user.value.hasReferrer) {
      clearPendingReferral(inviteCode)
      referralAttribution.value = 'already-bound'
      referralAttributionMessage.value = '账号已有推荐关系，原关系保持不变'
      return referralAttribution.value
    }
    try {
      await endpoints.bindReferral(inviteCode)
      assertAuthSessionCurrent(session)
      const profile = await endpoints.me()
      assertAuthSessionCurrent(session)
      user.value = profile
      clearPendingReferral(inviteCode)
      referralAttribution.value = 'bound'
      referralAttributionMessage.value = '邀请关系已绑定，首单完成后双方可获得奖励'
    } catch (cause: any) {
      if (!isAuthSessionCurrent(session)) return referralAttribution.value
      referralAttribution.value = 'failed'
      referralAttributionMessage.value = cause?.message || '邀请关系绑定失败'
      // Invalid/expired/self invitations and missing inviters are terminal.
      // Keep network, auth, rate-limit, concurrency and server failures for retry.
      if (cause?.statusCode === 400 || cause?.statusCode === 404) clearPendingReferral(inviteCode)
    }
    return referralAttribution.value
  }

  async function login(
    loadSession: (code?: string) => Promise<{ accessToken: string; user: SessionUser }>,
    authorize?: () => Promise<string>,
  ) {
    const attempt = ++loginAttempt
    const operation = ++loadingOperation
    loading.value = true
    const initialSession = captureAuthSession()
    const assertAttempt = () => {
      if (attempt !== loginAttempt) throw new AuthSessionChangedError()
    }
    try {
      const code = authorize ? await authorize() : undefined
      assertAttempt()
      assertAuthSessionCurrent(initialSession)
      const result = await loadSession(code)
      assertAttempt()
      assertAuthSessionCurrent(initialSession)
      saveSession(result)
      const session = captureAuthSession()
      const profile = await endpoints.me()
      assertAttempt()
      assertAuthSessionCurrent(session)
      user.value = profile
      await applyPendingReferral()
      assertAttempt()
      assertAuthSessionCurrent(session)
    } finally {
      if (operation === loadingOperation) loading.value = false
    }
  }

  async function loginWithWechat() {
    // Include the native authorization step in the cancellable login attempt.
    return login(
      (code) => endpoints.wechatLogin(code!),
      async () => (await uni.login({ provider: 'weixin' })).code,
    )
  }

  async function loginForDevelopment(role: AppRole) {
    return login(() => endpoints.devLogin(role))
  }

  async function hydrate() {
    const session = captureAuthSession()
    if (!session.token) return false
    try {
      const profile = await endpoints.me()
      assertAuthSessionCurrent(session)
      user.value = profile
      await applyPendingReferral()
      return isAuthSessionCurrent(session)
    }
    catch (cause: any) {
      // A temporary transport/server failure must not destroy a valid session.
      // Authorization is still checked by the API on every protected action.
      if (isAuthSessionCurrent(session) && cause?.statusCode === 401) logout()
      return false
    }
  }

  async function updateWechatProfile(displayName: string, avatarFilePath?: string) {
    const session = captureAuthSession()
    const operation = ++loadingOperation
    loading.value = true
    try {
      if (avatarFilePath && !isMockMode) {
        const profile = await endpoints.uploadMyAvatar(avatarFilePath)
        assertAuthSessionCurrent(session)
        user.value = profile
      }
      const profile = await endpoints.updateMyProfile(displayName)
      assertAuthSessionCurrent(session)
      user.value = profile
      return user.value
    } finally {
      if (operation === loadingOperation) loading.value = false
    }
  }

  function logout() {
    clearAuthSession()
    loginAttempt += 1
    loadingOperation += 1
    loading.value = false
    resetUser()
  }

  return {
    user, roles, loading, isAuthenticated, isOperator,
    referralAttribution, referralAttributionMessage,
    loginWithWechat, loginForDevelopment, updateWechatProfile, hydrate, applyPendingReferral, logout,
  }
})
