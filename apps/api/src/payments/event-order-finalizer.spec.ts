import { describe, expect, it, vi } from 'vitest';

import {
  AppRole,
  BusinessType,
  EventStatus,
  OrderStatus,
  PaymentChannel,
  RegistrationStatus,
  SourceChannel,
  SubjectAccount,
} from '../generated/prisma/client.js';
import {
  OrderFinalizerService,
  type PayableOrder,
} from './order-finalizer.service.js';

const consignmentHooks = () => ({
  recordCompletedGoodsSale: vi.fn().mockResolvedValue([]),
  recordSucceededGoodsRefund: vi.fn().mockResolvedValue([]),
});

const eventOrder = (): PayableOrder => ({
  id: 'order-event',
  orderNo: 'EV001',
  creationIdempotencyKey: null,
  creationCommandHash: null,
  memberId: 'member-1',
  createdById: 'member-1',
  businessType: BusinessType.EVENT,
  subjectAccount: SubjectAccount.VENUE,
  paymentChannel: null,
  sourceChannel: SourceChannel.MINI_PROGRAM,
  status: OrderStatus.PENDING,
  title: '赛事报名',
  listAmountCents: 8_800,
  discountCents: 0,
  payableCents: 8_800,
  paidCents: 0,
  refundedCents: 0,
  externalOrderNo: null,
  consumedCouponCode: null,
  parameterSnapshot: {},
  paidAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  membership: null,
  member: { openId: 'openid-1' },
});

const eventTeam = (dueAt: Date) => ({
  id: 'team-1',
  status: RegistrationStatus.REGISTERED,
  paymentDueAt: dueAt,
  event: {
    status: EventStatus.FULL,
    startsAt: new Date('2099-08-30T10:00:00.000Z'),
  },
});

describe('event payment finalization reservation boundary', () => {
  it('rejects an expired reservation before moving the order to PAID', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          status: OrderStatus.PENDING,
          paidCents: 0,
          paymentChannel: null,
        }),
        updateMany: vi.fn(),
      },
      eventTeam: {
        findUnique: vi
          .fn()
          .mockResolvedValue(eventTeam(new Date('2026-01-01T00:00:00Z'))),
      },
    };

    await expect(
      new OrderFinalizerService(consignmentHooks() as never).finalize(
        tx as never,
        eventOrder(),
        {
          id: 'payment-1',
          paymentNo: 'PAY1',
          channel: PaymentChannel.WECHAT,
          amountCents: 8_800,
        },
        'member-1',
        AppRole.MEMBER,
        new Date('2026-08-30T00:00:00Z'),
      ),
    ).rejects.toThrow('支付保留期已过期');
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('uses CAS to move both the order and the reserved team to paid', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          status: OrderStatus.PENDING,
          paidCents: 0,
          paymentChannel: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eventTeam: {
        findUnique: vi
          .fn()
          .mockResolvedValue(eventTeam(new Date('2099-08-30T09:00:00Z'))),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      trainingEnrollment: { findUnique: vi.fn().mockResolvedValue(null) },
      gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const now = new Date('2026-08-30T00:00:00Z');

    await new OrderFinalizerService(consignmentHooks() as never).finalize(
      tx as never,
      eventOrder(),
      {
        id: 'payment-1',
        paymentNo: 'PAY1',
        channel: PaymentChannel.WECHAT,
        amountCents: 8_800,
      },
      'member-1',
      AppRole.MEMBER,
      now,
    );

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-event', status: OrderStatus.PENDING },
      data: expect.objectContaining({ status: OrderStatus.PAID }),
    });
    expect(tx.eventTeam.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'order-event',
        status: RegistrationStatus.REGISTERED,
        paymentDueAt: { gt: now },
      },
      data: { status: RegistrationStatus.PAID, paymentDueAt: null },
    });
  });
});
