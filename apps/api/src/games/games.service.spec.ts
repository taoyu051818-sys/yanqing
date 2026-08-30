import { describe, expect, it, vi } from 'vitest'

import {
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AccountType,
  AppRole,
  GameStatus,
  OrderStatus,
  RegistrationStatus,
  RewardStatus,
  SourceChannel,
} from '../generated/prisma/enums.js'
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js'
import { GamesService } from './games.service.js'

const hostActor: AuthUser = {
  sub: 'host-1',
  displayName: '主理人',
  roles: [AppRole.HOST],
}

const otherHostActor: AuthUser = {
  sub: 'host-2',
  displayName: '另一位主理人',
  roles: [AppRole.HOST],
}

const financeActor: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
}

const txRunner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

const registration = (
  id: string,
  status: RegistrationStatus,
  orderStatus?: OrderStatus,
) => ({
  id,
  userId: `member-${id}`,
  gameId: 'game-1',
  status,
  checkedInAt: status === RegistrationStatus.CHECKED_IN ? new Date('2026-08-29T10:00:00.000Z') : null,
  order: orderStatus
    ? { id: `order-${id}`, status: orderStatus, paidCents: 6_800, refundedCents: orderStatus === OrderStatus.REFUNDED ? 6_800 : 0 }
    : null,
})

const game = (overrides: Record<string, unknown> = {}) => ({
  id: 'game-1',
  code: 'GM-001',
  hostId: 'host-1',
  status: GameStatus.OPEN,
  startsAt: new Date(Date.now() - 60_000),
  rewardRule: { type: AccountType.BADMINTON_COIN, perCheckedIn: 20, cap: 500 },
  registrations: [],
  ...overrides,
})

describe('GamesService host workflow', () => {
  it('creates a pending order while a seat is available and marks the game full at capacity', async () => {
    const storedGame = {
      id: 'game-1',
      title: '周末球局',
      hostId: 'host-1',
      feeCents: 6800,
      capacity: 4,
      status: GameStatus.OPEN,
    }
    const createdOrder = { id: 'order-1', orderNo: 'GO-1', gameRegistration: { id: 'registration-1' } }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(storedGame),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gameRegistration: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0),
        create: vi.fn(),
        update: vi.fn(),
      },
      order: { create: vi.fn().mockResolvedValue(createdOrder) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const result = await service.register('game-1', { sourceChannel: 'MINI_PROGRAM' as never }, {
      sub: 'member-1', displayName: '会员', roles: ['MEMBER'] as never,
    })

    expect(result).toBe(createdOrder)
    expect(tx.order.create).toHaveBeenCalledOnce()
    expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ memberId: 'member-1', createdById: 'member-1' }),
    }))
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'member-1',
        action: 'GAME_ORDER_CREATED',
        objectType: 'Order',
        objectId: createdOrder.id,
        newValue: expect.objectContaining({
          memberId: 'member-1',
          createdById: 'member-1',
          amountCents: 6_800,
          creationIdempotencyKeyPresent: false,
          gameId: 'game-1',
          gameRegistrationId: 'registration-1',
        }),
      }),
    })
    expect(tx.game.updateMany).toHaveBeenCalledWith({
      where: { id: 'game-1', status: GameStatus.OPEN },
      data: { status: GameStatus.FULL },
    })
  })

  it('replays a keyed game order without opening a transaction or duplicating its audit', async () => {
    const key = 'game-order-replay-key-1'
    const sourceChannel = SourceChannel.MINI_PROGRAM
    const existing = {
      id: 'order-existing',
      memberId: 'member-1',
      creationCommandHash: orderCreationCommandHash({
        kind: 'GAME_REGISTRATION',
        gameId: 'game-1',
        sourceChannel,
      }),
    }
    const auditCreate = vi.fn()
    const transaction = vi.fn(async (work: (tx: Record<string, unknown>) => unknown) =>
      work({ auditLog: { create: auditCreate } }))
    const service = new GamesService({
      order: {
        findUnique: vi.fn().mockResolvedValue(existing),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...existing, gameRegistration: { id: 'registration-1' } }),
      },
      $transaction: transaction,
    } as never)

    await expect(service.register('game-1', {
      sourceChannel,
      creationIdempotencyKey: key,
    }, {
      sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER],
    })).resolves.toMatchObject({ id: existing.id })

    expect(transaction).not.toHaveBeenCalled()
    expect(auditCreate).not.toHaveBeenCalled()
  })

  it('puts a member on the FIFO waitlist without creating a payable order', async () => {
    const storedGame = {
      id: 'game-1',
      title: '已满球局',
      hostId: 'host-1',
      feeCents: 6800,
      capacity: 4,
      status: GameStatus.FULL,
    }
    const registration = { id: 'wait-1', gameId: 'game-1', userId: 'member-3', status: RegistrationStatus.WAITLISTED }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(storedGame),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gameRegistration: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn()
          .mockResolvedValueOnce(4)
          .mockResolvedValueOnce(3),
        create: vi.fn().mockResolvedValue(registration),
        update: vi.fn(),
      },
      order: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const result = await service.register('game-1', { sourceChannel: 'MINI_PROGRAM' as never }, {
      sub: 'member-3', displayName: '候补会员', roles: ['MEMBER'] as never,
    })

    expect(result).toMatchObject({
      registration,
      waitlistPosition: 4,
      status: RegistrationStatus.WAITLISTED,
    })
    expect(tx.order.create).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GAME_WAITLISTED' }),
    }))
  })

  it('replays an existing waitlist result after the original response is lost', async () => {
    const storedGame = {
      id: 'game-1',
      title: '已满球局',
      hostId: 'host-1',
      feeCents: 6800,
      capacity: 4,
      status: GameStatus.FULL,
    }
    const duplicate = {
      id: 'wait-2',
      gameId: 'game-1',
      userId: 'member-3',
      status: RegistrationStatus.WAITLISTED,
      createdAt: new Date('2026-08-29T08:01:00.000Z'),
    }
    const tx = {
      game: { findUnique: vi.fn().mockResolvedValue(storedGame) },
      gameRegistration: {
        findUnique: vi.fn().mockResolvedValue(duplicate),
        findMany: vi.fn().mockResolvedValue([{ id: 'wait-1' }, { id: duplicate.id }]),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      order: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: txRunner(tx),
    }
    const service = new GamesService(prisma as never)

    const result = await service.register('game-1', {
      sourceChannel: 'MINI_PROGRAM' as never,
      creationIdempotencyKey: 'game-register-retry-1',
    }, {
      sub: 'member-3', displayName: '候补会员', roles: ['MEMBER'] as never,
    })

    expect(result).toEqual({
      registration: duplicate,
      waitlistPosition: 2,
      status: RegistrationStatus.WAITLISTED,
    })
    expect(tx.gameRegistration.findMany).toHaveBeenCalledWith({
      where: { gameId: 'game-1', status: RegistrationStatus.WAITLISTED },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    expect(tx.gameRegistration.count).not.toHaveBeenCalled()
    expect(tx.order.create).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it.each([
    RegistrationStatus.REGISTERED,
    RegistrationStatus.PAID,
    RegistrationStatus.CHECKED_IN,
  ])('does not treat an existing %s seat as a waitlist retry', async (status) => {
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'game-1', title: '球局', hostId: 'host-1', feeCents: 6800,
          capacity: 4, status: GameStatus.OPEN,
        }),
      },
      gameRegistration: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'registration-1', gameId: 'game-1', userId: 'member-1', status,
        }),
        findMany: vi.fn(),
      },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.register('game-1', {
      sourceChannel: 'MINI_PROGRAM' as never,
    }, {
      sub: 'member-1', displayName: '会员', roles: ['MEMBER'] as never,
    })).rejects.toBeInstanceOf(ConflictException)
    expect(tx.gameRegistration.findMany).not.toHaveBeenCalled()
  })

  it.each([3, 7])('does not accept registration into a legacy open game with capacity %i', async (capacity) => {
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'game-1',
          title: '旧球局',
          hostId: 'host-1',
          feeCents: 6_800,
          capacity,
          status: GameStatus.OPEN,
        }),
      },
      gameRegistration: { findUnique: vi.fn() },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.register('game-1', { sourceChannel: 'MINI_PROGRAM' as never }, {
      sub: 'member-1', displayName: '会员', roles: ['MEMBER'] as never,
    })).rejects.toThrow('4-6人')
    expect(tx.gameRegistration.findUnique).not.toHaveBeenCalled()
  })

  it('promotes the oldest waiting member into a fresh pending order exactly once', async () => {
    const storedGame = {
      id: 'game-1',
      title: '候补递补球局',
      hostId: 'host-1',
      feeCents: 6800,
      capacity: 4,
      status: GameStatus.FULL,
    }
    const waiting = {
      id: 'wait-1',
      gameId: 'game-1',
      userId: 'member-waiting',
      status: RegistrationStatus.WAITLISTED,
      orderId: null,
      createdAt: new Date('2026-08-29T08:00:00.000Z'),
    }
    const promoted = { ...waiting, status: RegistrationStatus.REGISTERED, orderId: 'order-promoted' }
    const order = { id: 'order-promoted', orderNo: 'GO-PROMOTED' }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(storedGame),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gameRegistration: {
        count: vi.fn().mockResolvedValue(3),
        findFirst: vi.fn().mockResolvedValue(waiting),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(promoted),
      },
      order: { create: vi.fn().mockResolvedValue(order) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const result = await service.promoteWaitlist('game-1', {
      sub: 'front-desk-1', displayName: '前台', roles: ['FRONT_DESK'] as never,
    })

    expect(result).toEqual({ order, registration: promoted })
    expect(tx.gameRegistration.updateMany).toHaveBeenCalledWith({
      where: { id: waiting.id, status: RegistrationStatus.WAITLISTED, orderId: null },
      data: { status: RegistrationStatus.REGISTERED },
    })
    expect(tx.order.create).toHaveBeenCalledOnce()
    expect(tx.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creationIdempotencyKey: `SYSTEM:GAME_WAITLIST:${waiting.id}`,
        creationCommandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        parameterSnapshot: expect.objectContaining({ promotedFromWaitlist: true }),
      }),
    })
    expect(tx.order.create.mock.calls[0][0].data).not.toHaveProperty('createdById')
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GAME_WAITLIST_PROMOTED' }),
    }))
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('blocks one host from promoting another host\'s waitlist', async () => {
    const tx = {
      game: { findUnique: vi.fn().mockResolvedValue({ id: 'game-1', hostId: 'host-1' }) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.promoteWaitlist('game-1', otherHostActor)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('ends a game once and snapshots only real, non-refunded check-ins', async () => {
    const storedGame = game({
      registrations: [
        registration('r-attended', RegistrationStatus.CHECKED_IN, OrderStatus.PAID),
        registration('r-refunded', RegistrationStatus.CHECKED_IN, OrderStatus.REFUNDED),
        registration('r-unpaid', RegistrationStatus.PAID, OrderStatus.PAID),
      ],
    })
    const rewardUpsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'reward-1', createdAt: new Date(), ...create }))
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(storedGame),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(storedGame, data)
          return storedGame
        }),
      },
      hostReward: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: rewardUpsert,
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      systemParameter: {
        findFirst: vi.fn().mockResolvedValue({ value: 3 }),
      },
      auditLog: { create: auditCreate },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const result = await service.complete('game-1', hostActor)

    expect(result.checkedIn).toBe(1)
    expect(result.reward).toMatchObject({
      id: 'reward-1',
      basisCount: 1,
      rewardValue: 20,
      status: RewardStatus.PENDING_OBSERVATION,
    })
    expect(rewardUpsert).toHaveBeenCalledOnce()
    expect(rewardUpsert.mock.calls[0][0].create.availableAt.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000)
    expect(storedGame.status).toBe(GameStatus.COMPLETED)
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(auditCreate.mock.calls[0][0].data.newValue).toMatchObject({
      checkedIn: 1,
      checkedInRegistrationIds: ['r-attended'],
      excludedRefundedRegistrationIds: ['r-refunded'],
      observationEndsAt: expect.any(String),
    })
  })

  it('makes complete idempotent and never creates a second reward or ledger operation', async () => {
    const storedGame = game({ registrations: [registration('r-1', RegistrationStatus.CHECKED_IN, OrderStatus.PAID)] })
    let storedReward: Record<string, unknown> | null = null
    const rewardUpsert = vi.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) => {
      storedReward = { id: 'reward-1', createdAt: new Date(), ...create }
      return Promise.resolve(storedReward)
    })
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(storedGame),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(storedGame, data)
          return storedGame
        }),
      },
      hostReward: {
        findFirst: vi.fn().mockImplementation(() => Promise.resolve(storedReward)),
        upsert: rewardUpsert,
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      systemParameter: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const first = await service.complete('game-1', hostActor)
    const second = await service.complete('game-1', hostActor)

    expect(first.reward.id).toBe(second.reward.id)
    expect(rewardUpsert).toHaveBeenCalledOnce()
    expect(tx.game.update).toHaveBeenCalledOnce()
    expect(tx.courtBooking.updateMany).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('rejects a non-owner host from checking in or completing another host game', async () => {
    const storedGame = game({ registrations: [registration('r-1', RegistrationStatus.PAID, OrderStatus.PAID)] })
    const tx = {
      gameRegistration: {
        findUnique: vi.fn().mockResolvedValue({
          ...storedGame.registrations[0],
          game: { id: 'game-1', hostId: 'host-1', status: GameStatus.OPEN },
        }),
      },
      game: { findUnique: vi.fn().mockResolvedValue(storedGame) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.checkIn('game-1', 'member-r-1', otherHostActor)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.complete('game-1', otherHostActor)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('treats a repeated check-in scan as a no-op', async () => {
    const storedRegistration = {
      ...registration('r-1', RegistrationStatus.CHECKED_IN, OrderStatus.PAID),
      game: { id: 'game-1', hostId: 'host-1', status: GameStatus.OPEN },
    }
    const tx = {
      gameRegistration: { findUnique: vi.fn().mockResolvedValue(storedRegistration), update: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const result = await service.checkIn('game-1', 'member-r-1', hostActor)

    expect(result).toBe(storedRegistration)
    expect(tx.gameRegistration.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('allows front desk staff to scan attendance without granting host control', async () => {
    const frontDesk: AuthUser = {
      sub: 'front-desk-1',
      displayName: '前台',
      roles: [AppRole.FRONT_DESK],
    }
    const storedRegistration = {
      ...registration('r-1', RegistrationStatus.PAID, OrderStatus.PAID),
      game: { id: 'game-1', hostId: 'host-1', status: GameStatus.OPEN },
    }
    const updatedRegistration = { ...storedRegistration, status: RegistrationStatus.CHECKED_IN }
    const tx = {
      gameRegistration: {
        findUnique: vi.fn().mockResolvedValue(storedRegistration),
        update: vi.fn().mockResolvedValue(updatedRegistration),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    const result = await service.checkIn('game-1', 'member-r-1', frontDesk)

    expect(result.status).toBe(RegistrationStatus.CHECKED_IN)
    expect(tx.gameRegistration.update).toHaveBeenCalledOnce()
  })

  it('holds a matured reward while a refund is still pending', async () => {
    const reward = {
      id: 'reward-1',
      hostId: 'host-1',
      gameId: 'game-1',
      rewardType: AccountType.BADMINTON_COIN,
      rewardValue: 20,
      basisCount: 1,
      status: RewardStatus.PENDING_OBSERVATION,
      availableAt: new Date('2026-08-28T00:00:00.000Z'),
      grantedAt: null,
      game: {
        id: 'game-1',
        code: 'GM-001',
        rewardRule: { type: AccountType.BADMINTON_COIN, perCheckedIn: 20, cap: 500 },
        registrations: [registration('r-pending', RegistrationStatus.CHECKED_IN, OrderStatus.REFUND_PENDING)],
      },
    }
    const candidate = { id: reward.id, status: reward.status, availableAt: reward.availableAt }
    const tx = {
      hostReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return reward
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      account: { upsert: vi.fn(), updateMany: vi.fn() },
      accountTransaction: { findUnique: vi.fn(), create: vi.fn() },
    }
    const prisma = {
      hostReward: {
        findMany: vi.fn().mockImplementation(() =>
          reward.status === RewardStatus.PENDING_OBSERVATION || reward.status === RewardStatus.AVAILABLE
            ? [candidate]
            : []),
      },
      $transaction: txRunner(tx),
    }
    const service = new GamesService(prisma as never)

    const result = await service.grantMatured(financeActor)

    expect(result.processed).toBe(1)
    expect(reward.status).toBe(RewardStatus.AVAILABLE)
    expect(tx.account.upsert).not.toHaveBeenCalled()
    expect(tx.accountTransaction.create).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('recalculates refunded check-ins and credits the host exactly once after observation', async () => {
    const reward = {
      id: 'reward-1',
      hostId: 'host-1',
      gameId: 'game-1',
      rewardType: AccountType.BADMINTON_COIN,
      rewardValue: 40,
      basisCount: 2,
      status: RewardStatus.PENDING_OBSERVATION,
      availableAt: new Date('2026-08-28T00:00:00.000Z'),
      grantedAt: null,
      game: {
        id: 'game-1',
        code: 'GM-001',
        rewardRule: { type: AccountType.BADMINTON_COIN, perCheckedIn: 20, cap: 500 },
        registrations: [
          registration('r-paid', RegistrationStatus.CHECKED_IN, OrderStatus.PAID),
          registration('r-refunded', RegistrationStatus.CHECKED_IN, OrderStatus.REFUNDED),
        ],
      },
    }
    const candidate = { id: reward.id, status: reward.status, availableAt: reward.availableAt }
    const account = { id: 'account-1', userId: 'host-1', type: AccountType.BADMINTON_COIN, balance: 100, version: 0 }
    const accountTransactions = new Map<string, { id: string; amount: number }>()
    const tx = {
      hostReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return reward
        }),
      },
      account: {
        upsert: vi.fn().mockResolvedValue(account),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { balance: { increment: number } } }) => {
          account.balance += data.balance.increment
          account.version += 1
          return { count: 1 }
        }),
      },
      accountTransaction: {
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { idempotencyKey: string } }) =>
          accountTransactions.get(where.idempotencyKey) ?? null),
        create: vi.fn().mockImplementation(async ({ data }: { data: { idempotencyKey: string; amount: number } }) => {
          const created = { id: 'txn-1', amount: data.amount }
          accountTransactions.set(data.idempotencyKey, created)
          return created
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      hostReward: {
        findMany: vi.fn().mockImplementation(() =>
          reward.status === RewardStatus.PENDING_OBSERVATION || reward.status === RewardStatus.AVAILABLE
            ? [candidate]
            : []),
      },
      $transaction: txRunner(tx),
    }
    const service = new GamesService(prisma as never)

    const first = await service.grantMatured(financeActor)
    const second = await service.grantMatured(financeActor)

    expect(first.processed).toBe(1)
    expect(second.processed).toBe(0)
    expect(reward.status).toBe(RewardStatus.GRANTED)
    expect(reward.basisCount).toBe(1)
    expect(reward.rewardValue).toBe(20)
    expect(account.balance).toBe(120)
    expect(tx.accountTransaction.create).toHaveBeenCalledOnce()
    expect(tx.accountTransaction.findUnique).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2)
  })

  it('recovers a granted reward from an existing idempotent ledger transaction', async () => {
    const reward = {
      id: 'reward-1',
      hostId: 'host-1',
      gameId: 'game-1',
      rewardType: AccountType.BADMINTON_COIN,
      rewardValue: 20,
      basisCount: 1,
      status: RewardStatus.AVAILABLE,
      availableAt: new Date('2026-08-28T00:00:00.000Z'),
      grantedAt: null,
      game: {
        id: 'game-1',
        code: 'GM-001',
        rewardRule: { type: AccountType.BADMINTON_COIN, perCheckedIn: 20, cap: 500 },
        registrations: [registration('r-paid', RegistrationStatus.CHECKED_IN, OrderStatus.PAID)],
      },
    }
    const tx = {
      hostReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return reward
        }),
      },
      accountTransaction: {
        findUnique: vi.fn().mockResolvedValue({ id: 'txn-existing', amount: 20 }),
        create: vi.fn(),
      },
      account: { upsert: vi.fn(), updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      hostReward: { findMany: vi.fn().mockResolvedValue([{ id: reward.id, status: reward.status, availableAt: reward.availableAt }]) },
      $transaction: txRunner(tx),
    }
    const service = new GamesService(prisma as never)

    await service.grantMatured(financeActor)

    expect(reward.status).toBe(RewardStatus.GRANTED)
    expect(tx.accountTransaction.create).not.toHaveBeenCalled()
    expect(tx.account.upsert).not.toHaveBeenCalled()
  })

  it('requires a finance or administrator role to release host rewards', async () => {
    const prisma = { hostReward: { findMany: vi.fn() } }
    const service = new GamesService(prisma as never)

    await expect(service.grantMatured(hostActor)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.hostReward.findMany).not.toHaveBeenCalled()
  })

  it('reverses a reward when every checked-in registration was refunded', async () => {
    const reward = {
      id: 'reward-1',
      hostId: 'host-1',
      gameId: 'game-1',
      rewardType: AccountType.BADMINTON_COIN,
      rewardValue: 20,
      basisCount: 1,
      status: RewardStatus.PENDING_OBSERVATION,
      availableAt: new Date('2026-08-28T00:00:00.000Z'),
      grantedAt: null,
      game: {
        id: 'game-1',
        code: 'GM-001',
        rewardRule: { type: AccountType.BADMINTON_COIN, perCheckedIn: 20, cap: 500 },
        registrations: [registration('r-refunded', RegistrationStatus.CHECKED_IN, OrderStatus.REFUNDED)],
      },
    }
    const tx = {
      hostReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return reward
        }),
      },
      account: { upsert: vi.fn(), updateMany: vi.fn() },
      accountTransaction: { findUnique: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({
      hostReward: { findMany: vi.fn().mockResolvedValue([{ id: reward.id, status: reward.status, availableAt: reward.availableAt }]) },
      $transaction: txRunner(tx),
    } as never)

    await service.grantMatured(financeActor)

    expect(reward.status).toBe(RewardStatus.REVERSED)
    expect(tx.accountTransaction.create).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported reward account types instead of silently crediting money', async () => {
    const reward = {
      id: 'reward-1',
      hostId: 'host-1',
      gameId: 'game-1',
      rewardType: 'COUPON',
      rewardValue: 20,
      basisCount: 1,
      status: RewardStatus.PENDING_OBSERVATION,
      availableAt: new Date('2026-08-28T00:00:00.000Z'),
      grantedAt: null,
      game: {
        id: 'game-1',
        code: 'GM-001',
        rewardRule: { type: 'COUPON', perCheckedIn: 20, cap: 500 },
        registrations: [registration('r-paid', RegistrationStatus.CHECKED_IN, OrderStatus.PAID)],
      },
    }
    const tx = {
      hostReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return reward
        }),
      },
      account: { upsert: vi.fn(), updateMany: vi.fn() },
      accountTransaction: { findUnique: vi.fn(), create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({
      hostReward: { findMany: vi.fn().mockResolvedValue([{ id: reward.id, status: reward.status, availableAt: reward.availableAt }]) },
      $transaction: txRunner(tx),
    } as never)

    await service.grantMatured(financeActor)

    expect(reward.status).toBe(RewardStatus.REJECTED)
    expect(tx.account.upsert).not.toHaveBeenCalled()
    expect(tx.accountTransaction.create).not.toHaveBeenCalled()
  })

  it('rejects completion of a cancelled game', async () => {
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(game({ status: GameStatus.CANCELLED })),
      },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.complete('game-1', hostActor)).rejects.toBeInstanceOf(ConflictException)
  })

  it('does not allow a future game to be completed before it starts', async () => {
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(game({
          startsAt: new Date(Date.now() + 60_000),
          status: GameStatus.OPEN,
        })),
      },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.complete('game-1', hostActor)).rejects.toBeInstanceOf(ConflictException)
  })

  it('does not settle an active game whose start time is invalid', async () => {
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(game({ startsAt: 'not-a-date' })),
      },
    }
    const service = new GamesService({ $transaction: txRunner(tx) } as never)

    await expect(service.complete('game-1', hostActor)).rejects.toThrow('开始时间无效')
  })
})
