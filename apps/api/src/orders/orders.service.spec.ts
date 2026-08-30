import { describe, expect, it, vi } from 'vitest'

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import {
  AppRole,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  RefundStatus,
} from '../generated/prisma/enums.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { OrdersService } from './orders.service.js'

const actor: AuthUser = { sub: 'maker-1', displayName: '财务', roles: [AppRole.FINANCE] }

describe('OrdersService refund controls', () => {
  it('rejects approving a refund created by the same account', async () => {
    const refund = {
      id: 'refund-1',
      requestedById: actor.sub,
      status: RefundStatus.REQUESTED,
      amountCents: 6800,
      orderId: 'order-1',
      order: { payments: [], memberId: 'member-1' },
    }
    const tx = {
      refund: { findUnique: vi.fn().mockResolvedValue(refund) },
    }
    const prisma = {
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(
      prisma as never,
      { get: vi.fn().mockReturnValue('mock') } as never,
      {} as never,
      {} as never,
    )

    await expect(
      service.approveRefund('refund-1', { reason: '同账号测试' }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.refund.findUnique).toHaveBeenCalledOnce()
  })

  it('keeps the refund status gate before any money movement', async () => {
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'refund-2',
          requestedById: 'another-user',
          status: RefundStatus.SUCCEEDED,
          order: { payments: [] },
        }),
      },
    }
    const prisma = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    await expect(
      service.approveRefund('refund-2', { reason: '重复审批' }, actor),
    ).rejects.toThrow('退款申请已处理')
  })

  it('rejects a refund and restores the order to a payable state', async () => {
    const refund = {
      id: 'refund-3',
      requestedById: 'front-desk-1',
      status: RefundStatus.REQUESTED,
      originalOrderStatus: OrderStatus.PAID,
      orderId: 'order-3',
      order: { id: 'order-3', refundedCents: 0, completedAt: null, status: OrderStatus.REFUND_PENDING },
    }
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi.fn().mockResolvedValue({ ...refund, status: RefundStatus.REJECTED }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }),
      },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    const result = await service.rejectRefund('refund-3', { reason: '资料不完整' }, actor)

    expect(result.status).toBe(RefundStatus.REJECTED)
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-3', status: OrderStatus.REFUND_PENDING },
      data: { status: OrderStatus.PAID },
    })
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it.each([
    'GAME_CANCEL:game-1:order-1',
    'EVENT_CANCEL:event-1:order-1',
    'EVENT_LATE_PAYMENT:order-1',
  ])('does not allow a terminal system refund to be rejected (%s)', async (idempotencyKey) => {
    const refund = {
      id: `refund-${idempotencyKey}`,
      requestedById: 'member-1',
      status: RefundStatus.REQUESTED,
      idempotencyKey,
      originalOrderStatus: OrderStatus.PAID,
      orderId: 'order-1',
      order: {
        id: 'order-1',
        refundedCents: 0,
        completedAt: null,
        status: OrderStatus.REFUND_PENDING,
        eventTeam: null,
      },
    }
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi.fn(),
        aggregate: vi.fn(),
      },
      order: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const service = new OrdersService(
      { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) } as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(
      service.rejectRefund(refund.id, { reason: '不应恢复强制取消订单' }, actor),
    ).rejects.toThrow('系统强制退款不可驳回')
    expect(tx.refund.update).not.toHaveBeenCalled()
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('counts other pending refunds before accepting a new request', async () => {
    const order = {
      id: 'order-4',
      memberId: actor.sub,
      status: OrderStatus.PAID,
      paidCents: 1000,
      refundedCents: 0,
    }
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          ...order,
          refunds: [{ amountCents: 800 }],
        }),
        updateMany: vi.fn(),
      },
      refund: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    await expect(
      service.requestRefund('order-4', { amountCents: 300, reason: '超过剩余额度' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.refund.create).not.toHaveBeenCalled()
  })

  it('rejects a training refund that exceeds the unconsumed prepaid balance', async () => {
    const order = {
      id: 'training-order-1',
      memberId: 'member-1',
      status: OrderStatus.PAID,
      businessType: BusinessType.TRAINING,
      paidCents: 100_000,
      refundedCents: 0,
      trainingEnrollment: { prepaidBalanceCents: 40_000 },
    }
    const tx = {
      order: { findUnique: vi.fn().mockResolvedValue({ ...order, refunds: [] }), updateMany: vi.fn() },
      refund: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    await expect(service.requestRefund(
      order.id,
      { amountCents: 40_001, reason: '申请退剩余课包' },
      { sub: order.memberId, displayName: '家长', roles: [AppRole.MEMBER] },
    )).rejects.toThrow('超过未消课预收余额')
    expect(tx.refund.create).not.toHaveBeenCalled()
  })

  it('reserves pending training refunds against the prepaid balance', async () => {
    const order = {
      id: 'training-order-2',
      memberId: 'member-2',
      status: OrderStatus.PAID,
      businessType: BusinessType.TRAINING,
      paidCents: 100_000,
      refundedCents: 0,
      trainingEnrollment: { prepaidBalanceCents: 60_000 },
    }
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...order, refunds: [{ amountCents: 30_000 }] }),
        updateMany: vi.fn(),
      },
      refund: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    await expect(service.requestRefund(
      order.id,
      { amountCents: 40_000, reason: '并发退费测试' },
      { sub: order.memberId, displayName: '家长', roles: [AppRole.MEMBER] },
    )).rejects.toThrow('超过未消课预收余额')
    expect(tx.refund.create).not.toHaveBeenCalled()
  })

  it('rechecks the training prepaid balance before finance releases money', async () => {
    const refund = {
      id: 'training-refund-1',
      refundNo: 'RF001',
      requestedById: 'member-3',
      status: RefundStatus.REQUESTED,
      amountCents: 30_000,
      orderId: 'training-order-3',
      order: {
        id: 'training-order-3',
        memberId: 'member-3',
        businessType: BusinessType.TRAINING,
        payments: [{ channel: PaymentChannel.WECHAT, status: PaymentStatus.SUCCEEDED, amountCents: 100_000 }],
        trainingEnrollment: { id: 'enrollment-3', prepaidBalanceCents: 20_000 },
      },
    }
    const tx = {
      refund: { findUnique: vi.fn().mockResolvedValue(refund), update: vi.fn() },
    }
    const prisma = {
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(
      prisma as never,
      { get: vi.fn().mockReturnValue('mock') } as never,
      {} as never,
      {} as never,
    )

    await expect(service.approveRefund(
      refund.id,
      { reason: '财务复核' },
      actor,
    )).rejects.toThrow('当前未消课预收余额不足')
    expect(tx.refund.update).not.toHaveBeenCalled()
  })

  it('returns the original request for a repeated idempotency key', async () => {
    const order = {
      id: 'order-idempotent',
      memberId: 'member-1',
      status: OrderStatus.PAID,
      paidCents: 1000,
      refundedCents: 0,
    }
    const original = {
      id: 'refund-original',
      idempotencyKey: 'refund-key-1',
      orderId: order.id,
      requestedById: order.memberId,
      amountCents: 1000,
      reason: '重复点击',
      status: RefundStatus.REQUESTED,
    }
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...order, refunds: [] }),
        updateMany: vi.fn(),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(original),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      refund: { findUnique: vi.fn().mockResolvedValue(original) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    const result = await service.requestRefund(
      order.id,
      { amountCents: 1000, reason: '重复点击', idempotencyKey: 'refund-key-1' },
      { sub: order.memberId, displayName: '会员', roles: [AppRole.MEMBER] },
    )

    expect(result).toBe(original)
    expect(tx.refund.create).not.toHaveBeenCalled()
    expect(tx.order.updateMany).not.toHaveBeenCalled()
  })

  it('rejects reusing an idempotency key with different refund content', async () => {
    const order = {
      id: 'order-idempotent-2',
      memberId: 'member-1',
      status: OrderStatus.PAID,
      paidCents: 1000,
      refundedCents: 0,
    }
    const original = {
      id: 'refund-original-2',
      idempotencyKey: 'refund-key-2',
      orderId: order.id,
      requestedById: order.memberId,
      amountCents: 500,
      reason: '原始申请',
      status: RefundStatus.REQUESTED,
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      refund: { findUnique: vi.fn().mockResolvedValue(original) },
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)

    await expect(service.requestRefund(
      order.id,
      { amountCents: 1000, reason: '篡改内容', idempotencyKey: 'refund-key-2' },
      { sub: order.memberId, displayName: '会员', roles: [AppRole.MEMBER] },
    )).rejects.toThrow('不同的退款内容')
  })
})

describe('OrdersService front-desk payment and refund gate', () => {
  const frontDesk: AuthUser = {
    sub: 'front-desk-1',
    displayName: '前台',
    roles: [AppRole.FRONT_DESK],
  }
  const administrator: AuthUser = {
    sub: 'admin-1',
    displayName: '管理员',
    roles: [AppRole.ADMIN],
  }
  const member: AuthUser = {
    sub: 'member-1',
    displayName: '会员',
    roles: [AppRole.MEMBER],
  }
  const order = {
    id: 'order-cash-1',
    orderNo: 'VN001',
    memberId: member.sub,
    status: OrderStatus.PENDING,
    businessType: BusinessType.VENUE,
    payableCents: 6_800,
    items: [],
    membership: null,
    member: { openId: null },
  }

  const paymentHarness = (shift: { id: string } | null) => {
    const payment = {
      id: 'payment-cash-1',
      paymentNo: 'PAY001',
      orderId: order.id,
      userId: order.memberId,
      operatorId: frontDesk.sub,
      channel: PaymentChannel.OFFLINE_CASH,
      amountCents: order.payableCents,
      idempotencyKey: 'cash-payment-key-1',
      status: PaymentStatus.CREATED,
    }
    const tx = {
      order: { findUnique: vi.fn().mockResolvedValue(order) },
      frontDeskShift: { findFirst: vi.fn().mockResolvedValue(shift) },
      payment: {
        create: vi.fn().mockResolvedValue(payment),
        update: vi.fn().mockResolvedValue({ ...payment, status: PaymentStatus.SUCCEEDED }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      payment: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const finalizer = { finalize: vi.fn().mockResolvedValue(undefined) }
    return {
      tx,
      prisma,
      finalizer,
      service: new OrdersService(
        prisma as never,
        { get: vi.fn().mockReturnValue('mock') } as never,
        finalizer as never,
        {} as never,
      ),
    }
  }

  it('requires an open shift for front-desk offline cash and persists the cashier', async () => {
    const closed = paymentHarness(null)
    await expect(closed.service.pay(order.id, {
      channel: PaymentChannel.OFFLINE_CASH,
      idempotencyKey: 'cash-payment-key-1',
    }, frontDesk)).rejects.toBeInstanceOf(ConflictException)
    expect(closed.tx.payment.create).not.toHaveBeenCalled()

    const open = paymentHarness({ id: 'shift-open' })
    await expect(open.service.pay(order.id, {
      channel: PaymentChannel.OFFLINE_CASH,
      idempotencyKey: 'cash-payment-key-1',
    }, frontDesk)).resolves.toMatchObject({ status: PaymentStatus.SUCCEEDED })
    expect(open.tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: member.sub,
        operatorId: frontDesk.sub,
        channel: PaymentChannel.OFFLINE_CASH,
      }),
    })
    expect(open.finalizer.finalize).toHaveBeenCalledOnce()
  })

  it('forbids finance proxy payment, employee account debit, and member offline cash', async () => {
    const financeHarness = paymentHarness({ id: 'shift-open' })
    await expect(financeHarness.service.pay(order.id, {
      channel: PaymentChannel.OFFLINE_CASH,
      idempotencyKey: 'finance-cash-key-1',
    }, actor)).rejects.toBeInstanceOf(ForbiddenException)

    const accountHarness = paymentHarness({ id: 'shift-open' })
    await expect(accountHarness.service.pay(order.id, {
      channel: PaymentChannel.CASH_PRINCIPAL,
      idempotencyKey: 'employee-debit-key-1',
    }, frontDesk)).rejects.toThrow('员工不得代扣')

    const selfOrder = { ...order, memberId: member.sub }
    const selfHarness = paymentHarness({ id: 'shift-open' })
    selfHarness.tx.order.findUnique.mockResolvedValueOnce(selfOrder)
    await expect(selfHarness.service.pay(order.id, {
      channel: PaymentChannel.OFFLINE_CASH,
      idempotencyKey: 'member-cash-key-1',
    }, member)).rejects.toThrow('会员本人不能使用线下现金')
  })

  it('allows an audited administrator emergency cash collection without a shift', async () => {
    const harness = paymentHarness(null)
    await expect(harness.service.pay(order.id, {
      channel: PaymentChannel.OFFLINE_CASH,
      idempotencyKey: 'admin-cash-key-1',
    }, administrator)).resolves.toMatchObject({ status: PaymentStatus.SUCCEEDED })
    expect(harness.tx.frontDeskShift.findFirst).not.toHaveBeenCalled()
    expect(harness.tx.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ operatorId: administrator.sub }),
    })
    expect(harness.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_GATE_BYPASSED',
        objectType: 'Payment',
      }),
    })
  })

  it('gates assisted refunds while member self-service remains independent', async () => {
    const paidOrder = {
      ...order,
      status: OrderStatus.PAID,
      paidCents: order.payableCents,
      refundedCents: 0,
      trainingEnrollment: null,
    }
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...paidOrder, refunds: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'refund-assisted-1',
          orderId: order.id,
          requestedById: frontDesk.sub,
          amountCents: order.payableCents,
          reason: '代客退款',
          status: RefundStatus.REQUESTED,
        }),
      },
      frontDeskShift: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(paidOrder) },
      refund: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    }
    const service = new OrdersService(prisma as never, {} as never, {} as never, {} as never)
    const command = {
      amountCents: order.payableCents,
      reason: '代客退款',
      idempotencyKey: 'assisted-refund-key-1',
    }

    await expect(service.requestRefund(order.id, command, frontDesk))
      .rejects.toBeInstanceOf(ConflictException)
    expect(tx.refund.create).not.toHaveBeenCalled()

    tx.order.findUnique.mockResolvedValueOnce({ ...paidOrder, refunds: [] })
    tx.refund.create.mockResolvedValueOnce({
      id: 'refund-self-1',
      orderId: order.id,
      requestedById: member.sub,
      amountCents: order.payableCents,
      reason: '本人退款',
      status: RefundStatus.REQUESTED,
    })
    await expect(service.requestRefund(order.id, {
      ...command,
      reason: '本人退款',
      idempotencyKey: 'self-refund-key-1',
    }, member)).resolves.toMatchObject({ id: 'refund-self-1' })
  })

  it('forbids finance assisted refunds and audits the administrator bypass', async () => {
    const paidOrder = {
      ...order,
      status: OrderStatus.PAID,
      paidCents: order.payableCents,
      refundedCents: 0,
      trainingEnrollment: null,
    }
    const transaction = vi.fn()
    const financeService = new OrdersService({
      order: { findUnique: vi.fn().mockResolvedValue(paidOrder) },
      refund: { findUnique: vi.fn() },
      $transaction: transaction,
    } as never, {} as never, {} as never, {} as never)
    await expect(financeService.requestRefund(order.id, {
      amountCents: order.payableCents,
      reason: '财务代客退款',
      idempotencyKey: 'finance-refund-key-1',
    }, actor)).rejects.toBeInstanceOf(ForbiddenException)
    expect(transaction).not.toHaveBeenCalled()

    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({ ...paidOrder, refunds: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'refund-admin-1',
          orderId: order.id,
          requestedById: administrator.sub,
          amountCents: order.payableCents,
          reason: '管理员应急退款',
          status: RefundStatus.REQUESTED,
        }),
      },
      frontDeskShift: { findFirst: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const adminService = new OrdersService({
      order: { findUnique: vi.fn().mockResolvedValue(paidOrder) },
      refund: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    } as never, {} as never, {} as never, {} as never)
    await expect(adminService.requestRefund(order.id, {
      amountCents: order.payableCents,
      reason: '管理员应急退款',
      idempotencyKey: 'admin-refund-key-1',
    }, administrator)).resolves.toMatchObject({ id: 'refund-admin-1' })
    expect(tx.frontDeskShift.findFirst).not.toHaveBeenCalled()
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_GATE_BYPASSED',
        objectType: 'Refund',
      }),
    })
  })
})
