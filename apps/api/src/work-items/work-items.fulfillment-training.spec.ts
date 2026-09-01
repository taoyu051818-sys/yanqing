import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  BookingStatus,
  BusinessType,
  OrderStatus,
  RegistrationStatus,
  TrainingTrialStatus,
  YouthTrainingRuleStatus,
} from '../generated/prisma/enums.js';
import { WorkItemsService } from './work-items.service.js';

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};

const emptyPrisma = () => ({
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
  dataErasureRequest: { findMany: vi.fn().mockResolvedValue([]) },
  accountAdjustmentRequest: { findMany: vi.fn().mockResolvedValue([]) },
  trainingConsumeCorrection: { findMany: vi.fn().mockResolvedValue([]) },
  trainingTrial: { findMany: vi.fn().mockResolvedValue([]) },
  youthTrainingRule: { findMany: vi.fn().mockResolvedValue([]) },
  userRole: { findMany: vi.fn().mockResolvedValue([]) },
});

describe('WorkItemsService fulfillment and training handoffs', () => {
  it('shows low-stock handoffs only to front desk and administrators', async () => {
    const frontDeskPrisma = emptyPrisma();
    frontDeskPrisma.inventoryItem.findMany.mockResolvedValue([
      {
        id: 'item-low',
        name: '比赛用球',
        sku: 'BALL-01',
        stock: 2,
        safeStock: 8,
        updatedAt: new Date('2026-08-29T01:00:00.000Z'),
      },
    ] as never);
    const frontDeskResult = await new WorkItemsService(
      frontDeskPrisma as never,
    ).list(
      {
        sub: 'front-1',
        displayName: '前台',
        roles: [AppRole.FRONT_DESK],
      },
      20,
    );

    expect(frontDeskResult).toContainEqual(
      expect.objectContaining({
        kind: 'LOW_STOCK',
        ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
        action:
          '/packages/ops/pages/inventory/index?focus=low-stock&id=item-low',
      }),
    );
    expect(frontDeskPrisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          name: true,
          sku: true,
          stock: true,
          safeStock: true,
          updatedAt: true,
        },
      }),
    );

    for (const role of [
      AppRole.COACH,
      AppRole.EVENT_MANAGER,
      AppRole.FINANCE,
      AppRole.MERCHANT,
    ]) {
      const prisma = emptyPrisma();
      const result = await new WorkItemsService(prisma as never).list(
        {
          sub: `${role.toLowerCase()}-1`,
          displayName: role,
          roles: [role],
        },
        20,
      );
      expect(result.some((item) => item.kind === 'LOW_STOCK')).toBe(false);
      expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    }
  });

  it('queries and maps only due venue/game/event fulfillment orders', async () => {
    const prisma = emptyPrisma();
    const createdAt = new Date('2026-08-29T00:00:00.000Z');
    prisma.order.findMany.mockResolvedValue([
      {
        id: 'venue-order',
        orderNo: 'VN001',
        title: '1号场',
        status: OrderStatus.CHECKED_IN,
        businessType: BusinessType.VENUE,
        createdAt,
        bookings: [
          {
            id: 'booking-1',
            status: BookingStatus.CHECKED_IN,
            endsAt: createdAt,
          },
        ],
        gameRegistration: null,
        eventTeam: null,
      },
      {
        id: 'game-order',
        orderNo: 'GM001',
        title: '周末球局',
        status: OrderStatus.PAID,
        businessType: BusinessType.GAME,
        createdAt,
        bookings: [],
        gameRegistration: {
          id: 'registration-1',
          status: RegistrationStatus.PAID,
          game: { id: 'game-1', title: '周末球局', endsAt: createdAt },
        },
        eventTeam: null,
      },
      {
        id: 'event-order',
        orderNo: 'EV001',
        title: '延庆周赛',
        status: OrderStatus.PAID,
        businessType: BusinessType.EVENT,
        createdAt,
        bookings: [],
        gameRegistration: null,
        eventTeam: {
          id: 'team-1',
          status: RegistrationStatus.PAID,
          event: { id: 'event-1', name: '延庆周赛', startsAt: createdAt },
        },
      },
    ] as never);

    const result = await new WorkItemsService(prisma as never).list(admin, 20);

    expect(result.map((item) => item.kind)).toEqual([
      'ORDER_FULFILLMENT',
      'ORDER_FULFILLMENT',
      'ORDER_FULFILLMENT',
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectId: 'venue-order',
          action:
            '/packages/ops/pages/frontdesk/index?focus=fulfillment&orderId=venue-order',
          ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
          metadata: expect.objectContaining({
            businessType: BusinessType.VENUE,
            fulfillmentObjectId: 'booking-1',
          }),
        }),
        expect.objectContaining({
          objectId: 'game-order',
          action:
            '/packages/ops/pages/host/index?focus=fulfillment&orderId=game-order',
          ownerRoles: [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN],
          metadata: expect.objectContaining({
            businessType: BusinessType.GAME,
            fulfillmentObjectId: 'registration-1',
          }),
        }),
        expect.objectContaining({
          objectId: 'event-order',
          action:
            '/packages/ops/pages/event/index?focus=fulfillment&orderId=event-order',
          ownerRoles: [
            AppRole.EVENT_MANAGER,
            AppRole.ADMIN,
            AppRole.SUPER_ADMIN,
          ],
          metadata: expect.objectContaining({
            businessType: BusinessType.EVENT,
            fulfillmentObjectId: 'team-1',
          }),
        }),
      ]),
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          completedAt: null,
          OR: expect.arrayContaining([
            expect.objectContaining({ businessType: BusinessType.VENUE }),
            expect.objectContaining({ businessType: BusinessType.GAME }),
            expect.objectContaining({ businessType: BusinessType.EVENT }),
          ]),
        }),
      }),
    );
    expect(
      JSON.stringify(prisma.order.findMany.mock.calls[0][0].where),
    ).not.toContain(BusinessType.TRAINING);
  });

  it('puts trial arrival/assessment/decision and draft youth rules in the unified queue', async () => {
    const prisma = emptyPrisma();
    const startsAt = new Date('2026-08-29T02:00:00.000Z');
    const endsAt = new Date('2026-08-29T03:00:00.000Z');
    const common = {
      trialNo: 'TR001',
      productId: 'product-1',
      coachId: 'coach-1',
      scheduledStartsAt: startsAt,
      scheduledEndsAt: endsAt,
      createdAt: startsAt,
      product: { name: '青少年基础班' },
      student: { displayName: '小羽' },
      member: null,
      lead: null,
      coach: { displayName: '王教练' },
    };
    prisma.trainingTrial.findMany.mockResolvedValue([
      { ...common, id: 'trial-reserved', status: TrainingTrialStatus.RESERVED },
      {
        ...common,
        id: 'trial-checked',
        status: TrainingTrialStatus.CHECKED_IN,
      },
      { ...common, id: 'trial-assessed', status: TrainingTrialStatus.ASSESSED },
    ] as never);
    prisma.youthTrainingRule.findMany.mockResolvedValue([
      {
        id: 'rule-1',
        version: 'YOUTH-2026-01',
        status: YouthTrainingRuleStatus.DRAFT,
        maxTotalSessions: 20,
        maxValidityDays: 90,
        maxContractAmountCents: 20_000,
        hardBlock: true,
        effectiveFrom: startsAt,
        requestedById: 'admin-1',
        requestedBy: { displayName: '运营管理员' },
        createdAt: startsAt,
      },
    ] as never);

    const result = await new WorkItemsService(prisma as never).list(
      {
        sub: 'super-1',
        displayName: '超级管理员',
        roles: [AppRole.SUPER_ADMIN],
      },
      20,
    );

    expect(result.map((item) => item.kind)).toEqual([
      'TRAINING_TRIAL_CHECK_IN',
      'YOUTH_TRAINING_RULE_REVIEW',
      'TRAINING_TRIAL_ASSESSMENT',
      'TRAINING_TRIAL_DECISION',
    ]);
    expect(result[0]).toMatchObject({
      objectId: 'trial-reserved',
      dueAt: startsAt.toISOString(),
      ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    });
    expect(result[1]).toMatchObject({
      objectId: 'rule-1',
      ownerRoles: [AppRole.SUPER_ADMIN],
    });
    expect(prisma.youthTrainingRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: YouthTrainingRuleStatus.DRAFT },
      }),
    );
  });

  it('scopes a coach assessment queue to their own checked-in trials', async () => {
    const prisma = emptyPrisma();

    await new WorkItemsService(prisma as never).list(
      {
        sub: 'coach-1',
        displayName: '王教练',
        roles: [AppRole.COACH],
      },
      20,
    );

    expect(prisma.trainingTrial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ status: TrainingTrialStatus.CHECKED_IN, coachId: 'coach-1' }],
        },
      }),
    );
    expect(prisma.youthTrainingRule.findMany).not.toHaveBeenCalled();
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });
});
