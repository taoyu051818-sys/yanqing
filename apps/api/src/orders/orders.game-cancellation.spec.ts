import { describe, expect, it, vi } from 'vitest'
import { OrdersService } from './orders.service.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, OrderStatus, PaymentStatus } from '../generated/prisma/enums.js'

const actor: AuthUser = { sub: 'member-1', displayName: '球友', roles: [AppRole.MEMBER] }
const command = { idempotencyKey: 'cancel-my-game-1', reason: '临时有事' }
function harness(overrides: Record<string, any> = {}) {
  const game = { id: 'game-1', title: '双打球局', hostId: 'host-1', capacity: 6, feeCents: 6800, status: 'FULL' }
  const before = { id: 'order-1', orderNo: 'GO-1', status: 'PENDING', memberId: actor.sub, businessType: 'GAME', title: game.title, payments: [], items: [], refunds: [], bookings: [], gameRegistration: { id: 'reg-1', gameId: game.id, status: 'REGISTERED', game }, ...overrides }
  const tx = {
    order: { findUnique: vi.fn().mockResolvedValue(before), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ ...before, status: 'CANCELLED' }), create: vi.fn().mockResolvedValue({ id: 'promoted-order' }) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    courtBooking: { updateMany: vi.fn() },
    game: { findUnique: vi.fn().mockResolvedValue(game), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(5), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({ id: 'waiting-1' }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma = { order: { findUnique: vi.fn().mockResolvedValue(before) }, $transaction: vi.fn(async (work: any) => work(tx)) }
  const closeOrder = vi.fn().mockResolvedValue({})
  const service = new OrdersService(prisma as never, { get: () => 'wechat' } as never, {} as never, { closeOrder } as never)
  return { before, tx, prisma, service, closeOrder }
}

describe('pending game order cancellation', () => {
  it('releases only the member seat, reopens a full game and writes an audit record', async () => {
    const { service, tx, prisma } = harness()
    await expect(service.cancelPending('order-1', command, actor)).resolves.toMatchObject({ status: 'CANCELLED' })
    expect(tx.gameRegistration.updateMany).toHaveBeenCalledWith({ where: { id: 'reg-1', orderId: 'order-1', status: 'REGISTERED' }, data: { status: 'CANCELLED' } })
    expect(tx.game.updateMany).toHaveBeenCalledWith({ where: { id: 'game-1', status: 'FULL' }, data: { status: 'OPEN' } })
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'GAME_ORDER_CANCELLED_BY_USER', actorId: actor.sub, newValue: expect.objectContaining({ gameId: 'game-1', registrationStatus: 'CANCELLED' }) }) })
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' })
  })

  it('promotes the oldest waiting member exactly once into a new unpaid order', async () => {
    const { service, tx } = harness()
    tx.gameRegistration.findFirst.mockResolvedValue({ id: 'waiting-1', userId: 'waiting-member' } as never)
    await service.cancelPending('order-1', command, actor)
    expect(tx.gameRegistration.findFirst).toHaveBeenCalledWith({ where: { gameId: 'game-1', status: 'WAITLISTED', orderId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, userId: true } })
    expect(tx.order.create).toHaveBeenCalledOnce()
    expect(tx.order.create.mock.calls[0][0].data).toMatchObject({ memberId: 'waiting-member', status: 'PENDING', payableCents: 6800 })
    expect(tx.gameRegistration.update).toHaveBeenCalledWith({ where: { id: 'waiting-1' }, data: { orderId: 'promoted-order' } })
  })

  it('blocks another member and never mutates a paid order', async () => {
    const unauthorized = harness()
    await expect(unauthorized.service.cancelPending('order-1', command, { ...actor, sub: 'other-member' })).rejects.toMatchObject({ status: 403 })
    expect(unauthorized.prisma.$transaction).not.toHaveBeenCalled()
    for (const overrides of [{ status: OrderStatus.PAID }, { payments: [{ status: PaymentStatus.SUCCEEDED }] }]) {
      const { service, prisma } = harness(overrides)
      await expect(service.cancelPending('order-1', command, actor)).rejects.toMatchObject({ status: 409 })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    }
  })

  it('closes WeChat prepay before entering the release transaction, and fails closed on close errors', async () => {
    const { service, closeOrder, prisma } = harness({ payments: [{ status: 'PROCESSING', channel: 'WECHAT' }] })
    closeOrder.mockRejectedValueOnce(new Error('微信关单失败'))
    await expect(service.cancelPending('order-1', command, actor)).rejects.toThrow('微信关单失败')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    await service.cancelPending('order-1', command, actor)
    expect(closeOrder.mock.invocationCallOrder[1]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0])
  })

  it('blocks payment races and returns cancellation replays without another seat release', async () => {
    const race = harness()
    race.tx.order.findUnique.mockResolvedValue({ ...race.before, status: 'PAID' })
    await expect(race.service.cancelPending('order-1', command, actor)).rejects.toMatchObject({ status: 409 })
    expect(race.tx.gameRegistration.updateMany).not.toHaveBeenCalled()
    const replay = harness({ status: 'CANCELLED' })
    await expect(replay.service.cancelPending('order-1', command, actor)).resolves.toMatchObject({ status: 'CANCELLED' })
    expect(replay.prisma.$transaction).not.toHaveBeenCalled()
  })
})
