import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import * as auth from '../../services/auth-session'
import { selectableBookingCoupons } from '../../utils/booking-coupons'
import { deferred, loadTaskScript } from '../../test-utils/sfc-script'
const storage = new Map<string, unknown>(), scopes: ReturnType<typeof vue.effectScope>[] = []
function fixture(myCoupons: () => Promise<unknown>) {
  const { useBookingCoupons } = loadTaskScript(new URL('./use-booking-coupons.ts', import.meta.url), id => {
    if (id === 'vue') return vue
    if (id.endsWith('/services/api')) return { endpoints: { myCoupons } }
    if (id.endsWith('/services/auth-session')) return auth
    if (id.endsWith('/stores/session')) return { useSessionStore: () => ({ isAuthenticated: true }) }
    if (id.endsWith('/utils/booking-coupons')) return { selectableBookingCoupons }
    throw new Error(id)
  })
  const scope = vue.effectScope(); scopes.push(scope); return scope.run(() => useBookingCoupons())!
}
beforeEach(() => {
  storage.clear(); vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key) })
  auth.saveAuthSession('first', 'member-a')
})
afterEach(() => scopes.splice(0).forEach(s => s.stop()))
it('discards a coupon response and clears the selection when the account changes', async () => {
  const response = deferred(), p = fixture(() => response.promise)
  p.couponCode.value = 'old-code'; const pending = p.loadCoupons()
  auth.saveAuthSession('second', 'member-b'); expect(p.couponCode.value).toBe('')
  response.resolve([{ id: 'private-coupon' }]); await pending
  expect(p.coupons.value).toEqual([]); expect(p.couponLoading.value).toBe(false)
})
it('an old failed refresh cannot clear the next successful coupon response', async () => {
  const old = deferred(), fresh = deferred(), get = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise), p = fixture(get)
  const a = p.loadCoupons(), b = p.loadCoupons(); fresh.resolve([{ id: 'fresh' }]); await b
  old.reject(new Error('old request')); await a
  expect(p.coupons.value).toEqual([{ id: 'fresh' }]); expect(p.couponError.value).toBe('')
})
