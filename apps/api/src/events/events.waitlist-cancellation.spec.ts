import { describe, expect, it, vi } from 'vitest';

import { ConflictException } from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  EventStatus,
  OrderStatus,
  RegistrationStatus,
  SourceChannel,
  TeamCategory,
  UserStatus,
} from '../generated/prisma/client.js';
import type { RegisterEventTeamDto } from './events.dto.js';
import { EVENT_MINIMUM_PEOPLE, EVENT_TOTAL_ROUNDS } from './events.dto.js';
import { EventsService, promoteNextEventWaitlist } from './events.service.js';

const member: AuthUser = {
  sub: 'member-queue',
  displayName: '候补会员',
  roles: [AppRole.MEMBER],
};
const manager: AuthUser = {
  sub: 'event-manager',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
};

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  code: 'EVENT-1',
  name: '延庆固定双打赛',
  status: EventStatus.FULL,
  startsAt: new Date('2099-08-30T10:00:00.000Z'),
  registrationEndsAt: new Date('2099-08-30T09:00:00.000Z'),
  capacityPeople: 24,
  minimumPeople: EVENT_MINIMUM_PEOPLE,
  totalRounds: EVENT_TOTAL_ROUNDS,
  currentRound: 0,
  feeCents: 8_800,
  memberFeeCents: null,
  rules: [],
  ...overrides,
});

const registrationDto = (
  overrides: Partial<RegisterEventTeamDto> = {},
): RegisterEventTeamDto => ({
  name: '候补一队',
  partnerInviteCode: 'EP_waitlist_partner_authorization_123',
  category: TeamCategory.MIXED_DOUBLES,
  sourceChannel: SourceChannel.MINI_PROGRAM,
  creationIdempotencyKey: 'event-waitlist-command-1',
  ...overrides,
});

describe('event persistent FIFO registration', () => {
  it('creates no order at capacity and replays the same waitlist command exactly', async () => {
    let storedTeam: any = null;
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue(event()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      eventPartnerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'partner-invite-1',
          eventId: 'event-1',
          partnerId: 'member-b',
          expiresAt: new Date('2099-08-30T08:30:00.000Z'),
          revokedAt: null,
          consumedAt: null,
          partner: {
            id: 'member-b',
            displayName: '搭档乙',
            status: UserStatus.ACTIVE,
            deletedAt: null,
            memberProfile: { id: 'profile-b' },
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eventTeam: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi
          .fn()
          .mockResolvedValueOnce(12)
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(12),
        create: vi.fn(async ({ data }: any) => {
          storedTeam = {
            id: 'team-wait-1',
            createdAt: new Date('2099-01-01T00:00:00.000Z'),
            orderId: null,
            ...data,
          };
          return storedTeam;
        }),
      },
      order: { create: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      event: { findUnique: vi.fn().mockResolvedValue(event()) },
      memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      eventTeam: {
        findUnique: vi.fn(async () => storedTeam),
        count: vi.fn().mockResolvedValue(0),
      },
      order: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
      $transaction: vi.fn(async (work: any) => work(tx)),
    };
    const service = new EventsService(prisma as never);
    const dto = registrationDto();

    const created: any = await service.register('event-1', dto, member);

    expect(created).toMatchObject({
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 1,
      registration: {
        name: dto.name,
        category: dto.category,
        status: RegistrationStatus.WAITLISTED,
      },
    });
    expect(created.registration).not.toHaveProperty('id');
    expect(created.registration).not.toHaveProperty('orderId');
    expect(created.registration).not.toHaveProperty('captainId');
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'EVENT_WAITLISTED' }),
    });

    const replay: any = await service.register('event-1', dto, member);
    expect(replay).toEqual(created);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    await expect(
      service.register(
        'event-1',
        registrationDto({
          partnerInviteCode: 'EP_different_partner_authorization_456',
        }),
        member,
      ),
    ).rejects.toThrow('赛事报名幂等键已用于不同命令');
  });

  it('promotes the oldest queue row once with a deterministic order and payment deadline', async () => {
    const queued = {
      id: 'team-oldest',
      eventId: 'event-1',
      captainId: member.sub,
      name: '最早候补',
      playerAName: '甲',
      playerBName: '乙',
      playerAUserId: member.sub,
      playerBUserId: 'member-b',
      category: TeamCategory.MIXED_DOUBLES,
      sourceChannel: SourceChannel.MINI_PROGRAM,
      listAmountCents: 8_800,
      payableCents: 8_800,
      memberFeeApplied: false,
      status: RegistrationStatus.WAITLISTED,
      orderId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    let seated = 11;
    let next: any = queued;
    const orderUpsert = vi.fn(async ({ create }: any) => ({
      id: 'order-promoted',
      ...create,
    }));
    const registrationClaim = vi.fn(async () => {
      next = null;
      return { count: 1 };
    });
    const tx = {
      event: {
        findUnique: vi
          .fn()
          .mockResolvedValue(event({ status: EventStatus.FULL })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      eventTeam: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn(async () => seated),
        findFirst: vi.fn(async () => next),
        updateMany: registrationClaim,
      },
      order: { upsert: orderUpsert, updateMany: vi.fn() },
      payment: { updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const first = await promoteNextEventWaitlist(
      tx as never,
      'event-1',
      manager.sub,
      AppRole.EVENT_MANAGER,
      new Date('2026-08-30T06:00:00.000Z'),
    );
    seated = 12;
    const second = await promoteNextEventWaitlist(
      tx as never,
      'event-1',
      manager.sub,
      AppRole.EVENT_MANAGER,
      new Date('2026-08-30T06:01:00.000Z'),
    );

    expect(first.promotions).toHaveLength(1);
    expect(second.promotions).toHaveLength(0);
    expect(orderUpsert).toHaveBeenCalledTimes(1);
    expect(orderUpsert.mock.calls[0][0].create).toMatchObject({
      creationIdempotencyKey: 'SYSTEM:EVENT_WAITLIST:team-oldest',
      status: OrderStatus.PENDING,
      memberId: member.sub,
      parameterSnapshot: expect.objectContaining({
        promotedFromWaitlist: true,
      }),
    });
    expect(registrationClaim.mock.calls[0][0].data).toMatchObject({
      status: RegistrationStatus.REGISTERED,
      orderId: 'order-promoted',
    });
    expect(tx.eventTeam.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });
});

describe('event cancellation workflow', () => {
  it('cancels pending/waitlist rows and creates finance-reviewed refunds for paid orders', async () => {
    const current: any = event({ status: EventStatus.OPEN });
    let cancelled: any = null;
    const paidOrder = {
      id: 'order-paid',
      status: OrderStatus.PAID,
      paidCents: 8_800,
      refundedCents: 0,
      refunds: [],
    };
    const pendingOrder = {
      id: 'order-pending',
      status: OrderStatus.PENDING,
      paidCents: 0,
      refundedCents: 0,
      refunds: [],
    };
    const teams = [
      { id: 'team-paid', status: RegistrationStatus.PAID, order: paidOrder },
      {
        id: 'team-pending',
        status: RegistrationStatus.REGISTERED,
        order: pendingOrder,
      },
      { id: 'team-wait', status: RegistrationStatus.WAITLISTED, order: null },
    ];
    const refundCreate = vi.fn(async ({ data }: any) => ({
      id: 'refund-1',
      ...data,
    }));
    const eventFind = vi.fn(async ({ where }: any) =>
      where.cancelIdempotencyKey ? cancelled : current,
    );
    const tx = {
      event: {
        findUnique: eventFind,
        updateMany: vi.fn(async ({ data }: any) => {
          cancelled = { ...current, id: current.id, ...data };
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async () => cancelled),
      },
      eventTeam: {
        findMany: vi.fn().mockResolvedValue(teams),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: refundCreate,
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      event: { findUnique: eventFind },
      $transaction: vi.fn(async (work: any) => work(tx)),
    };
    const service = new EventsService(prisma as never);

    const result: any = await service.cancel(
      'event-1',
      { reason: '场馆临时停电', idempotencyKey: 'event-cancel-command-1' },
      manager,
    );

    expect(result).toMatchObject({
      cancelledPendingOrders: 1,
      cancelledWaitlist: 1,
      refundRequestCount: 1,
      refundRequestedCents: 8_800,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /cancelIdempotencyKey|cancelCommandHash|cancelPolicySnapshot|requestedById|orderId/,
    );
    expect(refundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-paid',
        requestedById: manager.sub,
        status: 'REQUESTED',
      }),
    });
    expect(cancelled).toMatchObject({
      status: EventStatus.CANCELLED,
      cancelPolicySnapshot: expect.objectContaining({
        approvalRequired: true,
        refundRequestedCents: 8_800,
      }),
    });

    const replay: any = await service.cancel(
      'event-1',
      { reason: '场馆临时停电', idempotencyKey: 'event-cancel-command-1' },
      manager,
    );
    expect(replay.idempotent).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects cancellation after the event is in progress', async () => {
    const current = event({ status: EventStatus.IN_PROGRESS });
    const tx = { event: { findUnique: vi.fn().mockResolvedValue(current) } };
    const service = new EventsService({
      event: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (work: any) => work(tx)),
    } as never);

    await expect(
      service.cancel(
        'event-1',
        { reason: '无效取消', idempotencyKey: 'event-cancel-command-2' },
        manager,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
