import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  BookingStatus,
  BusinessType,
  FrontDeskShiftStatus,
  OrderStatus,
} from '../generated/prisma/client.js'
import { VenuesService } from './venues.service.js'

const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台甲',
  roles: [AppRole.FRONT_DESK],
}

const dto = {
  outcome: BookingStatus.COMPLETED,
  reason: '会员已完成场地使用',
  evidence: {
    source: 'COURT_INSPECTION' as const,
    observedAt: '2026-08-29T04:00:00.000Z',
  },
  idempotencyKey: 'venue-fulfillment-key-1',
}

const booking = (status = BookingStatus.CHECKED_IN) => ({
  id: 'booking-1',
  orderId: 'order-1',
  status,
  startsAt: new Date('2026-08-29T02:00:00.000Z'),
  endsAt: new Date('2026-08-29T04:00:00.000Z'),
  fulfilledAt: null,
  fulfillmentIdempotencyKey: null,
  fulfillmentCommandHash: null,
  fulfilledById: null,
  order: {
    id: 'order-1',
    businessType: BusinessType.VENUE,
    status: OrderStatus.CHECKED_IN,
    completedAt: null,
  },
})

const orderSummary = (status = OrderStatus.CHECKED_IN) => ({
  id: 'order-1',
  businessType: BusinessType.VENUE,
  status,
  completedAt: null,
  paidCents: 8_800,
  refundedCents: 0,
})

function harness(options: {
  bookingStatus?: BookingStatus
  orderStatus?: OrderStatus
  openShift?: boolean
} = {}) {
  const selectedBooking = booking(options.bookingStatus)
  selectedBooking.order.status = options.orderStatus ?? OrderStatus.CHECKED_IN
  const tx = {
    courtBooking: {
      findUnique: vi.fn(async (args: { where: Record<string, unknown> }) =>
        'fulfillmentIdempotencyKey' in args.where ? null : selectedBooking),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    frontDeskShift: {
      findFirst: vi.fn().mockResolvedValue(options.openShift === false ? null : {
        id: 'shift-1', status: FrontDeskShiftStatus.OPEN,
      }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue(orderSummary(options.orderStatus)),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        ...orderSummary(OrderStatus.COMPLETED),
        completedAt: new Date('2026-08-29T04:01:00.000Z'),
        bookings: [],
      }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma = {
    courtBooking: { findUnique: vi.fn() },
    order: { findUniqueOrThrow: vi.fn() },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  }
  return { service: new VenuesService(prisma as never), prisma, tx }
}

describe('VenuesService terminal fulfilment', () => {
  it('completes a checked-in booking and its order behind the same open shift', async () => {
    const { service, tx } = harness()

    await expect(service.completeBooking('order-1', dto, frontDesk))
      .resolves.toMatchObject({ id: 'order-1', status: OrderStatus.COMPLETED })

    expect(tx.frontDeskShift.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ operatorId: frontDesk.sub, status: FrontDeskShiftStatus.OPEN }),
    }))
    expect(tx.courtBooking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: BookingStatus.CHECKED_IN }),
      data: expect.objectContaining({
        status: BookingStatus.COMPLETED,
        fulfilledById: frontDesk.sub,
        fulfillmentEvidence: {
          source: 'COURT_INSPECTION',
          observedAt: '2026-08-29T04:00:00.000Z',
        },
      }),
    }))
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OrderStatus.COMPLETED, completedAt: expect.any(Date) }),
    }))
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2)
  })

  it('does not mark a booking no-show while its refund is pending', async () => {
    const { service, tx } = harness({
      bookingStatus: BookingStatus.CONFIRMED,
      orderStatus: OrderStatus.REFUND_PENDING,
    })

    await expect(service.completeBooking('order-1', {
      ...dto,
      outcome: BookingStatus.NO_SHOW,
      reason: '预约结束后前台点名未到',
    }, frontDesk)).rejects.toThrow('正在等待退款审批')

    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('blocks a front-desk operator without an open shift before mutations', async () => {
    const { service, tx } = harness({ openShift: false })

    await expect(service.completeBooking('order-1', dto, frontDesk))
      .rejects.toThrow('当前前台未开班')
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('rejects completion before the booking end time', async () => {
    const { service, tx } = harness()
    const future = new Date(Date.now() + 3_600_000)
    tx.courtBooking.findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      'fulfillmentIdempotencyKey' in args.where ? null : { ...booking(), endsAt: future })

    await expect(service.completeBooking('order-1', {
      ...dto,
      evidence: { ...dto.evidence, observedAt: new Date().toISOString() },
    }, frontDesk)).rejects.toBeInstanceOf(ConflictException)
    expect(tx.frontDeskShift.findFirst).not.toHaveBeenCalled()
  })

  it('replays the exact persisted command without requiring a current shift', async () => {
    const { service, prisma, tx } = harness({ openShift: false })
    let stored: Record<string, unknown> | null = null
    tx.courtBooking.findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if ('fulfillmentIdempotencyKey' in args.where) return stored
      return booking()
    })
    tx.courtBooking.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      stored = {
        ...booking(BookingStatus.COMPLETED),
        orderId: 'order-1',
        fulfillmentCommandHash: args.data.fulfillmentCommandHash,
        fulfilledById: frontDesk.sub,
      }
      return { count: 1 }
    })
    tx.frontDeskShift.findFirst.mockResolvedValueOnce({ id: 'shift-1', status: FrontDeskShiftStatus.OPEN })

    await service.completeBooking('order-1', dto, frontDesk)
    await service.completeBooking('order-1', dto, frontDesk)

    expect(tx.courtBooking.updateMany).toHaveBeenCalledOnce()
    expect(tx.frontDeskShift.findFirst).toHaveBeenCalledOnce()
    expect(tx.order.updateMany).toHaveBeenCalledOnce()
    expect(prisma.courtBooking.findUnique).not.toHaveBeenCalled()
  })
})
