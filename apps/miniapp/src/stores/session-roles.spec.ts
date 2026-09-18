import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
vi.mock('../services/api', () => ({ endpoints: {} }))
vi.mock('../services/http', () => ({ isMockMode: false }))
import { useSessionStore } from './session'
import type { AppRole } from '../types/domain'
vi.stubGlobal('uni', { getStorageSync: () => '', setStorageSync: vi.fn(), removeStorageSync: vi.fn() })
describe('primary and additional role access', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  it.each<AppRole>(['FRONT_DESK', 'ADMIN', 'SUPER_ADMIN'])('exposes assisted booking for primary-only %s', role => {
    const store = useSessionStore()
    store.user = { id: 'operator', displayName: '运营', primaryRole: role, roles: [] }
    expect(store.roles).toContain(role)
    expect(store.isOperator).toBe(true)
  })
  it('merges string and object roles without duplicates and revokes access on profile refresh', () => {
    const store = useSessionStore()
    store.user = { id: 'operator', displayName: '运营', primaryRole: 'ADMIN', roles: ['MEMBER', { role: 'ADMIN' }, { role: 'FRONT_DESK' }] }
    expect(store.roles).toEqual(['ADMIN', 'MEMBER', 'FRONT_DESK'])
    store.user = { id: 'operator', displayName: '会员', primaryRole: 'MEMBER', roles: [] }
    expect(store.roles).toEqual(['MEMBER']); expect(store.isOperator).toBe(false)
  })
})
