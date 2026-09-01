import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  EventStatus,
  MatchStatus,
} from '../generated/prisma/enums.js'
import { EventsService } from './events.service.js'

const actor: AuthUser = {
  sub: 'event-manager-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
}

describe('completed event score sealing', () => {
  it('rejects score correction after completion before standings can change', async () => {
    const eventMatchUpdate = vi.fn()
    const eventTeamUpdate = vi.fn()
    const auditCreate = vi.fn()
    const tx = {
      eventMatch: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'match-1',
          eventId: 'event-1',
          round: 5,
          teamAId: 'team-a',
          teamBId: 'team-b',
          startingScoreA: 0,
          startingScoreB: 0,
          scoreA: 21,
          scoreB: 18,
          status: MatchStatus.CONFIRMED,
        }),
        update: eventMatchUpdate,
      },
      event: {
        findUnique: vi.fn().mockResolvedValue({
          status: EventStatus.COMPLETED,
        }),
      },
      eventTeam: { update: eventTeamUpdate },
      auditLog: { create: auditCreate },
    }
    const service = new EventsService({
      $transaction: vi.fn(async (work) => work(tx)),
    } as never)

    await expect(
      service.correctScore(
        'match-1',
        { scoreA: 18, scoreB: 21, reason: '核对原始记分表' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.correctScore(
        'match-1',
        { scoreA: 18, scoreB: 21, reason: '核对原始记分表' },
        actor,
      ),
    ).rejects.toThrow('已完赛封账')
    expect(eventMatchUpdate).not.toHaveBeenCalled()
    expect(eventTeamUpdate).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('maps a concurrent finish/correction serialization abort to a safe conflict', async () => {
    const service = new EventsService({
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
    } as never)

    await expect(
      service.correctScore(
        'match-1',
        { scoreA: 18, scoreB: 21, reason: '核对原始记分表' },
        actor,
      ),
    ).rejects.toThrow('封账或比分已被其他操作更新')
  })
})
