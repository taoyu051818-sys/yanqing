import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, BusinessType, OrderStatus } from '../generated/prisma/enums.js';
import { OrdersService } from './orders.service.js';

describe('OrdersService list fulfillment projection', () => {
  it('includes the business schedule needed by the customer order list', async () => {
    const order = {
      id: 'order-1',
      orderNo: 'VN202609020001',
      businessType: BusinessType.VENUE,
      status: OrderStatus.PAID,
      title: '1号场 晚场二',
      payableCents: 8_800,
      createdAt: new Date('2026-09-02T11:40:00.000Z'),
      items: [],
      payments: [],
      refunds: [],
      bookings: [
        {
          id: 'booking-1',
          status: 'CONFIRMED',
          startsAt: new Date('2026-09-02T13:00:00.000Z'),
          endsAt: new Date('2026-09-02T15:00:00.000Z'),
          court: { id: 'court-1', code: 'C01', name: '1号场' },
        },
      ],
      gameRegistration: null,
      eventTeam: null,
      trainingEnrollment: null,
    };
    const prisma = {
      order: {
        findMany: vi.fn().mockResolvedValue([order]),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: vi.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const actor: AuthUser = {
      sub: 'member-1',
      displayName: '会员',
      roles: [AppRole.MEMBER],
    };

    const result = await new OrdersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    ).list(actor, { page: 1, pageSize: 20 } as never);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          bookings: { include: { court: true } },
          gameRegistration: { include: { game: true } },
          eventTeam: { include: { event: true } },
          trainingEnrollment: { include: { product: true, student: true } },
        }),
      }),
    );
    expect(result.items[0].bookings?.[0]).toMatchObject({
      startsAt: new Date('2026-09-02T13:00:00.000Z'),
      endsAt: new Date('2026-09-02T15:00:00.000Z'),
      court: { id: 'court-1', name: '1号场' },
    });
  });
});
