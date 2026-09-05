import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const endpointMocks = vi.hoisted(() => ({
  devLogin: vi.fn(),
  me: vi.fn(),
  bindReferral: vi.fn(),
}))

vi.mock('../services/api', () => ({ endpoints: endpointMocks }))

import { captureReferralAttribution, pendingReferralInvite } from '../services/referral-attribution'
import { useSessionStore } from './session'

const storage = new Map<string, unknown>()
const inviteCode = 'abcdefghijklmnopqrstuvwxyz_12345'
const member = (hasReferrer = false) => ({
  id: 'new-member',
  displayName: '受邀新客',
  roles: ['MEMBER' as const],
  memberProfile: {},
  accounts: [],
  hasReferrer,
})

vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})

describe('session referral attribution', () => {
  beforeEach(() => {
    storage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    endpointMocks.devLogin.mockResolvedValue({ accessToken: 'token', user: member() })
    endpointMocks.me
      .mockResolvedValueOnce(member())
      .mockResolvedValueOnce(member(true))
    endpointMocks.bindReferral.mockResolvedValue({ bound: true })
  })

  it('binds the captured inviter immediately after login and consumes it once', async () => {
    captureReferralAttribution({ query: { invite: inviteCode } })

    const session = useSessionStore()
    await session.loginForDevelopment('MEMBER')

    expect(endpointMocks.bindReferral).toHaveBeenCalledOnce()
    expect(endpointMocks.bindReferral).toHaveBeenCalledWith(inviteCode)
    expect(session.user?.hasReferrer).toBe(true)
    expect(session.referralAttribution).toBe('bound')
    expect(pendingReferralInvite()).toBeNull()
  })

  it('updates authentication immediately after first login and logout without a reload', async () => {
    endpointMocks.me.mockReset().mockResolvedValue(member())
    const session = useSessionStore()

    expect(session.isAuthenticated).toBe(false)
    await session.loginForDevelopment('MEMBER')
    expect(session.isAuthenticated).toBe(true)
    expect(storage.get('yanqing_access_token')).toBe('token')

    session.logout()
    expect(session.isAuthenticated).toBe(false)
    expect(storage.has('yanqing_access_token')).toBe(false)
    expect(storage.has('yanqing_actor_id')).toBe(false)
  })

  it('keeps an existing immutable relation and discards a later invite', async () => {
    endpointMocks.me.mockReset().mockResolvedValue(member(true))
    captureReferralAttribution({ query: { invite: inviteCode } })

    const session = useSessionStore()
    await session.loginForDevelopment('MEMBER')

    expect(endpointMocks.bindReferral).not.toHaveBeenCalled()
    expect(session.user?.hasReferrer).toBe(true)
    expect(session.referralAttribution).toBe('already-bound')
    expect(pendingReferralInvite()).toBeNull()
  })
})
