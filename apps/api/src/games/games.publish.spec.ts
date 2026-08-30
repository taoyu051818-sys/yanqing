import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, BookingStatus, GameStatus, HostStatus } from '../generated/prisma/enums.js'
import type { PublishGameDto } from './games.dto.js'
import { GamesService } from './games.service.js'

const actor: AuthUser = { sub: 'admin-1', displayName: '管理员', roles: [AppRole.ADMIN] }
const owningHost: AuthUser = { sub: 'host-1', displayName: '本局主理人', roles: [AppRole.HOST] }
const otherHost: AuthUser = { sub: 'host-2', displayName: '其他主理人', roles: [AppRole.HOST] }

const draft = (overrides: Record<string, unknown> = {}) => ({
  id: 'game-1',
  hostId: 'host-1',
  status: GameStatus.DRAFT,
  startsAt: new Date('2099-08-30T10:00:00.000Z'),
  endsAt: new Date('2099-08-30T12:00:00.000Z'),
  capacity: 6,
  host: { hostProfile: { status: HostStatus.APPROVED } },
  courtBookings: [{ status: BookingStatus.CONFIRMED, court: { enabled: true } }],
  ...overrides,
})

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

describe('GamesService publish workflow', () => {
  it('publishes a reviewed draft once and records the reason', async () => {
    const current = draft()
    const published = { ...current, status: GameStatus.OPEN }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(published),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: runner(tx) } as never)
    const dto: PublishGameDto = { reason: '场地和收费已复核' }

    await expect(service.publish('game-1', dto, actor)).resolves.toEqual(published)
    expect(tx.game.updateMany).toHaveBeenCalledWith({
      where: { id: 'game-1', status: GameStatus.DRAFT },
      data: { status: GameStatus.OPEN },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'GAME_PUBLISHED', reason: dto.reason }),
    })
  })

  it('returns an already-open game on retry without another audit', async () => {
    const current = draft({ status: GameStatus.OPEN })
    const tx = {
      game: { findUnique: vi.fn().mockResolvedValue(current), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const service = new GamesService({ $transaction: runner(tx) } as never)

    await expect(service.publish('game-1', undefined, actor)).resolves.toEqual(current)
    expect(tx.game.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('lets the owning host publish but blocks a different host', async () => {
    const current = draft()
    const published = { ...current, status: GameStatus.OPEN }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(published),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: runner(tx) } as never)

    await expect(service.publish('game-1', {}, otherHost)).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.game.updateMany).not.toHaveBeenCalled()
    await expect(service.publish('game-1', {}, owningHost)).resolves.toEqual(published)
  })

  it.each([GameStatus.CANCELLED, GameStatus.FULL, GameStatus.IN_PROGRESS, GameStatus.COMPLETED])(
    'rejects a game already in %s',
    async (status) => {
      const tx = {
        game: { findUnique: vi.fn().mockResolvedValue(draft({ status })), updateMany: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      const service = new GamesService({ $transaction: runner(tx) } as never)
      await expect(service.publish('game-1', {}, actor)).rejects.toBeInstanceOf(ConflictException)
    },
  )

  it('does not publish a draft without a usable court', async () => {
    const tx = {
      game: { findUnique: vi.fn().mockResolvedValue(draft({ courtBookings: [] })), updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const service = new GamesService({ $transaction: runner(tx) } as never)
    await expect(service.publish('game-1', {}, actor)).rejects.toThrow('绑定场地')
    expect(tx.game.updateMany).not.toHaveBeenCalled()
  })

  it.each([3, 7])('does not publish a legacy draft with capacity %i', async (capacity) => {
    const tx = {
      game: { findUnique: vi.fn().mockResolvedValue(draft({ capacity })), updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const service = new GamesService({ $transaction: runner(tx) } as never)

    await expect(service.publish('game-1', {}, actor)).rejects.toThrow('4-6人')
    expect(tx.game.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('reports a missing game without writing an audit record', async () => {
    const tx = { game: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() }, auditLog: { create: vi.fn() } }
    const service = new GamesService({ $transaction: runner(tx) } as never)
    await expect(service.publish('missing', {}, actor)).rejects.toBeInstanceOf(NotFoundException)
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })
})
