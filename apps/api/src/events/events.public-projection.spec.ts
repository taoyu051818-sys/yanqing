import { describe, expect, it, vi } from 'vitest'

import { EventStatus, RegistrationStatus } from '../generated/prisma/enums.js'
import { EventsService } from './events.service.js'

const publishedStatuses = [
  EventStatus.OPEN,
  EventStatus.FULL,
  EventStatus.IN_PROGRESS,
  EventStatus.COMPLETED,
]

describe('EventsService public projection', () => {
  it('lists only published states without raw teams or internal fields', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new EventsService({ event: { findMany } } as never)

    await service.list()

    const query = findMany.mock.calls[0][0]
    expect(query.where.status.in).toEqual(publishedStatuses)
    expect(query).not.toHaveProperty('include')
    expect(query.select).not.toHaveProperty('teams')
    expect(query.select).not.toHaveProperty('matches')
    expect(query.select).not.toHaveProperty('cancelledById')
    expect(query.select).not.toHaveProperty('cancelPolicySnapshot')
    expect(query.select).not.toHaveProperty('rules')
    expect(query.select).not.toHaveProperty('prizePool')
  })

  it('returns public standings without team, account, order or match ids', async () => {
    const findFirstOrThrow = vi.fn().mockResolvedValue({
      id: 'event-public',
      name: '公开积分赛',
      status: EventStatus.COMPLETED,
      teams: [
        {
          name: '冠军队',
          category: 'MIXED_DOUBLES',
          points: 10,
          wins: 5,
          losses: 0,
          scoreDiff: 35,
          finalRank: 1,
        },
      ],
    })
    const service = new EventsService({
      event: { findFirstOrThrow },
    } as never)

    const result = await service.detail('event-public')
    const query = findFirstOrThrow.mock.calls[0][0]

    expect(query.where).toEqual({
      id: 'event-public',
      status: { in: publishedStatuses },
    })
    expect(query.select.teams.where).toEqual({
      status: RegistrationStatus.COMPLETED,
      finalRank: { not: null },
    })
    expect(query.select.teams.select).not.toHaveProperty('id')
    expect(query.select.teams.select).not.toHaveProperty('captainId')
    expect(query.select.teams.select).not.toHaveProperty('playerAUserId')
    expect(query.select.teams.select).not.toHaveProperty('playerBUserId')
    expect(query.select.teams.select).not.toHaveProperty('orderId')
    expect(query.select).not.toHaveProperty('rules')
    expect(query.select).not.toHaveProperty('prizePool')
    expect(result).not.toHaveProperty('teams')
    expect(result).not.toHaveProperty('matches')
    expect(result.standings).toEqual([
      expect.objectContaining({ name: '冠军队', finalRank: 1 }),
    ])
  })

  it('keeps operations fields on explicit safe management projections', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'event-draft' })
    const service = new EventsService({
      event: { findMany, findUniqueOrThrow },
    } as never)

    await service.managedList()
    await service.managedDetail('event-draft')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          prizePool: true,
          _count: { select: { teams: true } },
        }),
      }),
    )
    expect(findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-draft' },
        select: expect.objectContaining({ teams: expect.any(Object), matches: expect.any(Object) }),
      }),
    )
    const listSelect = findMany.mock.calls[0][0].select
    const detailSelect = findUniqueOrThrow.mock.calls[0][0].select
    for (const key of [
      'rules',
      'cancelPolicySnapshot',
      'cancelIdempotencyKey',
      'cancelCommandHash',
      'cancelledById',
    ]) {
      expect(listSelect).not.toHaveProperty(key)
      expect(detailSelect).not.toHaveProperty(key)
    }
    for (const key of [
      'captainId',
      'playerAUserId',
      'playerBUserId',
      'orderId',
      'creationIdempotencyKey',
      'creationCommandHash',
      'cancelIdempotencyKey',
      'cancelCommandHash',
      'cancelledById',
    ]) expect(detailSelect.teams.select).not.toHaveProperty(key)
    expect(detailSelect.teams.select.order.select).toEqual({ status: true })
    expect(detailSelect.matches.select).not.toHaveProperty('submittedById')
    expect(detailSelect.matches.select).not.toHaveProperty('confirmedById')
  })
})
