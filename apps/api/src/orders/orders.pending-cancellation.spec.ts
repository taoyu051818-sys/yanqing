import { describe, expect, it, vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  BookingStatus,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
} from '../generated/prisma/enums.js'
import { OrdersService } from './orders.service.js'

const member: AuthUser = {
  sub: 'member-1',
  displayName: '测试会员',
  roles: [AppRole.MEMBER],
}

const pendingVenueOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-venue-pending',
  orderNo: 'VO202609050001',
  memberId: member.sub,
  businessType: BusinessType.VENUE,
  status: OrderStatus.PENDING,
  title: '1号场 晚场一 场地预订',
  payableCents: 8_800,
  payments: [],
  refunds: [],
  items: [],
  bookings: [
    {
      id: 'booking-1',
      orderId: 'order-venue-pending',
      status: BookingStatus.HELD,
      startsAt: new Date('2099-01-01T10:00:00.000Z'),
      endsAt: new Date('2099-01-01T12:00:00.000Z'),
      holdExpiresAt: new Date('2099-01-01T00:10:00.000Z'),
      court: { id: 'court-1', name: '1号场' },
    },
  ],
  ...overrides,
})

describe('OrdersService pending venue cancellation', () => {
  const legacySweep = (closeError?: Error) => {
    const before = pendingVenueOrder({
      bookings: [{ ...pendingVenueOrder().bookings[0], status: BookingStatus.CANCELLED, holdExpiresAt: new Date('2026-09-04T00:00:00Z') }],
      payments: [{ status: PaymentStatus.PROCESSING, channel: PaymentChannel.WECHAT }],
    })
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...before, status: OrderStatus.CANCELLED }),
      },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      order: { findMany: vi.fn().mockResolvedValue([{ id: before.id }]), findUnique: vi.fn().mockResolvedValue(before) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    }
    const closeOrder = closeError ? vi.fn().mockRejectedValue(closeError) : vi.fn().mockResolvedValue({ closed: true })
    const service = new OrdersService(prisma as never, { get: () => 'wechat' } as never, {} as never, { closeOrder } as never)
    return { before, tx, prisma, closeOrder, service }
  }

  it('sweeps legacy released holds through the same safe WeChat close and audit path', async () => {
    const { service, prisma, tx, closeOrder, before } = legacySweep()
    const now = new Date('2026-09-05T00:00:00Z')
    await expect(service.expirePendingVenueOrders(now)).resolves.toBe(1)
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: OrderStatus.PENDING,
        businessType: BusinessType.VENUE,
        bookings: { some: { status: { in: [BookingStatus.HELD, BookingStatus.CANCELLED] }, holdExpiresAt: { lte: now } } },
      },
    }))
    expect(closeOrder).toHaveBeenCalledWith(before.orderNo)
    expect(closeOrder.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0])
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'VENUE_ORDER_AUTO_CANCELLED', actorId: undefined }) })
  })

  it('never closes the local legacy order when WeChat refuses to close it', async () => {
    const { service, prisma, tx } = legacySweep(new Error('微信订单已支付，等待同步'))
    await expect(service.expirePendingVenueOrders()).resolves.toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('cancels the order and releases the held court in one transaction', async () => {
    const before = pendingVenueOrder()
    const after = pendingVenueOrder({
      status: OrderStatus.CANCELLED,
      cancelledAt: new Date('2026-09-05T00:00:00.000Z'),
      bookings: [
        {
          ...pendingVenueOrder().bookings[0],
          status: BookingStatus.CANCELLED,
          holdExpiresAt: null,
        },
      ],
    })
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(after),
      },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(before) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(
      prisma as never,
      { get: vi.fn().mockReturnValue('mock') } as never,
      {} as never,
      { closeOrder: vi.fn() } as never,
    )

    await expect(service.cancelPending(
      before.id,
      { idempotencyKey: 'cancel-order-venue-1', reason: '临时有事无法到场' },
      member,
    )).resolves.toMatchObject({
      id: before.id,
      status: OrderStatus.CANCELLED,
      bookings: [{ status: BookingStatus.CANCELLED }],
    })
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: before.id, status: OrderStatus.PENDING },
      data: { status: OrderStatus.CANCELLED, cancelledAt: expect.any(Date) },
    })
    expect(tx.courtBooking.updateMany).toHaveBeenCalledWith({
      where: { orderId: before.id, status: BookingStatus.HELD },
      data: { status: BookingStatus.CANCELLED, holdExpiresAt: null },
    })
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('closes an in-flight WeChat prepay order before releasing the court', async () => {
    const before = pendingVenueOrder({
      payments: [
        {
          id: 'payment-1',
          status: PaymentStatus.PROCESSING,
          channel: PaymentChannel.WECHAT,
        },
      ],
    })
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          pendingVenueOrder({ status: OrderStatus.CANCELLED }),
        ),
      },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const closeOrder = vi.fn().mockResolvedValue({ closed: true })
    const service = new OrdersService(
      {
        order: { findUnique: vi.fn().mockResolvedValue(before) },
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
      } as never,
      { get: vi.fn().mockReturnValue('wechat') } as never,
      {} as never,
      { closeOrder } as never,
    )

    await service.cancelPending(
      before.id,
      { idempotencyKey: 'cancel-wechat-order-1' },
      member,
    )

    expect(closeOrder).toHaveBeenCalledWith(before.orderNo)
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: before.id,
        status: { in: [PaymentStatus.CREATED, PaymentStatus.PROCESSING] },
      },
      data: { status: PaymentStatus.CLOSED },
    })
  })

  it('does not let another ordinary member cancel the order', async () => {
    const before = pendingVenueOrder()
    const service = new OrdersService(
      { order: { findUnique: vi.fn().mockResolvedValue(before) } } as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(service.cancelPending(
      before.id,
      { idempotencyKey: 'cancel-other-member-1' },
      { sub: 'member-2', displayName: '其他会员', roles: [AppRole.MEMBER] },
    )).rejects.toBeInstanceOf(ForbiddenException)
  })
})
