import { describe, expect, it } from 'vitest';

import { orderResponse } from './order-response.js';

describe('orderResponse', () => {
  it('projects remaining lessons, student display name and actual court fulfillment timestamp', () => {
    const fulfilledAt = new Date('2026-09-10T03:00:00Z');
    const result = orderResponse({
      id: 'order',
      status: 'COMPLETED',
      businessType: 'TRAINING',
      trainingEnrollment: {
        id: 'enrollment',
        status: 'ACTIVE',
        totalSessions: 12,
        consumedSessions: 5,
        student: { id: 'student', displayName: '学员小林' },
      },
      bookings: [{ id: 'booking', status: 'COMPLETED', fulfilledAt }],
    } as never);
    expect(result.trainingEnrollment).toMatchObject({
      remainingSessions: 7,
      student: { id: 'student', name: '学员小林' },
    });
    expect(result.bookings?.[0].completedAt).toEqual(fulfilledAt);
    expect(JSON.parse(JSON.stringify(result)).bookings[0].completedAt).toBe(
      '2026-09-10T03:00:00.000Z',
    );
  });
  it('keeps customer-facing evidence while removing internal parameters and provider secrets', () => {
    const result = orderResponse({
      id: 'order-1',
      orderNo: 'GD202609010001',
      memberId: 'member-1',
      createdById: 'employee-1',
      businessType: 'GOODS',
      status: 'PAID',
      title: '场馆商品',
      payableCents: 1200,
      parameterSnapshot: { internalRate: 2_500 },
      creationIdempotencyKey: 'private-key',
      creationCommandHash: 'private-hash',
      externalOrderNo: 'provider-order',
      items: [
        {
          id: 'line-1',
          itemType: 'INVENTORY_GOODS',
          itemId: 'goods-1',
          name: '羽毛球',
          quantity: 1,
          unitPriceCents: 1200,
          amountCents: 1200,
          metadata: {
            supplierId: 'supplier-secret',
            settlementRule: { commissionRateBps: 2_500 },
          },
        },
      ],
      payments: [
        {
          id: 'payment-1',
          paymentNo: 'PAY-1',
          channel: 'WECHAT',
          amountCents: 1200,
          status: 'SUCCEEDED',
          idempotencyKey: 'payment-key',
          providerTradeNo: 'provider-trade',
          providerPayload: { prepayId: 'secret-prepay-id' },
        },
      ],
      refunds: [
        {
          id: 'refund-1',
          refundNo: 'REF-1',
          amountCents: 200,
          reason: '退一件',
          status: 'COMPLETED',
          idempotencyKey: 'refund-key',
          providerRefundNo: 'provider-refund',
        },
      ],
    });

    expect(result.items?.[0]).toEqual({
      id: 'line-1',
      itemType: 'INVENTORY_GOODS',
      itemId: 'goods-1',
      name: '羽毛球',
      quantity: 1,
      unitPriceCents: 1200,
      amountCents: 1200,
    });
    expect(result.payments?.[0]).toMatchObject({
      id: 'payment-1',
      channel: 'WECHAT',
      status: 'SUCCEEDED',
    });
    expect(result.refunds?.[0]).toMatchObject({
      id: 'refund-1',
      reason: '退一件',
      status: 'COMPLETED',
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      'parameterSnapshot',
      'creationIdempotencyKey',
      'creationCommandHash',
      'metadata',
      'commissionRateBps',
      'providerPayload',
      'providerTradeNo',
      'providerRefundNo',
      'private-key',
      'secret-prepay-id',
      'supplier-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
