import { describe, expect, it, vi } from 'vitest'

import { ConflictException, ForbiddenException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  GameStatus,
  OrderStatus,
  RegistrationStatus,
  RefundStatus,
} from '../generated/prisma/client.js'
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js'
import { GamesService } from './games.service.js'

const hostActor: AuthUser = {
  sub: 'host-1',
  displayName: '主理人',
  roles: [AppRole.HOST],
}

const cancelDto = {
  reason: '场馆临时停电',
  idempotencyKey: 'game-cancel-key-1',
}

const activeGame = (overrides: Record<string, unknown> = {}) => ({
  id: 'game-1',
  code: 'GM-001',
  title: '周末球局',
  hostId: 'host-1',
  status: GameStatus.OPEN,
  startsAt: new Date(Date.now() + 60 * 60_000),
  createdAt: new Date(Date.now() - 60_000),
  cancelReason: null,
  cancelPolicySnapshot: null,
  cancelIdempotencyKey: null,
  cancelCommandHash: null,
  cancelledById: null,
  cancelledAt: null,
  ...overrides,
})

describe('GamesService cancellation', () => {
  it('atomically cancels the game and courts, closes unpaid orders and requests paid refunds', async () => {
    const current = activeGame()
    const registrations = [
      {
        id: 'registration-waitlist',
        gameId: current.id,
        status: RegistrationStatus.WAITLISTED,
        checkedInAt: null,
        createdAt: new Date(),
        order: null,
      },
      {
        id: 'registration-unpaid',
        gameId: current.id,
        status: RegistrationStatus.REGISTERED,
        checkedInAt: null,
        createdAt: new Date(),
        order: {
          id: 'order-unpaid',
          status: OrderStatus.PENDING,
          paidCents: 0,
          refundedCents: 0,
          refunds: [],
        },
      },
      {
        id: 'registration-paid',
        gameId: current.id,
        status: RegistrationStatus.PAID,
        checkedInAt: null,
        createdAt: new Date(),
        order: {
          id: 'order-paid',
          status: OrderStatus.PAID,
          paidCents: 6_800,
          refundedCents: 800,
          refunds: [],
        },
      },
    ]
    const refund = {
      id: 'refund-1',
      orderId: 'order-paid',
      requestedById: hostActor.sub,
      amountCents: 6_000,
      reason: `球局取消：${cancelDto.reason}`,
      status: RefundStatus.REQUESTED,
    }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...current,
          status: GameStatus.CANCELLED,
        }),
      },
      gameRegistration: {
        findMany: vi.fn().mockResolvedValue(registrations),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(refund),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      game: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(tx)),
    }
    const service = new GamesService(prisma as never)

    const result = await service.cancel(current.id, cancelDto, hostActor)

    expect(result).toMatchObject({
      cancelledBookingCount: 2,
      cancelledPendingOrders: 1,
      cancelledRegistrationIds: registrations.map((registration) => registration.id),
      refundRequests: [refund],
    })
    expect(tx.game.updateMany).toHaveBeenCalledWith({
      where: {
        id: current.id,
        status: GameStatus.OPEN,
        startsAt: { gt: expect.any(Date) },
      },
      data: expect.objectContaining({
        status: GameStatus.CANCELLED,
        cancelReason: cancelDto.reason,
        cancelIdempotencyKey: cancelDto.idempotencyKey,
        cancelledById: hostActor.sub,
        cancelledAt: expect.any(Date),
      }),
    })
    expect(tx.courtBooking.updateMany).toHaveBeenCalledWith({
      where: { gameId: current.id, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    })
    expect(tx.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: `GAME_CANCEL:${current.id}:order-paid`,
        orderId: 'order-paid',
        requestedById: hostActor.sub,
        amountCents: 6_000,
        status: RefundStatus.REQUESTED,
        originalOrderStatus: OrderStatus.PARTIALLY_REFUNDED,
      }),
    })
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-paid',
        status: {
          in: [
            OrderStatus.PAID,
            OrderStatus.CHECKED_IN,
            OrderStatus.COMPLETED,
            OrderStatus.PARTIALLY_REFUNDED,
          ],
        },
      },
      data: { status: OrderStatus.REFUND_PENDING },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'GAME_CANCELLED' }),
    })
  })

  it('uses the active refund evidence when a paid order is already refund-pending', async () => {
    const current = activeGame()
    const registration = {
      id: 'registration-refund-pending',
      gameId: current.id,
      status: RegistrationStatus.PAID,
      checkedInAt: null,
      createdAt: new Date(),
      order: {
        id: 'order-refund-pending',
        status: OrderStatus.REFUND_PENDING,
        paidCents: 6_800,
        refundedCents: 0,
        refunds: [
          {
            id: 'refund-existing',
            status: RefundStatus.REQUESTED,
            amountCents: 1_000,
            originalOrderStatus: OrderStatus.CHECKED_IN,
          },
        ],
      },
    }
    const createdRefund = {
      id: 'refund-game-cancel',
      orderId: registration.order.id,
      amountCents: 5_800,
      status: RefundStatus.REQUESTED,
    }
    const tx = {
      game: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ...current,
          status: GameStatus.CANCELLED,
        }),
      },
      gameRegistration: {
        findMany: vi.fn().mockResolvedValue([registration]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      payment: { updateMany: vi.fn() },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(createdRefund),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new GamesService({
      game: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(tx)),
    } as never)

    await expect(
      service.cancel(current.id, cancelDto, hostActor),
    ).resolves.toMatchObject({ refundRequests: [createdRefund] })
    expect(tx.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: registration.order.id,
        amountCents: 5_800,
        originalOrderStatus: OrderStatus.CHECKED_IN,
      }),
    })
  })

  it('replays the exact command without a second transaction', async () => {
    const commandHash = orderCreationCommandHash({
      kind: 'GAME_CANCEL',
      gameId: 'game-1',
      reason: cancelDto.reason,
      actorId: hostActor.sub,
    })
    const existing = activeGame({
      status: GameStatus.CANCELLED,
      cancelReason: cancelDto.reason,
      cancelIdempotencyKey: cancelDto.idempotencyKey,
      cancelCommandHash: commandHash,
      cancelledById: hostActor.sub,
      cancelledAt: new Date(),
    })
    const transaction = vi.fn()
    const service = new GamesService({
      game: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: transaction,
    } as never)

    await expect(
      service.cancel(existing.id, cancelDto, hostActor),
    ).resolves.toEqual({ game: existing, idempotent: true })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rejects a different host and refuses cancellation after the start time', async () => {
    const tx = {
      game: { findUnique: vi.fn().mockResolvedValue(activeGame()) },
    }
    const service = new GamesService({
      game: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work) => work(tx)),
    } as never)
    const otherHost = {
      ...hostActor,
      sub: 'host-2',
    }

    await expect(
      service.cancel('game-1', cancelDto, otherHost),
    ).rejects.toBeInstanceOf(ForbiddenException)

    tx.game.findUnique.mockResolvedValue(
      activeGame({ startsAt: new Date(Date.now() - 1_000) }),
    )
    await expect(
      service.cancel('game-1', cancelDto, hostActor),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})
