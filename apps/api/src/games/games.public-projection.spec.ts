import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, GameStatus, OrderStatus, RegistrationStatus } from '../generated/prisma/enums.js'
import { GamesService } from './games.service.js'

const member: AuthUser = {
  sub: 'member-1',
  displayName: '测试会员',
  roles: [AppRole.MEMBER],
}

describe('GamesService public projection', () => {
  it('returns only published states and a member-safe field whitelist', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new GamesService({ game: { findMany } } as never)

    await service.list(member)

    const query = findMany.mock.calls[0][0]
    expect(query.where.status.in).toEqual([
      GameStatus.OPEN,
      GameStatus.FULL,
      GameStatus.IN_PROGRESS,
      GameStatus.COMPLETED,
    ])
    expect(query).not.toHaveProperty('include')
    expect(query.select).not.toHaveProperty('hostId')
    expect(query.select).not.toHaveProperty('courtBookings')
    expect(query.select.registrations).toEqual({
      where: { userId: member.sub },
      select: {
        id: true,
        status: true,
        order: { select: { status: true } },
      },
      take: 1,
    })
    expect(query.select).not.toHaveProperty('rewardRule')
    expect(query.select).not.toHaveProperty('cancelPolicySnapshot')
    expect(query.select.host.select).toEqual({
      displayName: true,
      avatarUrl: true,
    })
  })

  it('returns only the current member registration projection', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'game-1',
        title: '周末球局',
        registrations: [
          {
            id: 'registration-1',
            status: RegistrationStatus.REGISTERED,
            order: { status: OrderStatus.PENDING },
          },
        ],
      },
    ])
    const service = new GamesService({ game: { findMany } } as never)

    const result = await service.list(member)

    expect(result).toEqual([
      {
        id: 'game-1',
        title: '周末球局',
        myRegistration: {
          id: 'registration-1',
          status: RegistrationStatus.REGISTERED,
          orderStatus: OrderStatus.PENDING,
        },
      },
    ])
    expect(result[0]).not.toHaveProperty('registrations')
  })
})
