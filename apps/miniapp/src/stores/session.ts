import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { endpoints } from '../services/api'
import type { AppRole, SessionUser } from '../types/domain'

const normalizeRoles = (user?: SessionUser | null): AppRole[] =>
  (user?.roles || []).map((item) => typeof item === 'string' ? item : item.role)

export const useSessionStore = defineStore('session', () => {
  const user = ref<SessionUser | null>(null)
  const loading = ref(false)
  const roles = computed(() => normalizeRoles(user.value))
  const isAuthenticated = computed(() => Boolean(uni.getStorageSync('yanqing_access_token')))
  const isOperator = computed(() => roles.value.some((role) => role !== 'MEMBER'))

  const saveSession = (result: { accessToken: string; user: SessionUser }) => {
    uni.setStorageSync('yanqing_access_token', result.accessToken)
    uni.setStorageSync('yanqing_actor_id', result.user.id)
    user.value = result.user
  }

  async function loginWithWechat() {
    loading.value = true
    try {
      const login = await uni.login({ provider: 'weixin' })
      saveSession(await endpoints.wechatLogin(login.code))
      user.value = await endpoints.me()
    } finally { loading.value = false }
  }

  async function loginForDevelopment(role: AppRole) {
    loading.value = true
    try {
      saveSession(await endpoints.devLogin(role))
      user.value = await endpoints.me()
    } finally { loading.value = false }
  }

  async function hydrate() {
    if (!isAuthenticated.value) return false
    try { user.value = await endpoints.me(); return true }
    catch { logout(); return false }
  }

  function logout() {
    uni.removeStorageSync('yanqing_access_token')
    uni.removeStorageSync('yanqing_actor_id')
    user.value = null
  }

  return { user, roles, loading, isAuthenticated, isOperator, loginWithWechat, loginForDevelopment, hydrate, logout }
})
