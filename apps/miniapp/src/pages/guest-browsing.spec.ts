import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import * as auth from '../services/auth-session'
import { deferred, loadSfcScript } from '../test-utils/sfc-script'

const storage = new Map<string, unknown>()
const login = vi.fn()
const session = vue.reactive({ user: null as any, roles: [] as string[], isAuthenticated: false, hydrate: vi.fn(async (): Promise<boolean> => true) })
const scopes: ReturnType<typeof vue.effectScope>[] = []
const nativeEffects = { navigateTo: vi.fn(), redirectTo: vi.fn(), reLaunch: vi.fn(), showModal: vi.fn(), showToast: vi.fn(), login: vi.fn() }
function page(name: string, names: string[], overrides: Record<string, any> = {}) {
  const endpoints: Record<string, any> = Object.fromEntries(['publicTrainingProducts', 'membershipProducts', 'rechargePlans', 'goods', 'accountTransactions', 'memberLedger', 'myCoupons', 'trainingStudents', 'trainingEnrollments', 'myTrainingTrials', 'myDataErasureRequests', 'referralRewards', 'createReferralInvite'].map(key => [key, vi.fn(async () => [])]))
  Object.assign(endpoints, overrides)
  const hooks: Record<string, Function> = {}
  const scope = vue.effectScope(); scopes.push(scope)
  const result = scope.run(() => loadSfcScript(new URL(`./${name.includes('/') ? name : name + '/index'}.vue`, import.meta.url), names, id => {
    if (id === 'vue') return vue
    if (id === '@dcloudio/uni-app') return Object.fromEntries(['onShow', 'onLoad', 'onUnload', 'onPullDownRefresh', 'onShareAppMessage', 'onShareTimeline'].map(hook => [hook, (fn: Function) => { hooks[hook] = fn }]))
    if (id.endsWith('/services/api')) return { endpoints }
    if (id.endsWith('/services/auth-session')) return auth
    if (id.endsWith('/stores/session')) return { useSessionStore: () => session }
    if (id.endsWith('/utils/member-wallet')) return { accountLabels: {} }
    if (id.endsWith('/utils/member-navigation')) return { requestMemberLogin: login }
    if (id.endsWith('/services/http')) return { resolveApiAssetUrl: (url: string) => url || '' }
    if (id.endsWith('.vue') || id.includes('/utils/') || id.endsWith('/config/share') || id.endsWith('/services/referral-attribution')) return {}
    throw new Error(id)
  }))!
  return Object.assign(result, { hooks, endpoints })
}
beforeEach(() => {
  storage.clear(); vi.clearAllMocks()
  vi.stubGlobal('uni', { ...nativeEffects, getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
  auth.clearAuthSession(); session.user = null; session.isAuthenticated = false; session.roles = []
  session.hydrate = vi.fn(async (): Promise<boolean> => true)
})
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()) })

describe('guest page lifecycle', () => {
  it.each(['wallet', 'wallet/history', 'coupon', 'settings', 'invite'])('%s opens and reopens without private requests or login effects', async name => {
    const p = page(name, [])
    await p.hooks.onShow(); await p.hooks.onShow()
    expect(session.hydrate).not.toHaveBeenCalled()
    Object.values(p.endpoints).forEach(fn => expect(fn).not.toHaveBeenCalled())
    expect(login).not.toHaveBeenCalled()
    Object.values(nativeEffects).forEach(fn => expect(fn).not.toHaveBeenCalled())
  })
  it.each([
    ['training', ['publicTrainingProducts']], ['membership', ['membershipProducts', 'rechargePlans']], ['shop', ['goods']],
  ])('%s loads public catalog only', async (name, expected) => {
    const p = page(String(name), [])
    await p.hooks.onShow()
    for (const [key, fn] of Object.entries(p.endpoints)) expect(fn.mock.calls.length).toBe(expected.includes(key) ? 1 : 0)
    expect(session.hydrate).not.toHaveBeenCalled(); expect(login).not.toHaveBeenCalled()
    Object.values(nativeEffects).forEach(fn => expect(fn).not.toHaveBeenCalled())
  })
  it('opens course tabs without login and asks only on a purchase action', async () => {
    const p = page('training', ['tab', 'preparePurchase', 'selectedProductId'])
    p.hooks.onLoad({ tab: 'mine' }); await p.hooks.onShow()
    expect(p.tab.value).toBe('mine'); expect(login).not.toHaveBeenCalled()
    p.preparePurchase({ id: 'course' })
    expect(login).toHaveBeenCalledWith('/pages/training/index?tab=mine')
    expect(p.selectedProductId.value).toBe('')
  })
  it.each([['membership', 'purchase'], ['membership', 'recharge'], ['coupon', 'claim'], ['shop', 'buy']])('%s %s asks for login only when tapped', async (name, action) => {
    const p = page(name, [action])
    await p[action]({ id: 'product' })
    expect(login).toHaveBeenCalledOnce()
    Object.values(p.endpoints).forEach(fn => expect(fn).not.toHaveBeenCalled())
  })
  it('loads the shared event signup header without profile or personal registration requests', async () => {
    const p = page('event-signup', ['id', 'event', 'registration'], {
      event: vi.fn(async () => ({ id: 'event', name: '公开赛事' })), myEventRegistration: vi.fn(),
    })
    p.id.value = 'event'; await p.hooks.onShow()
    expect(p.event.value.name).toBe('公开赛事'); expect(p.registration.value).toBeNull()
    expect(session.hydrate).not.toHaveBeenCalled(); expect(p.endpoints.myEventRegistration).not.toHaveBeenCalled(); expect(login).not.toHaveBeenCalled()
  })
  it('keeps public courses after optional authentication expires', async () => {
    auth.saveAuthSession('expired', 'member'); session.isAuthenticated = true
    session.hydrate = vi.fn(async (): Promise<boolean> => { auth.clearAuthSession(); session.isAuthenticated = false; return false })
    const p = page('training', ['products', 'memberError', 'loading'], { publicTrainingProducts: vi.fn(async () => [{ id: 'course' }]) })
    await p.hooks.onShow()
    expect(p.products.value).toEqual([{ id: 'course' }]); expect(p.memberError.value).toBe(''); expect(p.loading.value).toBe(false)
    expect(p.endpoints.trainingEnrollments).not.toHaveBeenCalled(); expect(login).not.toHaveBeenCalled()
  })
  it.each([['wallet/history', 'items', 'memberLedger'], ['coupon', 'coupons', 'myCoupons']])('%s removes private records and ignores a late reply after logout', async (name, state, endpoint) => {
    auth.saveAuthSession('member-token', 'member'); session.isAuthenticated = true
    const reply = deferred()
    const p = page(name, [state], { [endpoint]: vi.fn(() => reply.promise) })
    p[state].value = [{ id: 'private-record' }]
    const pending = p.hooks.onShow(); await vi.waitFor(() => expect(p.endpoints[endpoint]).toHaveBeenCalled())
    auth.clearAuthSession(); session.isAuthenticated = false
    expect(p[state].value).toEqual([])
    reply.resolve(endpoint==='memberLedger' ? {items:[{id:'late-private-record'}],nextCursor:null} : [{ id: 'late-private-record' }]); await pending
    expect(p[state].value).toEqual([]); expect(login).not.toHaveBeenCalled()
  })
})
