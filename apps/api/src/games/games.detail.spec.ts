import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { IS_PUBLIC_KEY } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { GamesController } from './games.controller.js'
import { GamesService } from './games.service.js'

const actor: AuthUser = { sub: 'member-me', displayName: '我', roles: [AppRole.MEMBER] }
const context = (game: any, mine: any = null) => {
  const prisma = { game: { findFirst: vi.fn().mockResolvedValue(game) }, gameRegistration: { findUnique: vi.fn().mockResolvedValue(mine), count: vi.fn().mockResolvedValue(2) } }
  return { prisma, service: new GamesService(prisma as never) }
}

describe('shared game detail and authenticated roster', () => {
  it('only the detail endpoint is public, never the roster or registration', async () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GamesController.prototype.detail)).toBe(true)
    for (const method of ['participants', 'register', 'managed'] as const) expect(Reflect.getMetadata(IS_PUBLIC_KEY, GamesController.prototype[method])).not.toBe(true)
    const detail = vi.fn(), participants = vi.fn()
    const controller = new GamesController({ detail, participants } as never)
    await controller.detail('game-1')
    await controller.participants('game-1', actor)
    expect(detail).toHaveBeenCalledWith('game-1')
    expect(participants).toHaveBeenCalledWith('game-1', actor)
  })

  it('publishes schedule, court names and counts without raw registrations or booking data', async () => {
    const { service, prisma } = context({
      id: 'game-1', title: '双打局', host: { displayName: '主理人', avatarUrl: null },
      courtBookings: [{ court: { name: '2号场' } }, { court: { name: '2号场' } }],
      registrations: ['REGISTERED', 'PAID', 'CHECKED_IN', 'COMPLETED', 'WAITLISTED'].map(status => ({ status })),
    })
    expect(await service.detail('game-1')).toEqual({
      id: 'game-1', title: '双打局', host: { displayName: '主理人', avatarUrl: null },
      courtNames: ['2号场'], occupiedCount: 4, confirmedCount: 3, pendingCount: 1, waitlistCount: 1,
    })
    const query = prisma.game.findFirst.mock.calls[0][0]
    expect(query.where).toEqual({ id: 'game-1', status: { in: ['OPEN', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] } })
    expect(Object.keys(query.select).sort()).toEqual(['id', 'title', 'level', 'status', 'startsAt', 'endsAt', 'capacity', 'feeCents', 'newcomerOnly', 'description', 'host', 'courtBookings', 'registrations'].sort())
    expect(query.select.registrations.select).toEqual({ status: true })
    expect(query.select.courtBookings.select).toEqual({ court: { select: { name: true } } })
    expect(query.select.host.select).toEqual({ displayName: true, avatarUrl: true })
  })

  it('does not publish drafts or unknown games in either endpoint', async () => {
    const { service, prisma } = context(null)
    await expect(service.detail('draft')).rejects.toMatchObject({ status: 404 })
    await expect(service.participants('draft', actor)).rejects.toMatchObject({ status: 404 })
    expect(prisma.gameRegistration.findUnique).not.toHaveBeenCalled()
    for (const [query] of prisma.game.findFirst.mock.calls) expect(query.where.status.in).not.toContain('DRAFT')
  })

  it('returns other members nickname/avatar only, and the exact order only for the caller', async () => {
    const { service, prisma } = context({ registrations: [
      { userId: 'other', status: 'PAID', user: { displayName: '球友甲', avatarUrl: '/avatars/a.jpg' } },
      { userId: actor.sub, status: 'REGISTERED', user: { displayName: '我', avatarUrl: null } },
    ] }, { id: 'my-registration', status: 'REGISTERED', createdAt: new Date(), order: { id: 'my-order', status: 'PENDING' } })
    expect(await service.participants('game-1', actor)).toEqual({
      participants: [{ displayName: '球友甲', avatarUrl: '/avatars/a.jpg', isMe: false }],
      myRegistration: { id: 'my-registration', status: 'REGISTERED', order: { id: 'my-order', status: 'PENDING' }, waitlistPosition: null },
    })
    const selection = prisma.game.findFirst.mock.calls[0][0].select.registrations.select
    expect(selection).toEqual({ userId: true, status: true, user: { select: { displayName: true, avatarUrl: true } } })
    expect(prisma.gameRegistration.findUnique).toHaveBeenCalledWith({ where: { gameId_userId: { gameId: 'game-1', userId: actor.sub } }, select: { id: true, status: true, createdAt: true, order: { select: { id: true, status: true } } } })
    expect(prisma.gameRegistration.count).not.toHaveBeenCalled()
  })

  it('marks the caller in a confirmed roster, with no member identifier exposed', async () => {
    const { service } = context({ registrations: [{ userId: actor.sub, status: 'PAID', user: { displayName: '我', avatarUrl: null } }] })
    expect((await service.participants('game-1', actor)).participants).toEqual([{ displayName: '我', avatarUrl: null, isMe: true }])
  })

  it('computes a private FIFO waitlist position with the same creation-time/id tiebreaker', async () => {
    const createdAt = new Date('2026-09-05T02:00:00Z')
    const { service, prisma } = context({ registrations: [] }, { id: 'wait-2', status: 'WAITLISTED', createdAt, order: null })
    expect((await service.participants('game-1', actor)).myRegistration).toEqual({ id: 'wait-2', status: 'WAITLISTED', order: null, waitlistPosition: 2 })
    expect(prisma.gameRegistration.count).toHaveBeenCalledWith({ where: { gameId: 'game-1', status: 'WAITLISTED', OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lte: 'wait-2' } }] } })
  })
})
