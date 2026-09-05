import { ref, type Ref } from 'vue'

const ACCESS_TOKEN_KEY = 'yanqing_access_token'
const ACTOR_ID_KEY = 'yanqing_actor_id'

// uni storage is persistent but not reactive. Keep a single reactive mirror so
// guards update immediately after login, logout, and an API-side 401.
const accessToken = ref('')

function storedAccessToken() {
  return String(uni.getStorageSync(ACCESS_TOKEN_KEY) || '')
}

export function useAccessToken(): Ref<string> {
  accessToken.value = storedAccessToken()
  return accessToken
}

export function getAccessToken() {
  const stored = storedAccessToken()
  if (stored !== accessToken.value) accessToken.value = stored
  return accessToken.value
}

export function saveAuthSession(token: string, actorId: string) {
  uni.setStorageSync(ACCESS_TOKEN_KEY, token)
  uni.setStorageSync(ACTOR_ID_KEY, actorId)
  accessToken.value = token
}

export function clearAuthSession() {
  uni.removeStorageSync(ACCESS_TOKEN_KEY)
  uni.removeStorageSync(ACTOR_ID_KEY)
  accessToken.value = ''
}
