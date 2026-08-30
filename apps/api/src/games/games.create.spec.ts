import { describe, expect, it, vi } from 'vitest'

import { BadRequestException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, CourtUsage, GameLevel, HostStatus } from '../generated/prisma/enums.js'
import type { CreateGameDto } from './games.dto.js'
import { GamesService } from './games.service.js'

const actor: AuthUser = { sub: 'host-1', displayName: '主理人', roles: [AppRole.HOST] }

const dto = (capacity: number): CreateGameDto => ({
  title: '周末双打局',
  level: GameLevel.INTERMEDIATE,
  startsAt: new Date(Date.now() + 3_600_000).toISOString(),
  endsAt: new Date(Date.now() + 7_200_000).toISOString(),
  courtIds: ['court-1'],
  capacity,
  feeCents: 6_800,
})

const createFixture = () => {
  const tx = {
    court: {
      findMany: vi.fn().mockResolvedValue([{ id: 'court-1', usage: CourtUsage.RETAIL }]),
    },
    courtBooking: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    game: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'game-1', ...data })),
    },
  }
  const transaction = vi.fn(async (work: (value: typeof tx) => unknown) => work(tx))
  const prisma = {
    hostProfile: { findUnique: vi.fn().mockResolvedValue({ status: HostStatus.APPROVED }) },
    $transaction: transaction,
  }
  return { service: new GamesService(prisma as never), transaction, tx }
}

describe('GamesService create capacity', () => {
  it.each([4, 6])('accepts the ordinary host-game boundary of %i players', async (capacity) => {
    const { service, tx } = createFixture()

    await expect(service.create(dto(capacity), actor)).resolves.toMatchObject({ capacity })
    expect(tx.game.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ capacity }),
    }))
  })

  it.each([3, 7])('rejects %i players before reserving a court', async (capacity) => {
    const { service, transaction } = createFixture()

    await expect(service.create(dto(capacity), actor)).rejects.toBeInstanceOf(BadRequestException)
    expect(transaction).not.toHaveBeenCalled()
  })
})
