import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
const mocks = vi.hoisted(() => ({ me: vi.fn(), bindReferral: vi.fn() }))
vi.mock('../services/api', () => ({ endpoints: mocks }))
import { useSessionStore } from './session'
import { saveAuthSession } from '../services/auth-session'
const storage = new Map<string, any>()
vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})
describe('recoverable session refresh', () => {
  beforeEach(() => { storage.clear(); vi.clearAllMocks(); setActivePinia(createPinia()); saveAuthSession('valid-session', 'member') })
  it.each([0, 500, 503])('preserves authentication after a temporary %s error', async (statusCode) => {
    mocks.me.mockRejectedValue({ statusCode })
    const session = useSessionStore()
    expect(await session.hydrate()).toBe(false)
    expect(session.isAuthenticated).toBe(true)
  })
  it('clears authentication when the server rejects the session', async () => {
    mocks.me.mockRejectedValue({ statusCode: 401 })
    const session = useSessionStore()
    expect(await session.hydrate()).toBe(false)
    expect(session.isAuthenticated).toBe(false)
  })
})
