import { ConflictException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { Prisma } from '../generated/prisma/client.js'
import {
  AppRole,
  BusinessType,
  OrderStatus,
  RefundStatus,
} from '../generated/prisma/enums.js'
import { OrdersService } from './orders.service.js'

const member: AuthUser = {
  sub: 'member-refund-origin',
  displayName: '退款会员',
  roles: [AppRole.MEMBER],
}
const finance: AuthUser = {
  sub: 'finance-refund-origin',
  displayName: '退款复核',
  roles: [AppRole.FINANCE],
}

const serviceWith = (prisma: Record<string, unknown>) => new OrdersService(
  prisma as never,
  {} as never,
  {} as never,
  {} as never,
)

describe('refund original order status evidence', () => {
  it('captures COMPLETED at request time without clearing completedAt', async () => {
    const completedAt = new Date('2026-08-30T08:00:00.000Z')
    const order = {
      id: 'completed-order',
      memberId: member.sub,
      businessType: BusinessType.VENUE,
      status: OrderStatus.COMPLETED,
      paidCents: 6_800,
      refundedCents: 0,
      completedAt,
      trainingEnrollment: null,
    }
    const refundCreate = vi.fn(async ({ data }: any) => ({
      id: 'refund-completed',
      status: RefundStatus.REQUESTED,
      ...data,
    }))
    const orderUpdate = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...order, refunds: [] }),
        updateMany: orderUpdate,
      },
      refund: { findUnique: vi.fn().mockResolvedValue(null), create: refundCreate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      refund: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    })

    await service.requestRefund(order.id, {
      amountCents: order.paidCents,
      reason: '服务完成后质量退款',
      idempotencyKey: 'refund-completed-request',
    }, member)

    expect(refundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: order.id,
        originalOrderStatus: OrderStatus.COMPLETED,
      }),
    })
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: order.id, status: OrderStatus.COMPLETED },
      data: { status: OrderStatus.REFUND_PENDING },
    })
    expect(JSON.stringify(orderUpdate.mock.calls[0][0])).not.toContain('completedAt')
    expect(order.completedAt).toBe(completedAt)
  })

  it.each([
    [OrderStatus.PAID, null],
    [OrderStatus.CHECKED_IN, null],
    [OrderStatus.COMPLETED, new Date('2026-08-30T08:00:00.000Z')],
  ] as const)('restores the exact %s state when the final pending refund is rejected', async (
    originalOrderStatus,
    completedAt,
  ) => {
    const refund = {
      id: `refund-${originalOrderStatus.toLowerCase()}`,
      requestedById: member.sub,
      status: RefundStatus.REQUESTED,
      originalOrderStatus,
      orderId: `order-${originalOrderStatus.toLowerCase()}`,
      order: {
        id: `order-${originalOrderStatus.toLowerCase()}`,
        status: OrderStatus.REFUND_PENDING,
        refundedCents: 0,
        completedAt,
        eventTeam: null,
      },
    }
    const orderUpdate = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi.fn().mockResolvedValue({ ...refund, status: RefundStatus.REJECTED }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: null } }),
      },
      order: { updateMany: orderUpdate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = serviceWith({
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    })

    await service.rejectRefund(refund.id, { reason: '证据不足，驳回申请' }, finance)

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: refund.orderId, status: OrderStatus.REFUND_PENDING },
      data: { status: originalOrderStatus },
    })
    expect(JSON.stringify(orderUpdate.mock.calls[0][0])).not.toContain('completedAt')
  })

  it('restores PARTIALLY_REFUNDED after another refund already succeeded', async () => {
    const refund = {
      id: 'refund-after-partial',
      requestedById: member.sub,
      status: RefundStatus.REQUESTED,
      originalOrderStatus: OrderStatus.COMPLETED,
      orderId: 'order-after-partial',
      order: {
        id: 'order-after-partial',
        status: OrderStatus.PARTIALLY_REFUNDED,
        refundedCents: 2_000,
        completedAt: new Date('2026-08-30T08:00:00.000Z'),
        eventTeam: null,
      },
    }
    const orderUpdate = vi.fn()
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi.fn().mockResolvedValue({ ...refund, status: RefundStatus.REJECTED }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }),
      },
      order: { updateMany: orderUpdate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = serviceWith({
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    })

    await service.rejectRefund(refund.id, { reason: '剩余申请证据不足' }, finance)

    expect(orderUpdate).not.toHaveBeenCalled()
  })

  it('keeps REFUND_PENDING while another refund is still active', async () => {
    const refund = {
      id: 'refund-one-of-two',
      requestedById: member.sub,
      status: RefundStatus.REQUESTED,
      originalOrderStatus: OrderStatus.PAID,
      orderId: 'order-two-pending',
      order: {
        id: 'order-two-pending',
        status: OrderStatus.REFUND_PENDING,
        refundedCents: 0,
        completedAt: null,
        eventTeam: null,
      },
    }
    const orderUpdate = vi.fn()
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi.fn().mockResolvedValue({ ...refund, status: RefundStatus.REJECTED }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 500 } }),
      },
      order: { updateMany: orderUpdate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = serviceWith({
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    })

    await service.rejectRefund(refund.id, { reason: '仅驳回其中一笔' }, finance)

    expect(orderUpdate).not.toHaveBeenCalled()
  })

  it('blocks a contradictory COMPLETED order before creating a refund', async () => {
    const order = {
      id: 'broken-completed-order',
      memberId: member.sub,
      businessType: BusinessType.VENUE,
      status: OrderStatus.COMPLETED,
      paidCents: 6_800,
      refundedCents: 0,
      completedAt: null,
      trainingEnrollment: null,
    }
    const transaction = vi.fn()
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      refund: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction,
    })

    await expect(service.requestRefund(order.id, {
      amountCents: 6_800,
      reason: '状态矛盾测试',
      idempotencyKey: 'refund-broken-completed',
    }, member)).rejects.toBeInstanceOf(ConflictException)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('fails the transaction when the order status CAS loses a race', async () => {
    const order = {
      id: 'racing-order',
      memberId: member.sub,
      businessType: BusinessType.VENUE,
      status: OrderStatus.PAID,
      paidCents: 6_800,
      refundedCents: 0,
      completedAt: null,
      trainingEnrollment: null,
    }
    const refundCreate = vi.fn().mockResolvedValue({ id: 'rolled-back-refund' })
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...order, refunds: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      refund: { findUnique: vi.fn().mockResolvedValue(null), create: refundCreate },
      auditLog: { create: vi.fn() },
    }
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      refund: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    })

    await expect(service.requestRefund(order.id, {
      amountCents: 1_000,
      reason: '并发状态测试',
      idempotencyKey: 'refund-order-race-key',
    }, member)).rejects.toThrow('订单状态已变化')
    expect(refundCreate).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('does not turn a concurrent idempotency collision into a different refund command', async () => {
    const order = {
      id: 'idempotency-racing-order',
      memberId: member.sub,
      businessType: BusinessType.VENUE,
      status: OrderStatus.PAID,
      paidCents: 6_800,
      refundedCents: 0,
      completedAt: null,
      trainingEnrollment: null,
    }
    const duplicate = {
      id: 'winning-refund',
      orderId: order.id,
      requestedById: member.sub,
      amountCents: 1_000,
      reason: '并发中的另一条命令',
    }
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      'unique constraint',
      {
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { modelName: 'Refund', target: ['idempotencyKey'] },
      },
    )
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...order, refunds: [] }),
        updateMany: vi.fn(),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(uniqueError),
      },
    }
    const refundLookup = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(duplicate)
    const service = serviceWith({
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      refund: { findUnique: refundLookup },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    })

    await expect(service.requestRefund(order.id, {
      amountCents: 2_000,
      reason: '本次并发命令',
      idempotencyKey: 'refund-concurrent-command-key',
    }, member)).rejects.toThrow('幂等键已用于不同的退款内容')
  })
})
