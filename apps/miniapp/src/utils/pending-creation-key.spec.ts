import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completePendingCreation,
  creationCommandFingerprint,
  getPendingCreationKey,
  withPendingCreationKey,
} from './pending-creation-key'

const storage = new Map<string, unknown>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
  })
})

describe('pending creation key', () => {
  it('normalizes object keys and omitted undefined fields', () => {
    expect(creationCommandFingerprint({ b: 2, a: 1, skipped: undefined })).toBe(
      creationCommandFingerprint({ a: 1, b: 2 }),
    )
  })

  it('reuses one persisted key for the same slot and command', () => {
    const first = getPendingCreationKey('venue.booking.member', { date: '2026-08-30', courtId: 'c1' })
    const afterRestart = getPendingCreationKey('venue.booking.member', { courtId: 'c1', date: '2026-08-30' })

    expect(afterRestart).toBe(first)
    expect(storage.size).toBe(1)
  })

  it('replaces the pending key when the command changes', () => {
    const first = getPendingCreationKey('membership.recharge', { principalCents: 10000 })
    const changed = getPendingCreationKey('membership.recharge', { principalCents: 20000 })

    expect(changed).not.toBe(first)
    expect(storage.size).toBe(1)
  })

  it('does not reuse a pending key after the signed-in user changes', () => {
    const command = { productId: 'membership-1' }
    storage.set('yanqing_actor_id', 'member-1')
    const first = getPendingCreationKey('membership.purchase', command)
    storage.set('yanqing_actor_id', 'member-2')
    const second = getPendingCreationKey('membership.purchase', command)

    expect(second).not.toBe(first)
  })

  it('retains a key after failure and clears it only after success', async () => {
    const command = { productId: 'membership-1' }
    let failedKey = ''
    await expect(withPendingCreationKey('membership.purchase', command, async (key) => {
      failedKey = key
      throw new Error('network unavailable')
    })).rejects.toThrow('network unavailable')

    let retriedKey = ''
    await expect(withPendingCreationKey('membership.purchase', command, async (key) => {
      retriedKey = key
      return { orderNo: 'O-1' }
    })).resolves.toEqual({ orderNo: 'O-1' })
    expect(retriedKey).toBe(failedKey)

    const next = getPendingCreationKey('membership.purchase', command)
    expect(next).not.toBe(failedKey)
  })

  it('does not let a late success clear a newer command', () => {
    const oldCommand = { gameId: 'g1' }
    const newCommand = { gameId: 'g2' }
    const oldKey = getPendingCreationKey('game.register', oldCommand)
    const newKey = getPendingCreationKey('game.register', newCommand)

    completePendingCreation('game.register', oldCommand, oldKey)

    expect(getPendingCreationKey('game.register', newCommand)).toBe(newKey)
  })
})
