import { describe, expect, it, vi } from 'vitest';
import { requireOrderTransition, transitionOrder } from './order-transition.js';

const fixture = () => ({
  order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
});
describe('order transition preconditions', () => {
  it('rejects an unbounded or unspecified source state before writing', async () => {
    const tx = fixture();
    for (const where of [
      { id: 'order' },
      { id: { not: 'order' }, status: 'PENDING' },
      { status: 'PENDING' },
      { id: 'order', status: { not: 'CANCELLED' } },
    ]) {
      await expect(
        transitionOrder(tx as never, 'PAY', {
          where,
          data: { status: 'PAID' },
        } as never),
      ).rejects.toThrow('缺少原状态');
    }
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
  it('cannot hide an illegal source state inside a batch predicate', async () => {
    const tx = fixture();
    await expect(
      transitionOrder(tx as never, 'PAY', {
        where: { id: 'order', status: { in: ['PENDING', 'REFUNDED'] } },
        data: { status: 'PAID' },
      }),
    ).rejects.toThrow('不合法');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
  it('requires free cancellation to preserve the financial and fulfillment predicates', async () => {
    const tx = fixture();
    const evidence = {
      id: 'order',
      status: 'PAID' as const,
      payableCents: 0,
      paidCents: 0,
      refundedCents: 0,
      completedAt: null,
    };
    for (const field of [
      'payableCents',
      'paidCents',
      'refundedCents',
      'completedAt',
    ]) {
      const where = { ...evidence } as Record<string, unknown>;
      delete where[field];
      await expect(
        transitionOrder(tx as never, 'CANCEL_FREE', {
          where,
          data: { status: 'CANCELLED' },
        }),
      ).rejects.toThrow('零金额和未完成');
    }
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
  it('preserves partial-refund financial state while recording venue check-in', async () => {
    const tx = fixture();
    await transitionOrder(tx as never, 'CHECK_IN', {
      where: { id: 'order', status: 'PARTIALLY_REFUNDED' },
      data: { status: 'PARTIALLY_REFUNDED' },
    });
    for (const [from, to] of [
      ['PARTIALLY_REFUNDED', 'CHECKED_IN'],
      ['REFUNDED', 'CHECKED_IN'],
      ['REFUND_PENDING', 'CHECKED_IN'],
    ]) {
      await expect(
        transitionOrder(tx as never, 'CHECK_IN', {
          where: { id: 'order', status: from },
          data: { status: to },
        } as never),
      ).rejects.toThrow('不合法');
    }
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
  });
  it('turns a stale single-order write into an explicit conflict', async () => {
    const tx = fixture();
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      requireOrderTransition(tx as never, 'PAY', {
        where: { id: 'order', status: 'PENDING' },
        data: { status: 'PAID' },
      }),
    ).rejects.toThrow('已被其他操作更新');
  });
});
