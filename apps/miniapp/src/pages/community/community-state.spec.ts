import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import * as auth from '../../services/auth-session'
import { deferred, loadSfcScript } from '../../test-utils/sfc-script'

const storage = new Map<string, unknown>()
const requestMemberLogin = vi.fn()
const session = vue.reactive({ user: { id: 'a' } as { id: string } | null, roles: ['MEMBER'], isAuthenticated: true, hydrate: vi.fn(async (): Promise<boolean> => true) })
const publicGame = { id: 'game', status: 'OPEN', myRegistration: null }
function page(overrides: Record<string, unknown> = {}) {
  const endpoints = { publicGames: vi.fn(async () => [publicGame]), games: vi.fn(async () => [publicGame]), events: vi.fn(async () => []), myEventRegistration: vi.fn(), ...overrides }
  const result = loadSfcScript(new URL('./index.vue', import.meta.url), ['load', 'games', 'events', 'eventRegistrations', 'hostApplication', 'loading', 'view', 'changeView', 'loginForRegistrations'], id => {
    if (id === 'vue') return vue
    if (id === '@dcloudio/uni-app') return { onLoad() {}, onShow() {}, onShareAppMessage() {}, onShareTimeline() {} }
    if (id.endsWith('/services/api')) return { endpoints }
    if (id.endsWith('/services/auth-session')) return auth
    if (id.endsWith('/stores/session')) return { useSessionStore: () => session }
    if (id.endsWith('/utils/member-navigation')) return { requestMemberLogin }
    if (id.endsWith('.vue') || id.includes('/utils/') || id.endsWith('/config/share')) return {}
    throw new Error(id)
  })
  return Object.assign(result, { endpoints })
}
beforeEach(() => {
  storage.clear(); requestMemberLogin.mockClear()
  vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
  auth.saveAuthSession('a-token', 'a')
  session.user = { id: 'a' }; session.isAuthenticated = true; session.hydrate = vi.fn(async (): Promise<boolean> => true)
})
describe('community public browsing and account ownership', () => {
  it('loads real public lists without login, profile or registration requests', async () => {
    auth.clearAuthSession(); session.isAuthenticated = false; session.user = null
    const p = page({ events: async () => [{ id: 'event', status: 'OPEN' }] })
    await p.load()
    expect(p.games.value).toEqual([publicGame]); expect(p.events.value[0].id).toBe('event')
    expect(session.hydrate).not.toHaveBeenCalled(); expect(p.endpoints.games).not.toHaveBeenCalled()
    expect(p.endpoints.myEventRegistration).not.toHaveBeenCalled(); expect(requestMemberLogin).not.toHaveBeenCalled()
    p.changeView('mine'); await p.load()
    expect(requestMemberLogin).not.toHaveBeenCalled()
    p.loginForRegistrations()
    expect(requestMemberLogin).toHaveBeenCalledWith('/pages/community/index?tab=games&view=mine')
  })
  it('clears only private fields on logout and keeps activities when the next hydrate fails', async () => {
    const p = page({ games: async () => [{ ...publicGame, myRegistration: { orderId: 'a-order' } }], events: async () => [{ id: 'event', status: 'OPEN' }], myEventRegistration: async () => ({ registration: { id: 'a-team' } }) })
    await p.load(); expect(p.eventRegistrations.value.event.registration.id).toBe('a-team'); p.hostApplication.value = { id: 'a-host' }
    auth.clearAuthSession(); session.user = null
    expect(p.games.value).toEqual([publicGame]); expect(p.eventRegistrations.value).toEqual({}); expect(p.hostApplication.value).toBeNull()
    auth.saveAuthSession('b-token', 'b'); session.user = { id: 'b' }; session.hydrate = vi.fn(async (): Promise<boolean> => false)
    await p.load()
    expect(p.games.value).toEqual([publicGame]); expect(p.eventRegistrations.value).toEqual({})
  })
  it('keeps public cards visible when optional hydration discovers an expired session', async () => {
    session.hydrate = vi.fn(async (): Promise<boolean> => { auth.clearAuthSession(); session.user = null; session.isAuthenticated = false; return false })
    const p = page()
    await p.load()
    expect(p.games.value).toEqual([publicGame]); expect(p.loading.value).toBe(false)
    expect(p.endpoints.games).not.toHaveBeenCalled(); expect(requestMemberLogin).not.toHaveBeenCalled()
  })
  it('ignores an older public response and does not let its finally release a newer load', async () => {
    session.isAuthenticated = false
    const old = deferred(), latest = deferred()
    const p = page({ publicGames: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise) })
    const a = p.load(); const b = p.load()
    old.resolve([{ id: 'old', status: 'OPEN' }]); await a
    expect(p.loading.value).toBe(true)
    latest.resolve([{ id: 'latest', status: 'OPEN' }]); await b
    expect(p.games.value.map((g: any) => g.id)).toEqual(['latest'])
    const first = deferred(), second = deferred()
    const q = page({ publicGames: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) })
    const x = q.load(); const y = q.load()
    second.resolve([{ id: 'new', status: 'OPEN' }]); await y; first.resolve([{ id: 'stale', status: 'OPEN' }]); await x
    expect(q.games.value.map((g: any) => g.id)).toEqual(['new'])
  })
  it('discards a private response arriving after logout', async () => {
    const privateReply = deferred()
    const games = vi.fn(() => privateReply.promise)
    const p = page({ games })
    const loading = p.load(); await vi.waitFor(() => expect(games).toHaveBeenCalled())
    auth.clearAuthSession(); session.user = null; session.isAuthenticated = false
    privateReply.resolve([{ ...publicGame, myRegistration: { id: 'private-old' } }]); await loading
    expect(p.games.value).toEqual([publicGame]); expect(p.eventRegistrations.value).toEqual({})
  })
})
