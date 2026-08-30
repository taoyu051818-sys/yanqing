import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  BusinessType,
  OrderStatus,
} from '../generated/prisma/enums.js'
import { completeOrderFulfillment } from './order-fulfillment.js'

const actor: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
}

const order = (status: OrderStatus, completedAt: Date | null = null) => ({
  id: 'order-1',
  businessType: BusinessType.VENUE,
  status,
  completedAt,
  paidCents: 8_800,
  refundedCents: 0,
})

describe('completeOrderFulfillment', () => {
  it('CAS-completes a checked-in order and writes one immutable audit event', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(order(OrderStatus.CHECKED_IN)),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const completedAt = new Date('2026-08-30T08:00:00.000Z')

    const result = await completeOrderFulfillment(tx as never, {
      orderId: 'order-1', actor, objectType: 'CourtBooking', objectId: 'booking-1',
      outcome: 'COMPLETED', completedAt,
    })

    expect(result).toMatchObject({ changed: true, order: { status: OrderStatus.COMPLETED, completedAt } })
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.CHECKED_IN, completedAt: null },
      data: { status: OrderStatus.COMPLETED, completedAt },
    })
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it.each([OrderStatus.PARTIALLY_REFUNDED])(
    'preserves financial summary status %s after service delivery',
    async (status) => {
      const tx = {
        order: {
          findUnique: vi.fn().mockResolvedValue(order(status)),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }

      const result = await completeOrderFulfillment(tx as never, {
        orderId: 'order-1', actor, objectType: 'CourtBooking', objectId: 'booking-1',
        outcome: 'NO_SHOW', reason: '预约结束未到场',
      })

      expect(result.order.status).toBe(status)
      expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status }),
      }))
    },
  )

  it('returns an already completed order without another update or audit', async () => {
    const completedAt = new Date('2026-08-30T08:00:00.000Z')
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(order(OrderStatus.COMPLETED, completedAt)),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }

    await expect(completeOrderFulfillment(tx as never, {
      orderId: 'order-1', actor, objectType: 'CourtBooking', objectId: 'booking-1', outcome: 'COMPLETED',
    })).resolves.toMatchObject({ changed: false })
    expect(tx.order.updateMany).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it.each([
    OrderStatus.PENDING,
    OrderStatus.REFUND_PENDING,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
  ])(
    'rejects non-deliverable status %s',
    async (status) => {
      const tx = {
        order: { findUnique: vi.fn().mockResolvedValue(order(status)), updateMany: vi.fn() },
        auditLog: { create: vi.fn() },
      }
      await expect(completeOrderFulfillment(tx as never, {
        orderId: 'order-1', actor, objectType: 'CourtBooking', objectId: 'booking-1', outcome: 'COMPLETED',
      })).rejects.toBeInstanceOf(ConflictException)
      expect(tx.order.updateMany).not.toHaveBeenCalled()
    },
  )
})
