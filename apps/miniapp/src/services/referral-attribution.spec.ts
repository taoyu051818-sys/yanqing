import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureReferralAttribution,
  clearPendingReferral,
  pendingReferralInvite,
  referralInviteFromLaunchOptions,
  referralSharePayload,
} from './referral-attribution'

const storage = new Map<string, unknown>()

vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})

describe('referral attribution capture', () => {
  beforeEach(() => storage.clear())

  const inviteCode = 'abcdefghijklmnopqrstuvwxyz_12345'

  it('captures an opaque invite from a shared page query', () => {
    expect(captureReferralAttribution({ query: { invite: inviteCode } }))
      .toBe(inviteCode)
    expect(pendingReferralInvite()).toBe(inviteCode)
  })

  it('supports an encoded QR scene and rejects legacy raw-id keys', () => {
    expect(referralInviteFromLaunchOptions({ query: { scene: `invite%3D${inviteCode}` } }))
      .toBe(inviteCode)
    expect(referralInviteFromLaunchOptions({ query: { referrerId: 'user-host', ref: 'user-host' } }))
      .toBeNull()
  })

  it('does not replace a valid pending attribution with malformed input', () => {
    captureReferralAttribution({ query: { invite: inviteCode } })
    captureReferralAttribution({ query: { invite: 'raw user id' } })
    expect(pendingReferralInvite()).toBe(inviteCode)
  })

  it('preserves a referral when an event partner invitation opens on cold or hot launch', () => {
    captureReferralAttribution({ query: { invite: inviteCode } })
    const partner = 'EP_abcdefghijklmnopqrstuvwxyz_12345'
    expect(captureReferralAttribution({ path: 'pages/event-signup/index', query: { id: 'event', invite: partner } })).toBeNull()
    expect(captureReferralAttribution({ query: { scene: encodeURIComponent('invite=' + partner) } })).toBeNull()
    expect(pendingReferralInvite()).toBe(inviteCode)
  })

  it('clears a consumed attribution explicitly', () => {
    captureReferralAttribution({ query: { invite: inviteCode } })
    clearPendingReferral()
    expect(pendingReferralInvite()).toBeNull()
  })

  it('builds the synchronous share payload only from the cached opaque code', () => {
    expect(referralSharePayload(inviteCode, '小林')).toEqual({
      title: '小林邀请你使用延庆金羽小程序',
      path: `/pages/home/index?referralInvite=${inviteCode}`,
      imageUrl: '/static/share/miniapp-card.jpg',
    })
    expect(referralSharePayload(inviteCode, '小林').path).not.toContain('referrerId')
  })
})
