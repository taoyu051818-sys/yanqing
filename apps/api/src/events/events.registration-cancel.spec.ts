import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  EventStatus,
  OrderStatus,
  RefundStatus,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { EventsService } from './events.service.js';

const member: AuthUser = {
  sub: 'member-1',
  displayName: '队长甲',
  roles: [AppRole.MEMBER],
};

const openEvent = {
  id: 'event-1',
  status: EventStatus.FULL,
  startsAt: new Date('2099-09-01T09:00:00.000Z'),
  registrationEndsAt: new Date('2099-08-31T20:00:00.000Z'),
  capacityPeople: 24,
  name: '固定双打积分赛',
};

describe('event registration self-withdrawal', () => {
  it('cancels a waitlist row without money and replays the same command', async () => {
    const queued: any = {
      id: 'team-wait',
      eventId: openEvent.id,
      captainId: member.sub,
      status: RegistrationStatus.WAITLISTED,
      orderId: null,
      order: null,
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      waitlistedAt: new Date('2099-01-01T00:00:00.000Z'),
      cancelIdempotencyKey: null,
    };
    let replay: any = null;
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue(openEvent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eventTeam: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(queued)
          .mockResolvedValueOnce(null),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      order: { upsert: vi.fn(), updateMany: vi.fn() },
      payment: { updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      eventTeam: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.cancelIdempotencyKey === replay?.cancelIdempotencyKey
            ? replay
            : null,
        ),
      },
      $transaction: vi.fn(async (work: any) => work(tx)),
    };
    const service = new EventsService(prisma as never);
    const dto = {
      reason: '候补计划变化',
      idempotencyKey: 'event-team-cancel-wait-1',
    };

    const first: any = await service.cancelRegistration(
      openEvent.id,
      dto,
      member,
    );
    replay = first.registration;
    const second: any = await service.cancelRegistration(
      openEvent.id,
      dto,
      member,
    );

    expect(first).toMatchObject({
      outcome: 'CANCELLED',
      refund: null,
      registration: {
        status: RegistrationStatus.CANCELLED,
        cancellationPending: false,
      },
    });
    expect(second).toMatchObject({ idempotent: true, outcome: 'CANCELLED' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a paid seat blocked while a full refund awaits finance', async () => {
    const paidTeam: any = {
      id: 'team-paid',
      eventId: openEvent.id,
      captainId: member.sub,
      status: RegistrationStatus.PAID,
      orderId: 'order-paid',
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      cancelIdempotencyKey: null,
      cancellationPending: false,
      order: {
        id: 'order-paid',
        status: OrderStatus.PAID,
        paidCents: 8_800,
        refundedCents: 0,
        refunds: [],
      },
    };
    const refund = {
      id: 'refund-paid',
      idempotencyKey: 'EVENT_TEAM_CANCEL:team-paid:event-team-cancel-paid-1',
      orderId: 'order-paid',
      requestedById: member.sub,
      amountCents: 8_800,
      status: RefundStatus.REQUESTED,
    };
    const tx = {
      event: { findUnique: vi.fn().mockResolvedValue(openEvent) },
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue(paidTeam),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refund: { create: vi.fn().mockResolvedValue(refund) },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      eventTeam: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: any) => work(tx)),
    };
    const service = new EventsService(prisma as never);

    const result: any = await service.cancelRegistration(
      openEvent.id,
      {
        reason: '队员受伤无法参赛',
        idempotencyKey: 'event-team-cancel-paid-1',
      },
      member,
    );

    expect(result).toMatchObject({
      outcome: 'REFUND_REQUESTED',
      registration: {
        status: RegistrationStatus.PAID,
        cancellationPending: true,
      },
      refund: { status: RefundStatus.REQUESTED, amountCents: 8_800 },
    });
    expect(tx.eventTeam.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: paidTeam.id,
        status: RegistrationStatus.PAID,
        cancellationPending: false,
      }),
      data: expect.objectContaining({ cancellationPending: true }),
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-paid', status: OrderStatus.PAID },
      data: { status: OrderStatus.REFUND_PENDING },
    });
  });

  it('refuses check-in while the paid cancellation refund is pending', async () => {
    const service = new EventsService({
      $transaction: vi.fn(async (work: any) =>
        work({
          eventTeam: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'team-paid',
              eventId: openEvent.id,
              status: RegistrationStatus.PAID,
              cancellationPending: true,
              playerAName: '甲',
              playerBName: '乙',
            }),
            update: vi.fn(),
          },
        }),
      ),
    } as never);

    await expect(
      service.checkIn(openEvent.id, 'team-paid', {
        sub: 'manager-1',
        displayName: '赛事管理员',
        roles: [AppRole.EVENT_MANAGER],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
