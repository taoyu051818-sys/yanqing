import { getAccessToken } from '../services/auth-session'

const RETURN_KEY = 'yanqing_member_login_return'
const TAB_KEY = 'yanqing_member_tab_intent'
const MAX_AGE = 15 * 60_000
const tabRoutes = ['/pages/home/index', '/pages/booking/index', '/pages/community/index', '/pages/profile/index']
const memberRoutes = [...tabRoutes, ...['order', 'wallet', 'training', 'coupon', 'membership', 'shop', 'settings', 'invite', 'game-detail', 'event-signup'].map((name) => `/pages/${name}/index`)]
const publicRoutes = [...tabRoutes.filter((route) => route !== '/pages/community/index'), '/pages/game-detail/index', '/pages/event-signup/index']

export function safeMemberRoute(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 1000 || /[\r\n#]/.test(url)) return null
  return memberRoutes.includes(url.split('?')[0]) ? url : null
}

export function rememberLoginReturn(url: string) {
  const route = safeMemberRoute(url)
  if (route) uni.setStorageSync(RETURN_KEY, { url: route, at: Date.now() })
}

export function consumeLoginReturn(): string | null {
  const intent = uni.getStorageSync(RETURN_KEY)
  uni.removeStorageSync(RETURN_KEY)
  if (!intent || typeof intent.at !== 'number' || Date.now() - intent.at > MAX_AGE || intent.at > Date.now()) return null
  return safeMemberRoute(intent.url)
}

export function requestMemberLogin(url: string) {
  rememberLoginReturn(url)
  return uni.navigateTo({ url: '/pages/login/index' })
}

export function openMemberPage(url: string) {
  const route = safeMemberRoute(url)
  if (!route) return
  const [path, query] = route.split('?')
  if (!publicRoutes.includes(path) && !getAccessToken()) return requestMemberLogin(route)
  if (tabRoutes.includes(path)) {
    if (query) uni.setStorageSync(TAB_KEY, { url: route, at: Date.now() })
    return uni.switchTab({ url: path })
  }
  return uni.navigateTo({ url: route })
}

function samePreviousRecord(previous: { route?: string; options?: Record<string, unknown> } | undefined, target: string) {
  if (!previous || `/${previous.route}` !== target.split('?')[0]) return false
  const invite = target.match(/[?&]invite=([^&]+)/)?.[1]
  try { if (invite && previous.options?.invite !== decodeURIComponent(invite)) return false } catch { return false }
  const id = target.match(/[?&]id=([^&]+)/)?.[1]
  if (!id) return true
  try { return previous.options?.id === decodeURIComponent(id) } catch { return false }
}

// Detail ↔ order is a round trip, not an ever-growing mini-program page stack.
export function openMemberRecord(url: string) {
  const target = safeMemberRoute(url)
  if (!target) return
  const pages = getCurrentPages()
  if ((publicRoutes.includes(target.split('?')[0]) || getAccessToken()) && samePreviousRecord(pages[pages.length - 2], target)) return uni.navigateBack()
  return openMemberPage(target)
}

function consumeTabIntent(path: string, keys: string[]): Record<string, string> | null {
  const intent = uni.getStorageSync(TAB_KEY)
  if (!intent || intent.url?.split('?')[0] !== path) return null
  uni.removeStorageSync(TAB_KEY)
  if (typeof intent.at !== 'number' || Date.now() - intent.at > MAX_AGE || intent.at > Date.now()) return null
  const query = String(intent.url).split('?')[1] || ''
  const result: Record<string, string> = {}
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=')
    if (keys.includes(key)) {
      try { result[key] = decodeURIComponent(value) } catch { /* Ignore malformed links. */ }
    }
  }
  return result
}

export const consumeCommunityIntent = () => consumeTabIntent('/pages/community/index', ['tab', 'gameId', 'eventId', 'view'])
export const consumeBookingIntent = () => consumeTabIntent('/pages/booking/index', ['couponId'])

export function finishMemberLogin() {
  const target = consumeLoginReturn() || '/pages/home/index'
  const pages = getCurrentPages()
  const previous = pages[pages.length - 2]
  if (samePreviousRecord(previous, target)) {
    return uni.navigateBack()
  }
  if (tabRoutes.includes(target.split('?')[0])) return openMemberPage(target)
  return uni.redirectTo({ url: target })
}
