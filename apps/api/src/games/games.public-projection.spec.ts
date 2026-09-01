import { describe, expect, it, vi } from 'vitest'

import { GameStatus } from '../generated/prisma/enums.js'
import { GamesService } from './games.service.js'

describe('GamesService public projection', () => {
  it('returns only published states and a member-safe field whitelist', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new GamesService({ game: { findMany } } as never)

    await service.list()

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
    expect(query.select).not.toHaveProperty('registrations')
    expect(query.select).not.toHaveProperty('rewardRule')
    expect(query.select).not.toHaveProperty('cancelPolicySnapshot')
    expect(query.select.host.select).toEqual({
      displayName: true,
      avatarUrl: true,
    })
  })
})
