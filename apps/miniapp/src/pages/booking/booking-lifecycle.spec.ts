import { beforeEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import * as auth from '../../services/auth-session'
import { deferred, loadSfcScript } from '../../test-utils/sfc-script'

const storage = new Map<string, unknown>()
beforeEach(() => { storage.clear(); vi.stubGlobal('uni', { getStorageSync: (key: string) => storage.get(key) || '', setStorageSync: (key: string, value: unknown) => storage.set(key, value), removeStorageSync: (key: string) => storage.delete(key), showToast: vi.fn() }); auth.saveAuthSession('member-token', 'member') })
it('keeps a created order recoverable without navigating after the booking page hides', async () => {
  const order = deferred(); const navigate = vi.fn(); const hooks: Record<string, () => void> = {}
  const p = loadSfcScript(new URL('./index.vue', import.meta.url), ['submit', 'selected', 'submitting'], id => {
    if (id === 'vue') return vue
    if (id === '@dcloudio/uni-app') return Object.fromEntries(['onShow', 'onHide', 'onUnload'].map(name => [name, (callback: () => void) => { hooks[name] = callback }]))
    if (id.endsWith('/services/api')) return { endpoints: { createBooking: () => order.promise } }
    if (id.endsWith('/services/auth-session')) return auth
    if (id.endsWith('/stores/session')) return { useSessionStore: () => ({ user: { id: 'member' }, roles: ['MEMBER'], isAuthenticated: true }) }
    if (id.endsWith('/utils/format')) return { today: () => '2026-10-01' }
    if (id.endsWith('/utils/pending-creation-key')) return { withPendingCreationKey: (_scope: unknown, _command: unknown, submit: (key: string) => unknown) => submit('booking-command') }
    if (id.endsWith('/utils/member-navigation')) return { openMemberPage: navigate }
    if (id.endsWith('.vue') || id.endsWith('/utils/booking-coupons')) return {}
    throw new Error(id)
  })
  p.selected.value = { courtId: 'court', slotId: 'slot' }
  const pending = p.submit(); hooks.onHide?.(); order.resolve({ id: 'created-order' }); await pending
  expect(navigate).not.toHaveBeenCalled(); expect(uni.showToast).not.toHaveBeenCalled(); expect(p.submitting.value).toBe(false)
})
