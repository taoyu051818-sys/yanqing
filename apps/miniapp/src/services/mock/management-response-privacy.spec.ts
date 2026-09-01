import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockRequest } from './router'
import {
  getEventDetail,
  getEvents,
  getGames,
  saveEventDetail,
  saveEvents,
  saveGames,
} from './state'

const storage = new Map<string, unknown>()

vi.stubGlobal('uni', {
  getStorageSync: (key: string) => storage.get(key) ?? '',
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
})

const request = <T = any>(method: string, url: string, data: object = {}) =>
  mockRequest<T>(method, url, data)
const login = (role: string) => request('POST', '/auth/dev-login', { role })

describe('mock management response privacy', () => {
  beforeEach(() => storage.clear())

  it('keeps game and registration resource ids but removes people, order and replay ids', async () => {
    const game = {
      ...getGames()[0],
      id: 'managed-game-resource',
      hostId: 'host-actor-secret',
      rewardRule: { internal: 'reward-secret' },
      cancelPolicySnapshot: { internal: 'cancel-policy-secret' },
      cancelIdempotencyKey: 'cancel-idempotency-secret',
      cancelCommandHash: 'cancel-command-secret',
      cancelledById: 'cancel-actor-secret',
      host: { id: 'host-actor-secret', displayName: '测试主理人' },
      registrations: [
        {
          id: 'registration-resource',
          gameId: 'managed-game-resource',
          userId: 'player-user-secret',
          orderId: 'order-secret',
          status: 'PAID',
          user: { id: 'player-user-secret', displayName: '报名球友' },
          order: { id: 'order-secret', status: 'PAID' },
          createdAt: new Date().toISOString(),
        },
      ],
    }
    saveGames([game, ...getGames()])
    await login('ADMIN')

    const result = (await request<any[]>('GET', '/games/managed')).find(
      (item) => item.id === game.id,
    )

    expect(result).toMatchObject({
      id: 'managed-game-resource',
      host: { displayName: '测试主理人' },
      registrations: [
        {
          id: 'registration-resource',
          user: { displayName: '报名球友' },
          order: { status: 'PAID' },
        },
      ],
    })
    const serialized = JSON.stringify(result)
    for (const secret of [
      'host-actor-secret',
      'player-user-secret',
      'order-secret',
      'reward-secret',
      'cancel-policy-secret',
      'cancel-idempotency-secret',
      'cancel-command-secret',
      'cancel-actor-secret',
    ]) expect(serialized).not.toContain(secret)
  })

  it('keeps event, team and match action ids but removes actor/player/order and raw policy fields', async () => {
    const base = getEventDetail(getEvents()[0].id)
    const event = {
      ...base,
      id: 'managed-event-resource',
      code: 'EV-MANAGED-SAFE',
      rules: { internal: 'rules-secret' },
      cancelPolicySnapshot: { internal: 'cancel-policy-secret' },
      cancelIdempotencyKey: 'cancel-idempotency-secret',
      cancelCommandHash: 'cancel-command-secret',
      cancelledById: 'event-actor-secret',
      teams: [
        {
          id: 'team-resource',
          eventId: 'managed-event-resource',
          captainId: 'captain-secret',
          playerAUserId: 'player-a-secret',
          playerBUserId: 'player-b-secret',
          orderId: 'event-order-secret',
          creationIdempotencyKey: 'team-create-secret',
          creationCommandHash: 'team-command-secret',
          name: '安全返回队',
          playerAName: '甲',
          playerBName: '乙',
          category: 'MIXED_DOUBLES',
          seed: 1,
          status: 'PAID',
          points: 0,
          wins: 0,
          losses: 0,
          scoreDiff: 0,
          order: { id: 'event-order-secret', status: 'PAID' },
        },
      ],
      matches: [
        {
          id: 'match-resource',
          eventId: 'managed-event-resource',
          round: 1,
          teamAId: 'team-resource',
          teamBId: null,
          startingScoreA: 0,
          startingScoreB: 0,
          scoreA: null,
          scoreB: null,
          status: 'PENDING',
          submittedById: 'score-actor-secret',
          confirmedById: 'confirm-actor-secret',
        },
      ],
    }
    saveEvents([event, ...getEvents()])
    saveEventDetail(event)
    await login('EVENT_MANAGER')

    const result = await request<any>('GET', `/events/managed/${event.id}`)

    expect(result).toMatchObject({
      id: 'managed-event-resource',
      teams: [{ id: 'team-resource', order: { status: 'PAID' } }],
      matches: [{ id: 'match-resource', teamAId: 'team-resource' }],
    })
    const serialized = JSON.stringify(result)
    for (const secret of [
      'rules-secret',
      'cancel-policy-secret',
      'cancel-idempotency-secret',
      'cancel-command-secret',
      'event-actor-secret',
      'captain-secret',
      'player-a-secret',
      'player-b-secret',
      'event-order-secret',
      'team-create-secret',
      'team-command-secret',
      'score-actor-secret',
      'confirm-actor-secret',
    ]) expect(serialized).not.toContain(secret)
  })
})
