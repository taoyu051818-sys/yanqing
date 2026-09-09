import { ref, type Ref } from 'vue'

const ACCESS_TOKEN_KEY = 'yanqing_access_token'
const ACTOR_ID_KEY = 'yanqing_actor_id'

// uni storage is persistent but not reactive. Keep a single reactive mirror so
// guards update immediately after login, logout, and an API-side 401.
const accessToken = ref('')
let sessionVersion = 0

function storedAccessToken() {
  return String(uni.getStorageSync(ACCESS_TOKEN_KEY) || '')
}

export function useAccessToken(): Ref<string> {
  getAccessToken()
  return accessToken
}

export function getAccessToken() {
  const stored = storedAccessToken()
  if (stored !== accessToken.value) {
    sessionVersion += 1
    accessToken.value = stored
  }
  return accessToken.value
}

export function saveAuthSession(token: string, actorId: string) {
  sessionVersion += 1
  uni.setStorageSync(ACCESS_TOKEN_KEY, token)
  uni.setStorageSync(ACTOR_ID_KEY, actorId)
  accessToken.value = token
}

export function clearAuthSession() {
  sessionVersion += 1
  uni.removeStorageSync(ACCESS_TOKEN_KEY)
  uni.removeStorageSync(ACTOR_ID_KEY)
  accessToken.value = ''
}

// A version is required even when a fresh login returns the same token.
export function captureAuthSession() {
  const token = getAccessToken()
  return { token, version: sessionVersion }
}

export function isAuthSessionCurrent(session: ReturnType<typeof captureAuthSession>) {
  getAccessToken()
  return session.version === sessionVersion
}

export class AuthSessionChangedError extends Error {
  constructor() { super('登录状态已更新，请重新操作') }
}

export function assertAuthSessionCurrent(session: ReturnType<typeof captureAuthSession>) {
  if (!isAuthSessionCurrent(session)) throw new AuthSessionChangedError()
}
