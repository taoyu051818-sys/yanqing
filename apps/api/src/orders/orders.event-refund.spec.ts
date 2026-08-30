import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  BusinessType,
  EventStatus,
  OrderStatus,
  PaymentChannel,
  RefundStatus,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { OrdersService } from './orders.service.js';

const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务复核员',
  roles: [AppRole.FINANCE],
};

const refundFixture = (amountCents: number) => ({
  id: `refund-${amountCents}`,
  refundNo: `RF${amountCents}`,
  orderId: 'order-event',
  requestedById: 'member-1',
  approvedById: null,
  amountCents,
  reason: '会员申请退款',
  status: RefundStatus.REQUESTED,
  order: {
    id: 'order-event',
    orderNo: 'EV001',
    memberId: 'member-1',
    businessType: BusinessType.EVENT,
    status: OrderStatus.PAID,
    paidCents: 8_800,
    refundedCents: 0,
    payments: [
      {
        id: 'payment-1',
        channel: PaymentChannel.WECHAT,
        amountCents: 8_800,
      },
    ],
    trainingEnrollment: null,
    membership: null,
    items: [],
    gameRegistration: null,
    eventTeam: { id: 'team-event', eventId: 'event-1' },
  },
});

const harness = (amountCents: number) => {
  const fixture = refundFixture(amountCents);
  const tx = {
    refund: {
      findUnique: vi.fn().mockResolvedValue(fixture),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        ...fixture,
        status: RefundStatus.SUCCEEDED,
      }),
    },
    order: { update: vi.fn().mockResolvedValue({}) },
    courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    eventTeam: { update: vi.fn().mockResolvedValue({}) },
    event: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'event-1',
        status: EventStatus.CANCELLED,
      }),
    },
    referralReward: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: any) => work(tx)),
  };
  const service = new OrdersService(
    prisma as never,
    { get: vi.fn().mockReturnValue('mock') } as never,
    {} as never,
    {} as never,
  );
  return { service, tx };
};

describe('whole event order refund releases its team seat', () => {
  it('marks the team refunded only after the whole paid amount succeeds', async () => {
    const { service, tx } = harness(8_800);

    await service.approveRefund(
      'refund-8800',
      { reason: '财务同意原路退款' },
      finance,
    );

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-event' },
      data: {
        refundedCents: 8_800,
        status: OrderStatus.REFUNDED,
      },
    });
    expect(tx.eventTeam.update).toHaveBeenCalledWith({
      where: { id: 'team-event' },
      data: expect.objectContaining({
        status: RegistrationStatus.REFUNDED,
        paymentDueAt: null,
        cancellationPending: false,
      }),
    });
    expect(tx.event.findUnique).toHaveBeenCalled();
  });

  it('keeps the seat on a partial refund', async () => {
    const { service, tx } = harness(4_400);

    await service.approveRefund(
      'refund-4400',
      { reason: '批准部分退款' },
      finance,
    );

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'order-event' },
      data: {
        refundedCents: 4_400,
        status: OrderStatus.PARTIALLY_REFUNDED,
      },
    });
    expect(tx.eventTeam.update).not.toHaveBeenCalled();
    expect(tx.event.findUnique).not.toHaveBeenCalled();
  });

  it('restores a paid team when finance rejects its self-withdrawal refund', async () => {
    const eventTeam = {
      id: 'team-event',
      status: RegistrationStatus.PAID,
      cancellationPending: true,
      cancelIdempotencyKey: 'event-team-cancel-paid-1',
    };
    const refund = {
      id: 'refund-reject',
      orderId: 'order-event',
      requestedById: 'member-1',
      idempotencyKey: 'EVENT_TEAM_CANCEL:team-event:event-team-cancel-paid-1',
      status: RefundStatus.REQUESTED,
      originalOrderStatus: OrderStatus.PAID,
      order: {
        id: 'order-event',
        status: OrderStatus.REFUND_PENDING,
        refundedCents: 0,
        completedAt: null,
        eventTeam,
      },
    };
    const tx = {
      refund: {
        findUnique: vi.fn().mockResolvedValue(refund),
        update: vi
          .fn()
          .mockResolvedValue({ ...refund, status: RefundStatus.REJECTED }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: null } }),
      },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      eventTeam: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new OrdersService(
      { $transaction: vi.fn(async (work: any) => work(tx)) } as never,
      { get: vi.fn().mockReturnValue('mock') } as never,
      {} as never,
      {} as never,
    );

    await service.rejectRefund(
      refund.id,
      { reason: '材料不足，驳回退款' },
      finance,
    );

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: refund.orderId, status: OrderStatus.REFUND_PENDING },
      data: { status: OrderStatus.PAID },
    });
    expect(tx.eventTeam.updateMany).toHaveBeenCalledWith({
      where: {
        id: eventTeam.id,
        status: RegistrationStatus.PAID,
        cancellationPending: true,
      },
      data: {
        cancellationPending: false,
        cancellationResolvedAt: expect.any(Date),
      },
    });
  });
});
