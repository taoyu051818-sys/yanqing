import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { EventsService } from '../events/events.service.js'
import { GamesService } from '../games/games.service.js'
import { GoodsService } from '../goods/goods.service.js'
import { MembershipsService } from '../memberships/memberships.service.js'
import { TrainingService } from '../training/training.service.js'
import { VenuesService } from '../venues/venues.service.js'
import { AppRole, SourceChannel, TeamCategory } from '../generated/prisma/enums.js'
import { orderCreationCommandHash } from './order-creation-idempotency.js'

const actor: AuthUser = { sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER] }
const key = 'creation-request-key-1'

const replayPrisma = (command: unknown, result: Record<string, unknown> = { id: 'order-existing' }) => ({
  order: {
    findUnique: vi.fn().mockResolvedValue({
      id: 'order-existing', memberId: actor.sub, creationCommandHash: orderCreationCommandHash(command),
    }),
    findUniqueOrThrow: vi.fn().mockResolvedValue(result),
    create: vi.fn(),
  },
  membershipProduct: { findUnique: vi.fn() },
  memberProfile: { findUnique: vi.fn() },
  court: { findUnique: vi.fn() },
  timeSlot: { findUnique: vi.fn() },
  trainingProduct: { findUnique: vi.fn() },
  inventoryItem: { findMany: vi.fn() },
  event: { findUnique: vi.fn() },
  $transaction: vi.fn(),
})

describe('all direct order creation entrypoints', () => {
  it('persists the key and command hash on a newly-created order', async () => {
    const prisma = replayPrisma({})
    prisma.order.findUnique.mockResolvedValue(null)
    prisma.membershipProduct.findUnique.mockResolvedValue({
      id: 'gold', enabled: true, name: '金卡', level: 'GOLD', durationDays: 365, priceCents: 69_900, benefits: {},
    })
    prisma.memberProfile.findUnique.mockResolvedValue({ id: 'profile-1' })
    prisma.order.create.mockResolvedValue({ id: 'order-new' })
    const auditCreate = vi.fn().mockResolvedValue({})
    prisma.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work({
      membershipProduct: prisma.membershipProduct,
      memberProfile: prisma.memberProfile,
      order: prisma.order,
      auditLog: { create: auditCreate },
    }))

    await new MembershipsService(prisma as never).purchase({ productId: 'gold', creationIdempotencyKey: key }, actor)

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        creationIdempotencyKey: key,
        creationCommandHash: orderCreationCommandHash({ kind: 'MEMBERSHIP_PURCHASE', productId: 'gold' }),
      }),
    }))
    expect(auditCreate).toHaveBeenCalledOnce()
  })

  it('replays membership purchase before reloading a mutable product', async () => {
    const command = { kind: 'MEMBERSHIP_PURCHASE', productId: 'gold' }
    const prisma = replayPrisma(command, { id: 'order-existing', membership: { id: 'subscription-1' } })
    const result = await new MembershipsService(prisma as never).purchase({ productId: 'gold', creationIdempotencyKey: key }, actor)
    expect(result).toMatchObject({ id: 'order-existing' })
    expect(prisma.membershipProduct.findUnique).not.toHaveBeenCalled()
  })

  it('replays recharge with the exact principal and gift command', async () => {
    const command = { kind: 'RECHARGE', principalCents: 10_000, giftCents: 500 }
    const prisma = replayPrisma(command)
    await expect(new MembershipsService(prisma as never).recharge({
      principalCents: 10_000, giftCents: 500, creationIdempotencyKey: key,
    }, actor)).resolves.toMatchObject({ id: 'order-existing' })
    expect(prisma.order.create).not.toHaveBeenCalled()
  })

  it('replays a venue booking before checking current slot occupancy', async () => {
    const command = { kind: 'VENUE_BOOKING', memberId: actor.sub, date: '2099-01-01', courtId: 'court-1', slotId: 'slot-1', sourceChannel: SourceChannel.MINI_PROGRAM, couponCode: null }
    const prisma = replayPrisma(command, { id: 'order-existing', bookings: [], items: [] })
    await expect(new VenuesService(prisma as never).createBooking({
      date: '2099-01-01', courtId: 'court-1', slotId: 'slot-1', sourceChannel: SourceChannel.MINI_PROGRAM,
      creationIdempotencyKey: key,
    }, actor)).resolves.toMatchObject({ id: 'order-existing' })
    expect(prisma.court.findUnique).not.toHaveBeenCalled()
  })

  it('replays training purchase before consuming another seat reservation', async () => {
    const command = { kind: 'TRAINING_PURCHASE', productId: 'adult', classId: 'class-1', studentId: null, sourceChannel: SourceChannel.MINI_PROGRAM }
    const prisma = replayPrisma(command, { id: 'order-existing', trainingEnrollment: { id: 'enrollment-1' }, items: [] })
    await expect(new TrainingService(prisma as never).purchase({
      productId: 'adult', classId: 'class-1', sourceChannel: SourceChannel.MINI_PROGRAM,
      creationIdempotencyKey: key,
    }, actor)).resolves.toMatchObject({ id: 'order-existing' })
    expect(prisma.trainingProduct.findUnique).not.toHaveBeenCalled()
  })

  it('normalizes an equivalent goods cart before replay', async () => {
    const command = { kind: 'GOODS_ORDER', items: [{ itemId: 'ball', quantity: 3 }, { itemId: 'grip', quantity: 1 }] }
    const prisma = replayPrisma(command, { id: 'order-existing', items: [] })
    await expect(new GoodsService(prisma as never).createOrder({
      items: [{ itemId: 'grip', quantity: 1 }, { itemId: 'ball', quantity: 1 }, { itemId: 'ball', quantity: 2 }],
      creationIdempotencyKey: key,
    }, actor)).resolves.toMatchObject({ id: 'order-existing' })
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled()
  })

  it('replays a game registration before the active-registration conflict check', async () => {
    const command = { kind: 'GAME_REGISTRATION', gameId: 'game-1', sourceChannel: SourceChannel.MINI_PROGRAM }
    const prisma = replayPrisma(command, { id: 'order-existing', gameRegistration: { id: 'registration-1' } })
    await expect(new GamesService(prisma as never).register('game-1', {
      sourceChannel: SourceChannel.MINI_PROGRAM, creationIdempotencyKey: key,
    }, actor)).resolves.toMatchObject({ id: 'order-existing' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('replays a normalized fixed-doubles event registration', async () => {
    const command = {
      kind: 'EVENT_REGISTRATION', eventId: 'event-1', name: '金羽组合', playerAName: '甲', playerBName: '乙',
      playerAUserId: null, playerBUserId: null, category: TeamCategory.MIXED_DOUBLES, sourceChannel: SourceChannel.MINI_PROGRAM,
    }
    const prisma = replayPrisma(command, { id: 'order-existing', eventTeam: { id: 'team-1' } })
    await expect(new EventsService(prisma as never).register('event-1', {
      name: ' 金羽组合 ', playerAName: ' 甲 ', playerBName: '乙', category: TeamCategory.MIXED_DOUBLES,
      sourceChannel: SourceChannel.MINI_PROGRAM, creationIdempotencyKey: key,
    }, actor)).resolves.toMatchObject({ id: 'order-existing' })
    expect(prisma.event.findUnique).not.toHaveBeenCalled()
  })
})
