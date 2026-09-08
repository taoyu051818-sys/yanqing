import { describe, expect, it, vi } from 'vitest'
import { OrdersService } from './orders.service.js'

describe('purchase lifecycle scheduling and cancellation', () => {
  it('sweeps every purchase type each tick and continues after a failed sweep', async () => {
    vi.useFakeTimers()
    const service = new OrdersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    const all = vi.spyOn(service, 'expirePendingOrders').mockResolvedValue(0)
    const venue = vi
      .spyOn(service, 'expirePendingVenueOrders')
      .mockResolvedValue(0)
    try {
      service.onApplicationBootstrap()
      await vi.advanceTimersByTimeAsync(30_000)
      all.mockRejectedValueOnce(
        new Error('isolated temporary database failure'),
      )
      await vi.advanceTimersByTimeAsync(60_000)
      expect(all).toHaveBeenCalledTimes(4)
      expect(venue).not.toHaveBeenCalled()
      service.onModuleDestroy()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(all).toHaveBeenCalledTimes(4)
    } finally {
      service.onModuleDestroy()
      vi.useRealTimers()
    }
  })

  it('does not release a booking when a new prepay appears after the initial read', async () => {
    const before = {
      id: 'order',
      orderNo: 'TEST-CANCEL',
      memberId: 'member',
      businessType: 'VENUE',
      status: 'PENDING',
      items: [],
      payments: [],
      refunds: [],
      bookings: [],
    }
    const current = {
      ...before,
      payments: [
        { id: 'new-payment', status: 'PROCESSING', channel: 'WECHAT' },
      ],
    }
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn(),
      },
      payment: { updateMany: vi.fn() },
      courtBooking: { updateMany: vi.fn() },
    }
    const prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(before) },
      $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(tx)),
    }
    const closeOrder = vi.fn()
    const service = new OrdersService(
      prisma as never,
      { get: () => 'wechat' } as never,
      {} as never,
      { closeOrder } as never,
    )
    await expect(
      service.cancelPending(
        'order',
        { reason: '测试取消', idempotencyKey: 'review-cancel-key' },
        { sub: 'member', displayName: 'Test', roles: ['MEMBER'] } as never,
      ),
    ).rejects.toThrow('微信支付请求已变化')
    expect(tx.order.updateMany).not.toHaveBeenCalled()
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled()
  })

  it('reserves the system compensation idempotency namespace', async () => {
    const service = new OrdersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    await expect(
      service.requestRefund(
        'order',
        {
          reason: '测试',
          amountCents: 100,
          idempotencyKey: 'SYSTEM:LATE_PAYMENT:order',
        },
        { sub: 'member', roles: ['MEMBER'] } as never,
      ),
    ).rejects.toThrow('仅供系统使用')
  })
})
