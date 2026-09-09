import { describe, expect, it, vi } from 'vitest';
import { EventParticipationService } from './event-participation.service.js';

describe('registration payment evidence', () => {
  it('keeps a partial order projection whitelisted even if loaded rows contain internal fields', async () => {
    const requestedAt = new Date('2026-09-10T00:00:00Z');
    const service = new EventParticipationService({
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'team',
          captainId: 'member',
          status: 'PAID',
          order: {
            id: 'order',
            orderNo: 'ORDER-1',
            status: 'REFUND_PENDING',
            payableCents: 9900,
            paidCents: 9900,
            parameterSnapshot: { privateRate: 1000 },
            createdById: 'internal-operator',
            refunds: [
              {
                id: 'refund',
                amountCents: 9900,
                reason: '申请退出',
                status: 'REQUESTED',
                requestedAt,
                completedAt: null,
                providerPayload: { secret: true },
              },
            ],
          },
        }),
      },
    } as never);
    const result = await service.myRegistration('event', {
      sub: 'member',
      displayName: '球友',
      roles: ['MEMBER'],
    });
    expect(result?.registration.order).toEqual({
      id: 'order',
      orderNo: 'ORDER-1',
      status: 'REFUND_PENDING',
      payableCents: 9900,
      paidCents: 9900,
      refunds: [
        {
          id: 'refund',
          amountCents: 9900,
          reason: '申请退出',
          status: 'REQUESTED',
          requestedAt,
          completedAt: null,
        },
      ],
    });
  });
});
