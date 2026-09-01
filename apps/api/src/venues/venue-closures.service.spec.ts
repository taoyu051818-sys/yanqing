import { describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  CourtClosureStatus,
  CourtUsage,
  SourceChannel,
} from '../generated/prisma/enums.js';
import { VenuesService } from './venues.service.js';

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
};
const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
};

const startsAt = '2099-01-01T09:00:00+08:00';
const endsAt = '2099-01-01T11:00:00+08:00';
const createDto = {
  courtId: 'court-1',
  startsAt,
  endsAt,
  reason: '地板维护保养',
  creationIdempotencyKey: 'closure-request-key-1',
};

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

const closure = (overrides: Record<string, unknown> = {}) => ({
  id: 'closure-1',
  courtId: 'court-1',
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  reason: '地板维护保养',
  status: CourtClosureStatus.ACTIVE,
  creationIdempotencyKey: 'closure-request-key-1',
  createdById: admin.sub,
  cancelledById: null,
  cancelledAt: null,
  cancelReason: null,
  court: { id: 'court-1', code: 'C01', name: '1号场' },
  createdBy: { id: admin.sub, displayName: admin.displayName },
  cancelledBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('VenuesService court closure authorization and queries', () => {
  it('enforces read roles in the service even when the controller guard is bypassed', async () => {
    const findMany = vi.fn();
    const service = new VenuesService({ courtClosure: { findMany } } as never);

    await expect(service.listClosures({}, member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('allows front desk read-only access and validates the query range', async () => {
    const findMany = vi.fn().mockResolvedValue([closure()]);
    const service = new VenuesService({ courtClosure: { findMany } } as never);

    await expect(
      service.listClosures({ status: CourtClosureStatus.ACTIVE }, frontDesk),
    ).resolves.toHaveLength(1);
    const [listed] = await service.listClosures({}, frontDesk);
    expect(listed).not.toHaveProperty('creationIdempotencyKey');
    expect(listed).not.toHaveProperty('createdById');
    await expect(
      service.listClosures({ from: endsAt, to: startsAt }, frontDesk),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let front desk create a closure through a direct service call', async () => {
    const transaction = vi.fn();
    const service = new VenuesService({ $transaction: transaction } as never);

    await expect(
      service.createClosure(createDto, frontDesk),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('VenuesService court closure creation', () => {
  it('creates one auditable closure without mutating an existing booking', async () => {
    const created = closure();
    const tx = {
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'court-1', code: 'C01', name: '1号场' }),
      },
      courtClosure: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      courtBooking: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      courtClosure: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    };
    const service = new VenuesService(prisma as never);

    const result = await service.createClosure(createDto, admin);
    expect(result).toMatchObject({ id: created.id, status: created.status });
    expect(result).not.toHaveProperty('creationIdempotencyKey');
    expect(tx.courtClosure.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courtId: 'court-1',
          reason: '地板维护保养',
          creationIdempotencyKey: 'closure-request-key-1',
          createdById: admin.sub,
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.sub,
        actorRole: AppRole.ADMIN,
        action: 'COURT_CLOSURE_CREATED',
        objectType: 'CourtClosure',
        objectId: 'closure-1',
      }),
    });
  });

  it('returns an exact idempotent replay without opening another transaction', async () => {
    const existing = closure();
    const transaction = vi.fn();
    const service = new VenuesService({
      courtClosure: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: transaction,
    } as never);

    const result = await service.createClosure(createDto, admin);
    expect(result).toMatchObject({ id: existing.id, status: existing.status });
    expect(result).not.toHaveProperty('creationIdempotencyKey');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects reuse of a creation key for a different command', async () => {
    const service = new VenuesService({
      courtClosure: { findUnique: vi.fn().mockResolvedValue(closure()) },
    } as never);

    await expect(
      service.createClosure({ ...createDto, reason: '其他维护事项' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports every overlapping future booking and never silently cancels it', async () => {
    const bookings = [
      {
        id: 'booking-1',
        orderId: 'order-1',
        status: 'CONFIRMED',
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      },
      {
        id: 'booking-2',
        orderId: 'order-2',
        status: 'HELD',
        startsAt: new Date('2099-01-01T10:00:00+08:00'),
        endsAt: new Date('2099-01-01T12:00:00+08:00'),
      },
    ];
    const tx = {
      court: { findUnique: vi.fn().mockResolvedValue({ id: 'court-1' }) },
      courtClosure: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      courtBooking: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue(bookings),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new VenuesService({
      courtClosure: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    } as never);

    await expect(service.createClosure(createDto, admin)).rejects.toThrow(
      '已有 2 笔未取消预约',
    );
    expect(tx.courtClosure.create).not.toHaveBeenCalled();
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('VenuesService court closure cancellation', () => {
  it('changes ACTIVE to CANCELLED with actor, reason, timestamp and audit evidence', async () => {
    const before = closure();
    const after = closure({
      status: CourtClosureStatus.CANCELLED,
      cancelledById: admin.sub,
      cancelledAt: new Date(),
      cancelReason: '维修计划取消',
      cancelledBy: { id: admin.sub, displayName: admin.displayName },
    });
    const tx = {
      courtClosure: {
        findUnique: vi.fn().mockResolvedValue(before),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(after),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new VenuesService({ $transaction: runner(tx) } as never);

    const result = await service.cancelClosure('closure-1', { reason: '维修计划取消' }, admin);
    expect(result).toMatchObject({ id: after.id, status: after.status });
    expect(result).not.toHaveProperty('creationIdempotencyKey');
    expect(tx.courtClosure.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'closure-1', status: CourtClosureStatus.ACTIVE },
        data: expect.objectContaining({
          status: CourtClosureStatus.CANCELLED,
          cancelledById: admin.sub,
          cancelReason: '维修计划取消',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('treats a repeated cancellation as a no-op without duplicating audit', async () => {
    const cancelled = closure({ status: CourtClosureStatus.CANCELLED });
    const tx = {
      courtClosure: {
        findUnique: vi.fn().mockResolvedValue(cancelled),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new VenuesService({ $transaction: runner(tx) } as never);

    const result = await service.cancelClosure('closure-1', { reason: '重复请求' }, admin);
    expect(result).toMatchObject({ id: cancelled.id, status: cancelled.status });
    expect(result).not.toHaveProperty('creationIdempotencyKey');
    expect(tx.courtClosure.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('VenuesService closure integration with availability and booking', () => {
  it('returns active closures with the daily availability matrix', async () => {
    const activeClosure = closure();
    const prisma = {
      court: { findMany: vi.fn().mockResolvedValue([]) },
      timeSlot: { findMany: vi.fn().mockResolvedValue([]) },
      courtBooking: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      courtClosure: { findMany: vi.fn().mockResolvedValue([activeClosure]) },
    };
    const service = new VenuesService(prisma as never);

    await expect(service.availability('2099-01-01')).resolves.toMatchObject({
      date: '2099-01-01',
      closures: [
        {
          courtId: activeClosure.courtId,
          startsAt: activeClosure.startsAt,
          endsAt: activeClosure.endsAt,
          status: activeClosure.status,
        },
      ],
    });
    expect(prisma.courtClosure.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: CourtClosureStatus.ACTIVE }),
      }),
    );
  });

  it('checks closures inside the serializable booking transaction before creating an order', async () => {
    const tx = {
      courtClosure: { findFirst: vi.fn().mockResolvedValue(closure()) },
      courtBooking: { findFirst: vi.fn() },
      order: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'slot-1',
            code: 'S01',
            label: '上午一',
            enabled: true,
            startMinutes: 540,
            endMinutes: 660,
          }),
      },
      memberProfile: {
        findUnique: vi.fn().mockResolvedValue({ level: 'GOLD' }),
      },
      priceRule: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: 'price-1',
              weekdayMask: 127,
              priceCents: 6800,
              newcomerPriceCents: null,
            },
          ]),
      },
      $transaction: runner(tx),
    };
    const service = new VenuesService(prisma as never);

    await expect(
      service.createBooking(
        {
          date: '2099-01-01',
          courtId: 'court-1',
          slotId: 'slot-1',
          sourceChannel: SourceChannel.MINI_PROGRAM,
        },
        member,
      ),
    ).rejects.toThrow('该时段已封场');
    expect(tx.courtBooking.findFirst).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
  });
});
