import { describe, expect, it, vi } from 'vitest';

import {
  AppRole,
  AttendanceStatus,
  RefundStatus,
  SettlementStatus,
  TrainingConsumeCorrectionStatus,
} from '../generated/prisma/enums.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { WorkItemsService } from './work-items.service.js';

const actor: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
};

describe('WorkItemsService', () => {
  it('normalizes pending money and settlement work into one priority queue', async () => {
    const prisma = {
      refund: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'refund-1',
            status: RefundStatus.REQUESTED,
            amountCents: 6800,
            requestedAt: new Date('2026-08-29T01:00:00Z'),
            order: { orderNo: 'O-1', title: '订场', memberId: 'member-1' },
          },
        ]),
      },
      trainingAttendance: { findMany: vi.fn().mockResolvedValue([]) },
      eventMatch: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'settlement-1',
            status: SettlementStatus.DRAFT,
            merchantId: 'merchant-1',
            merchant: { name: '山脚咖啡' },
            periodStart: new Date('2026-08-01T00:00:00Z'),
            periodEnd: new Date('2026-08-31T00:00:00Z'),
            cooperationFeeCents: 12000,
            effectiveNewCustomers: 3,
            createdAt: new Date('2026-08-29T02:00:00Z'),
          },
        ]),
      },
      trainingSettlement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      accountAdjustmentRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'adjustment-1',
            status: 'REQUESTED',
            amount: -1200,
            reason: '撤销重复充值赠送',
            requestedById: 'finance-2',
            requestedBy: { displayName: '另一名财务' },
            account: { type: 'GIFT_BALANCE', user: { displayName: '小林' } },
            createdAt: new Date('2026-08-29T00:30:00Z'),
          },
        ]),
      },
      trainingConsumeCorrection: { findMany: vi.fn() },
    };

    const result = await new WorkItemsService(prisma as never).list(actor, 20);

    expect(result.map((item) => item.kind)).toEqual([
      'REFUND_REVIEW',
      'ACCOUNT_ADJUSTMENT_REVIEW',
      'ALLIANCE_SETTLEMENT',
    ]);
    expect(result[0]).toMatchObject({
      objectId: 'refund-1',
      priority: 100,
      amountCents: 6800,
    });
    expect(result[1]).toMatchObject({
      objectId: 'adjustment-1',
      priority: 98,
      amountCents: -1200,
    });
    expect(result[2]).toMatchObject({ objectId: 'settlement-1', priority: 70 });
    expect(prisma.accountAdjustmentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requestedById: { not: actor.sub } }),
      }),
    );
    expect(prisma.trainingAttendance.findMany).not.toHaveBeenCalled();
    expect(prisma.trainingConsumeCorrection.findMany).not.toHaveBeenCalled();
  });

  it('returns no internal work for a member even when source records exist', async () => {
    const prisma = {
      refund: { findMany: vi.fn() },
      trainingAttendance: { findMany: vi.fn() },
      eventMatch: { findMany: vi.fn() },
      allianceSettlement: { findMany: vi.fn() },
      trainingSettlement: { findMany: vi.fn() },
      inventoryItem: { findMany: vi.fn() },
      order: { findMany: vi.fn() },
    };
    const result = await new WorkItemsService(prisma as never).list(
      { ...actor, roles: [AppRole.MEMBER] },
      20,
    );
    expect(result).toEqual([]);
    expect(prisma.refund.findMany).not.toHaveBeenCalled();
  });

  it('keeps operational queues scoped to their responsible role', async () => {
    const prisma = {
      refund: { findMany: vi.fn().mockResolvedValue([]) },
      trainingAttendance: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'attendance-1',
            status: AttendanceStatus.ATTENDED,
            operatorId: 'coach-1',
            consumedAt: null,
            consumedSessions: 0,
            createdAt: new Date('2026-08-29T03:00:00Z'),
            sessionId: 'session-1',
            enrollmentId: 'enrollment-1',
            session: {
              startsAt: new Date('2026-08-29T02:00:00Z'),
              endsAt: new Date('2026-08-29T03:00:00Z'),
              class: { name: '成人基础班' },
            },
            enrollment: { student: { displayName: '小林' } },
          },
        ]),
      },
      eventMatch: { findMany: vi.fn().mockResolvedValue([]) },
      eventPrizeAward: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findMany: vi.fn().mockResolvedValue([]) },
      trainingSettlement: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      customerLead: { findMany: vi.fn().mockResolvedValue([]) },
      hostProfile: { findMany: vi.fn().mockResolvedValue([]) },
      accountAdjustmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
      trainingConsumeCorrection: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const result = await new WorkItemsService(prisma as never).list(
      { ...actor, roles: [AppRole.ADMIN] },
      20,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'TRAINING_ATTENDANCE',
      objectId: 'attendance-1',
      ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
    });
    expect(prisma.trainingAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AttendanceStatus.ATTENDED,
          operatorId: { not: null },
          consumedAt: null,
          consumedSessions: 0,
        }),
      }),
    );
    expect(prisma.refund.findMany).toHaveBeenCalledOnce();
    expect(prisma.trainingConsumeCorrection.findMany).toHaveBeenCalledOnce();
  });

  it('routes an issued event prize to the front-desk warehouse/signoff queue', async () => {
    const prisma = {
      refund: { findMany: vi.fn() },
      trainingAttendance: { findMany: vi.fn().mockResolvedValue([]) },
      eventMatch: { findMany: vi.fn().mockResolvedValue([]) },
      eventPrizeAward: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'award-1',
            eventId: 'event-1',
            teamId: 'team-1',
            awardName: '冠军奖',
            status: 'ISSUED',
            quantity: 2,
            recipientNames: ['甲', '乙'],
            issuedAt: new Date('2026-08-30T01:00:00Z'),
            event: { name: '延庆周赛' },
            team: { name: '金羽组合' },
            inventoryItem: { name: '比赛用球', sku: 'BALL-01' },
          },
        ]),
      },
      allianceSettlement: { findMany: vi.fn() },
      trainingSettlement: { findMany: vi.fn() },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      customerLead: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new WorkItemsService(prisma as never).list(
      {
        sub: 'frontdesk-1',
        displayName: '前台',
        roles: [AppRole.FRONT_DESK],
      },
      20,
    );

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'EVENT_PRIZE_RECEIPT',
        objectId: 'award-1',
        priority: 82,
        action: '/events/event-1/prizes/award-1/receive',
      }),
    ]);
  });

  it('surfaces overdue customer leads and host applications to administrators', async () => {
    const prisma = {
      refund: { findMany: vi.fn().mockResolvedValue([]) },
      trainingAttendance: { findMany: vi.fn().mockResolvedValue([]) },
      eventMatch: { findMany: vi.fn().mockResolvedValue([]) },
      eventPrizeAward: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findMany: vi.fn().mockResolvedValue([]) },
      trainingSettlement: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      customerLead: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'lead-1',
            displayName: '李女士',
            status: 'CONTACTING',
            ownerId: null,
            sourceChannel: 'DOUYIN',
            campaign: '暑期体验',
            owner: null,
            createdAt: new Date('2026-08-28T01:00:00Z'),
            slaDueAt: new Date('2026-08-29T01:00:00Z'),
          },
        ]),
      },
      hostProfile: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'host-profile-1',
            userId: 'member-1',
            status: 'APPLIED',
            appliedAt: new Date('2026-08-29T02:00:00Z'),
            user: {
              displayName: '阿凯',
              memberProfile: { level: 'REGULAR', visitCount: 6 },
            },
          },
        ]),
      },
      accountAdjustmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
      trainingConsumeCorrection: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await new WorkItemsService(prisma as never).list(
      {
        sub: 'admin-1',
        displayName: '管理员',
        roles: [AppRole.ADMIN],
      },
      20,
    );

    expect(result.map((item) => item.kind)).toEqual([
      'CUSTOMER_LEAD_SLA',
      'HOST_APPLICATION_REVIEW',
    ]);
    expect(result[0]).toMatchObject({
      priority: 95,
      dueAt: '2026-08-29T01:00:00.000Z',
    });
    expect(result[1]).toMatchObject({
      priority: 88,
      metadata: { userId: 'member-1' },
    });
  });

  it('routes requested consume corrections only to administrators at priority 92', async () => {
    const prisma = {
      refund: { findMany: vi.fn().mockResolvedValue([]) },
      trainingAttendance: { findMany: vi.fn().mockResolvedValue([]) },
      eventMatch: { findMany: vi.fn().mockResolvedValue([]) },
      eventPrizeAward: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findMany: vi.fn().mockResolvedValue([]) },
      trainingSettlement: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      order: { findMany: vi.fn().mockResolvedValue([]) },
      customerLead: { findMany: vi.fn().mockResolvedValue([]) },
      hostProfile: { findMany: vi.fn().mockResolvedValue([]) },
      accountAdjustmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
      trainingConsumeCorrection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'correction-1',
            recognitionId: 'recognition-1',
            attendanceId: 'attendance-1',
            status: TrainingConsumeCorrectionStatus.REQUESTED,
            reason: '误将请假学员确认消课',
            requestedById: 'coach-1',
            requestedAt: new Date('2026-08-30T03:00:00Z'),
            attendance: {
              session: { class: { name: '青少年进阶班' } },
              enrollment: {
                student: { displayName: '小羽' },
                buyer: { displayName: '小羽家长' },
              },
            },
            requestedBy: { displayName: '王教练' },
          },
        ]),
      },
    };

    const service = new WorkItemsService(prisma as never);
    const result = await service.list(
      {
        sub: 'admin-1',
        displayName: '管理员',
        roles: [AppRole.ADMIN],
      },
      20,
    );
    const superAdminResult = await service.list(
      {
        sub: 'super-admin-1',
        displayName: '超级管理员',
        roles: [AppRole.SUPER_ADMIN],
      },
      20,
    );

    expect(prisma.trainingConsumeCorrection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: TrainingConsumeCorrectionStatus.REQUESTED },
        orderBy: { requestedAt: 'asc' },
        take: 20,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'training-consume-correction:correction-1',
        kind: 'TRAINING_CONSUME_CORRECTION_REVIEW',
        objectType: 'TrainingConsumeCorrection',
        objectId: 'correction-1',
        priority: 92,
        ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
        title: '消课冲正待复核 · 小羽',
        description:
          '青少年进阶班 · 学员 小羽 · 申请人 王教练 · 误将请假学员确认消课',
        action: '/training/consume-corrections/correction-1/approve',
        metadata: {
          recognitionId: 'recognition-1',
          attendanceId: 'attendance-1',
          requestedById: 'coach-1',
        },
      }),
    ]);
    expect(superAdminResult).toEqual(result);
    expect(prisma.trainingConsumeCorrection.findMany).toHaveBeenCalledTimes(2);
  });
});
