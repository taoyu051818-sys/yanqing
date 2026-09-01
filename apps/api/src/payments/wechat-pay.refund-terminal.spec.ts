import { describe, expect, it, vi } from 'vitest'

import {
  AccountType,
  BookingStatus,
  BusinessType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  RefundStatus,
} from '../generated/prisma/client.js'
import { WechatPayService } from './wechat-pay.service.js'

describe('WechatPayService refund terminal handling', () => {
  it('never rewrites terminal venue fulfillment evidence after provider refund success', async () => {
    const order = {
      id: 'order-venue-completed',
      orderNo: 'VN202608300001',
      memberId: 'member-venue',
      businessType: BusinessType.VENUE,
      status: OrderStatus.REFUND_PENDING,
      paidCents: 6_800,
      refundedCents: 0,
      parameterSnapshot: {},
      trainingEnrollment: null,
      membership: null,
      items: [],
      gameRegistration: null,
      eventTeam: null,
      payments: [{
        id: 'payment-venue',
        status: PaymentStatus.SUCCEEDED,
        channel: PaymentChannel.WECHAT,
        amountCents: 6_800,
      }],
    }
    const refund = {
      id: 'refund-venue-completed',
      refundNo: 'RF202608300099',
      orderId: order.id,
      requestedById: order.memberId,
      approvedById: 'finance-1',
      amountCents: 6_800,
      status: RefundStatus.PROCESSING,
      order,
    }
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi.fn().mockResolvedValue({ ...refund, status: RefundStatus.SUCCEEDED }),
      },
      order: { update: vi.fn().mockResolvedValue({ ...order, status: OrderStatus.REFUNDED }) },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      referralReward: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new WechatPayService(
      { get: vi.fn() } as never,
      {
        refund: { findUnique: vi.fn().mockResolvedValue(refund) },
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
      } as never,
      {} as never,
    )

    await expect((service as any).finalizeRefund({
      out_refund_no: refund.refundNo,
      refund_id: 'wechat-refund-venue',
      refund_status: 'SUCCESS',
      amount: { refund: 6_800, total: 6_800 },
    })).resolves.toEqual({ accepted: true, outstandingRecoveryCents: 0 })

    expect(tx.courtBooking.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: order.id,
        status: {
          notIn: [BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
        },
      },
      data: { status: BookingStatus.CANCELLED },
    })
  })

  it('persists provider success, recovers available recharge value and records one shortfall risk on retries', async () => {
    const order = {
      id: 'order-recharge-1',
      orderNo: 'RC202608300001',
      memberId: 'member-1',
      businessType: BusinessType.RECHARGE,
      status: OrderStatus.REFUND_PENDING,
      paidCents: 10_000,
      refundedCents: 0,
      parameterSnapshot: { principalCents: 10_000, giftCents: 2_000 },
      trainingEnrollment: null,
      membership: null,
      items: [],
      gameRegistration: null,
      eventTeam: null,
      payments: [{
        id: 'payment-1',
        status: PaymentStatus.SUCCEEDED,
        channel: PaymentChannel.WECHAT,
        amountCents: 10_000,
      }],
    }
    const refund = {
      id: 'refund-recharge-1',
      refundNo: 'RF202608300001',
      orderId: order.id,
      requestedById: 'member-1',
      approvedById: 'finance-1',
      amountCents: 10_000,
      reason: '充值退款',
      status: RefundStatus.PROCESSING,
      providerRefundNo: null,
      completedAt: null as Date | null,
      order,
    }
    const accounts = new Map([
      [AccountType.CASH_PRINCIPAL, {
        id: 'account-principal',
        userId: order.memberId,
        type: AccountType.CASH_PRINCIPAL,
        balance: 3_000,
        frozenBalance: 0,
        version: 2,
      }],
      [AccountType.GIFT_BALANCE, {
        id: 'account-gift',
        userId: order.memberId,
        type: AccountType.GIFT_BALANCE,
        balance: 0,
        frozenBalance: 0,
        version: 1,
      }],
    ])
    const ledger = new Map<string, Record<string, any>>()
    const risks: Array<Record<string, any>> = []
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      refund: {
        findUnique: vi.fn().mockImplementation(async () => refund),
        update: vi.fn().mockImplementation(async ({ data }) => {
          Object.assign(refund, data)
          return refund
        }),
      },
      order: {
        update: vi.fn().mockImplementation(async ({ data }) => {
          Object.assign(order, data)
          return order
        }),
      },
      account: {
        findUnique: vi.fn().mockImplementation(async ({ where }) =>
          accounts.get(where.userId_type.type) ?? null),
        upsert: vi.fn().mockImplementation(async ({ where, create }) => {
          const account = {
            id: `account-${where.userId_type.type}`,
            balance: 0,
            frozenBalance: 0,
            version: 0,
            ...create,
          }
          accounts.set(where.userId_type.type, account as never)
          return account
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          const account = [...accounts.values()].find((item) => item.id === where.id)
          if (
            !account ||
            account.version !== where.version ||
            account.balance !== where.balance
          ) return { count: 0 }
          account.balance -= data.balance.decrement
          account.version += data.version.increment
          return { count: 1 }
        }),
      },
      accountTransaction: {
        findUnique: vi.fn().mockImplementation(async ({ where }) =>
          ledger.get(where.idempotencyKey) ?? null),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const row = { id: `txn-${ledger.size + 1}`, ...data }
          ledger.set(data.idempotencyKey, row)
          return row
        }),
      },
      riskEvent: {
        findFirst: vi.fn().mockImplementation(async ({ where }) =>
          risks.find((item) =>
            item.ruleCode === where.ruleCode &&
            item.objectType === where.objectType &&
            item.objectId === where.objectId,
          ) ?? null),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const row = { id: `risk-${risks.length + 1}`, ...data }
          risks.push(row)
          return row
        }),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      referralReward: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: auditCreate },
    }
    const prisma = {
      refund: { findUnique: vi.fn().mockResolvedValue(refund) },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    }
    const service = new WechatPayService(
      { get: vi.fn() } as never,
      prisma as never,
      {} as never,
    )
    const notice = {
      out_refund_no: refund.refundNo,
      refund_id: 'wechat-refund-1',
      refund_status: 'SUCCESS',
      amount: { refund: 10_000, total: 10_000 },
    }

    await expect((service as any).finalizeRefund(notice)).resolves.toEqual({
      accepted: true,
      outstandingRecoveryCents: 9_000,
    })
    await expect((service as any).finalizeRefund(notice)).resolves.toEqual({
      accepted: true,
      idempotent: true,
    })

    expect(refund).toMatchObject({
      status: RefundStatus.SUCCEEDED,
      providerRefundNo: notice.refund_id,
      completedAt: expect.any(Date),
    })
    expect(order).toMatchObject({
      refundedCents: 10_000,
      status: OrderStatus.REFUNDED,
    })
    expect(accounts.get(AccountType.CASH_PRINCIPAL)?.balance).toBe(0)
    expect(accounts.get(AccountType.GIFT_BALANCE)?.balance).toBe(0)
    expect([...ledger.values()]).toEqual([
      expect.objectContaining({
        amount: -3_000,
        balanceBefore: 3_000,
        balanceAfter: 0,
        reasonCode: 'RECHARGE_REFUND',
        idempotencyKey:
          `RECHARGE-REFUND:${refund.id}:${AccountType.CASH_PRINCIPAL}`,
      }),
    ])
    expect(risks).toHaveLength(1)
    expect(risks[0]).toMatchObject({
      ruleCode: 'RECHARGE_REFUND_BALANCE_SHORTFALL',
      orderId: order.id,
      objectId: refund.id,
      evidence: {
        externalRefundTerminal: true,
        outstandingRecoveryCents: 9_000,
        recoveryStatus: 'OUTSTANDING',
      },
    })
    expect(tx.refund.update).toHaveBeenCalledOnce()
    expect(tx.order.update).toHaveBeenCalledOnce()
    expect(tx.accountTransaction.create).toHaveBeenCalledOnce()
    expect(tx.riskEvent.create).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledOnce()
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'WECHAT_REFUND_SUCCEEDED',
        newValue: expect.objectContaining({
          outstandingRecoveryCents: 9_000,
        }),
      }),
    })
  })
})
