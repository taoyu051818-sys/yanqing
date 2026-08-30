import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, FrontDeskShiftStatus } from '../generated/prisma/enums.js';
import { FrontDeskShiftsService } from './frontdesk-shifts.service.js';

const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台甲',
  roles: [AppRole.FRONT_DESK],
};
const otherFrontDesk: AuthUser = {
  sub: 'front-desk-2',
  displayName: '前台乙',
  roles: [AppRole.FRONT_DESK],
};
const administrator: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
};
const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
};

const day = new Date('2026-08-29T16:00:00.000Z');
const openShift = {
  id: 'shift-1',
  businessDate: day,
  venueCode: 'MAIN',
  operatorId: frontDesk.sub,
  openedById: frontDesk.sub,
  closedById: null,
  status: FrontDeskShiftStatus.OPEN,
  openedAt: new Date('2026-08-30T00:30:00.000Z'),
  openingCashCents: 10_000,
};

const transactionRunner = (tx: Record<string, any>) =>
  vi.fn(async (work: (client: Record<string, any>) => unknown) => work(tx));

describe('FrontDeskShiftsService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('rejects a non-operations role before touching persistence', async () => {
    const prisma = { $transaction: vi.fn() };
    const service = new FrontDeskShiftsService(prisma as never);

    await expect(
      service.open({ openingCashCents: 0 }, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('opens once with an audit record and replays only the same opening cash', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T02:00:00.000Z'));
    const created = {
      ...openShift,
      operator: {},
      openedBy: {},
      closedBy: null,
    };
    const tx = {
      frontDeskShift: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(created),
        create: vi.fn().mockResolvedValue(created),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: transactionRunner(tx) };
    const service = new FrontDeskShiftsService(prisma as never);

    await expect(
      service.open({ openingCashCents: 10_000 }, frontDesk),
    ).resolves.toEqual(created);
    expect(tx.frontDeskShift.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessDate: new Date('2026-08-29T16:00:00.000Z'),
        operatorId: frontDesk.sub,
        openedById: frontDesk.sub,
        venueCode: 'MAIN',
        openingCashCents: 10_000,
      }),
      include: expect.any(Object),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_OPENED',
        actorId: frontDesk.sub,
        objectId: openShift.id,
      }),
    });
    await expect(
      service.open({ openingCashCents: 10_000 }, frontDesk),
    ).resolves.toEqual(created);
    expect(tx.frontDeskShift.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    tx.frontDeskShift.findFirst.mockResolvedValueOnce(created);
    await expect(
      service.open({ openingCashCents: 9_000 }, frontDesk),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires independent finance/admin review and a reason for non-zero variance', async () => {
    const closed = {
      ...openShift,
      status: FrontDeskShiftStatus.CLOSED,
      closedById: frontDesk.sub,
      closingCashCents: 9_500,
      expectedCashCents: 10_000,
      cashVarianceCents: -500,
      varianceReviewedById: null,
      varianceReviewedAt: null,
      varianceReviewReason: null,
    };
    const tx = {
      frontDeskShift: {
        findUnique: vi.fn().mockResolvedValue(closed),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new FrontDeskShiftsService({
      $transaction: transactionRunner(tx),
    } as never);

    await expect(service.reviewVariance(closed.id, {}, frontDesk))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reviewVariance(closed.id, {}, finance))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.reviewVariance(
      closed.id,
      { reason: '本人关班后自审' },
      { ...frontDesk, roles: [AppRole.FRONT_DESK, AppRole.FINANCE] },
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.frontDeskShift.updateMany).not.toHaveBeenCalled();
  });

  it('reviews a variance once, writes audit evidence, and safely replays', async () => {
    const closed = {
      ...openShift,
      status: FrontDeskShiftStatus.CLOSED,
      closedById: frontDesk.sub,
      closingCashCents: 9_500,
      expectedCashCents: 10_000,
      cashVarianceCents: -500,
      varianceReviewedById: null,
      varianceReviewedAt: null,
      varianceReviewReason: null,
    };
    const reviewed = {
      ...closed,
      varianceReviewedById: finance.sub,
      varianceReviewedAt: new Date('2026-08-30T04:00:00.000Z'),
      varianceReviewReason: '短款500分，监控与收据已核对',
    };
    const tx = {
      frontDeskShift: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(closed)
          .mockResolvedValueOnce(reviewed),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(reviewed),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new FrontDeskShiftsService({
      $transaction: transactionRunner(tx),
    } as never);
    const command = { reason: '短款500分，监控与收据已核对' };

    await expect(service.reviewVariance(closed.id, command, finance))
      .resolves.toEqual(reviewed);
    expect(tx.frontDeskShift.updateMany).toHaveBeenCalledWith({
      where: {
        id: closed.id,
        status: FrontDeskShiftStatus.CLOSED,
        varianceReviewedById: null,
      },
      data: expect.objectContaining({
        varianceReviewedById: finance.sub,
        varianceReviewReason: command.reason,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_VARIANCE_REVIEWED',
        actorId: finance.sub,
        objectId: closed.id,
      }),
    });

    await expect(service.reviewVariance(closed.id, command, finance))
      .resolves.toEqual(reviewed);
    expect(tx.frontDeskShift.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('scopes front-desk history to self while finance and administrators may select an operator', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new FrontDeskShiftsService({
      frontDeskShift: { findMany },
    } as never);

    await service.history(
      { limit: 20, operatorId: otherFrontDesk.sub },
      frontDesk,
    );
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ operatorId: frontDesk.sub }),
      }),
    );
    await service.history(
      { limit: 20, operatorId: otherFrontDesk.sub },
      administrator,
    );
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ operatorId: otherFrontDesk.sub }),
      }),
    );
    await service.history(
      { limit: 20, operatorId: otherFrontDesk.sub },
      finance,
    );
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ operatorId: otherFrontDesk.sub }),
      }),
    );
  });

  it('blocks another front desk and requires an administrator proxy-close reason', async () => {
    const tx = {
      frontDeskShift: { findUnique: vi.fn().mockResolvedValue(openShift) },
    };
    const service = new FrontDeskShiftsService({
      $transaction: transactionRunner(tx),
    } as never);
    const command = {
      closingCashCents: 10_000,
      handoverNote: '现金与现场事项已核对',
    };

    await expect(
      service.close(openShift.id, command, otherFrontDesk),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.close(openShift.id, command, administrator),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('atomically snapshots cash and pending work when an administrator closes for the operator', async () => {
    const closed = {
      ...openShift,
      status: FrontDeskShiftStatus.CLOSED,
      closedById: administrator.sub,
      closingCashCents: 13_500,
      expectedCashCents: 14_000,
      cashVarianceCents: -500,
    };
    const tx = {
      frontDeskShift: {
        findUnique: vi.fn().mockResolvedValue(openShift),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(closed),
      },
      payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 5_000 } }),
        count: vi.fn().mockResolvedValue(2),
      },
      refund: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 1_000 } }),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'refund-1',
            refundNo: 'RF001',
            orderId: 'order-1',
            amountCents: 1_000,
            status: 'REQUESTED',
            reason: '会员申请',
            requestedAt: new Date('2026-08-30T02:00:00.000Z'),
          },
        ]),
      },
      order: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'order-1',
            orderNo: 'YQ001',
            businessType: 'VENUE',
            status: 'PAID',
            title: '现场订场',
            payableCents: 5_000,
            paidCents: 5_000,
            refundedCents: 0,
            createdAt: new Date('2026-08-30T01:00:00.000Z'),
          },
        ]),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new FrontDeskShiftsService({
      $transaction: transactionRunner(tx),
    } as never);

    await expect(
      service.close(
        openShift.id,
        {
          closingCashCents: 13_500,
          handoverNote: '现金已点清，退款转交财务',
          reason: '前台突发离岗，管理员代关',
        },
        administrator,
      ),
    ).resolves.toEqual(closed);
    expect(tx.frontDeskShift.updateMany).toHaveBeenCalledWith({
      where: { id: openShift.id, status: FrontDeskShiftStatus.OPEN },
      data: expect.objectContaining({
        status: FrontDeskShiftStatus.CLOSED,
        closingCashCents: 13_500,
        expectedCashCents: 14_000,
        cashVarianceCents: -500,
        closedById: administrator.sub,
        pendingSnapshot: expect.objectContaining({
          pendingOrders: expect.objectContaining({ count: 1 }),
          pendingRefunds: expect.objectContaining({ count: 1 }),
          pendingPayments: { count: 2 },
        }),
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_CLOSED',
        actorId: administrator.sub,
        reason: '前台突发离岗，管理员代关',
      }),
    });
    expect(tx.payment.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        operatorId: frontDesk.sub,
        channel: 'OFFLINE_CASH',
      }),
      _sum: { amountCents: true },
    });
    expect(tx.refund.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        order: expect.objectContaining({
          payments: {
            some: expect.objectContaining({ operatorId: frontDesk.sub }),
          },
        }),
      }),
      _sum: { amountCents: true },
    });
    expect(tx.payment.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ operatorId: frontDesk.sub }),
    });
  });

  it('replays an already closed shift without producing another snapshot or audit event', async () => {
    const closed = {
      ...openShift,
      status: FrontDeskShiftStatus.CLOSED,
      closedById: frontDesk.sub,
      closingCashCents: 13_500,
      handoverNote: '重复提交仍然安全',
      closeReason: null,
    };
    const tx = {
      frontDeskShift: { findUnique: vi.fn().mockResolvedValue(closed) },
      payment: { aggregate: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new FrontDeskShiftsService({
      $transaction: transactionRunner(tx),
    } as never);

    await expect(
      service.close(
        closed.id,
        { closingCashCents: 13_500, handoverNote: '重复提交仍然安全' },
        frontDesk,
      ),
    ).resolves.toEqual(closed);
    expect(tx.payment.aggregate).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    await expect(
      service.close(
        closed.id,
        { closingCashCents: 13_501, handoverNote: '重复提交仍然安全' },
        frontDesk,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
