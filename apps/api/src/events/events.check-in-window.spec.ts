import { describe, expect, it, vi } from 'vitest'

import { BadRequestException, ConflictException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  RegistrationStatus,
  TeamCategory,
} from '../generated/prisma/client.js'
import { EventsService } from './events.service.js'

const manager: AuthUser = {
  sub: 'manager-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
}
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
}

const teamAt = (startsAt: Date) => ({
  id: 'team-1',
  eventId: 'event-1',
  captainId: 'captain-1',
  playerAName: '甲',
  playerBName: '乙',
  playerAUserId: 'member-a',
  playerBUserId: 'member-b',
  category: TeamCategory.MEN_DOUBLES,
  status: RegistrationStatus.PAID,
  cancellationPending: false,
  event: { startsAt },
})

const transaction = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (client: Record<string, unknown>) => unknown) => work(tx))

describe('EventsService check-in time window', () => {
  it('rejects check-in before the opening boundary', async () => {
    const tx = {
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue(
          teamAt(new Date(Date.now() + 2 * 60 * 60_000)),
        ),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }

    await expect(
      new EventsService({ $transaction: transaction(tx) } as never)
        .checkIn('event-1', 'team-1', manager),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tx.eventTeam.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('requires an explicit admin reason and audits a historical check-in override', async () => {
    const team = teamAt(new Date(Date.now() - 2 * 60 * 60_000))
    const updated = { ...team, status: RegistrationStatus.CHECKED_IN }
    const tx = {
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue(team),
        update: vi.fn().mockResolvedValue(updated),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new EventsService({ $transaction: transaction(tx) } as never)

    await expect(
      service.checkIn('event-1', 'team-1', admin),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.checkIn('event-1', 'team-1', admin, {
        overrideReason: '补录纸质签到表',
      }),
    ).resolves.toBe(updated)
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'EVENT_TEAM_CHECK_IN_HISTORICAL_OVERRIDE',
        reason: '补录纸质签到表',
      }),
    })
  })
})
