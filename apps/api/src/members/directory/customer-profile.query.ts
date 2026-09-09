import { NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole } from '../../generated/prisma/client.js';
import {
  ACTIVE_TRAINING_STATUSES,
  FRONT_DESK_ACCOUNT_TYPES,
  maskPhone,
  frontDeskPaymentSummary,
} from '../shared/members-support.js';
import { isCoachOnly, assertAnyRole } from '../shared/members-policy.js';
import {
  isFrontDeskLimited,
  memberPrivacyScope,
} from './members-directory.commands.js';

export async function customer360(
  prisma: PrismaService,
  userId: string,
  actor: AuthUser,
) {
  const coachOnly = isCoachOnly(actor);
  if (coachOnly) {
    const assigned = await prisma.trainingEnrollment.findFirst({
      where: {
        status: { in: ACTIVE_TRAINING_STATUSES },
        class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
        OR: [{ buyerId: userId }, { student: { guardianId: userId } }],
      },
      select: { id: true },
    });
    if (!assigned) throw new NotFoundException('会员不在当前教练负责的班级中');
    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        memberProfile: {
          select: {
            level: true,
            tags: true,
            lastVisitAt: true,
            visitCount: true,
          },
        },
        trainingPurchases: {
          where: {
            status: { in: ACTIVE_TRAINING_STATUSES },
            class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
          },
          select: {
            id: true,
            enrollmentNo: true,
            status: true,
            totalSessions: true,
            consumedSessions: true,
            expiresAt: true,
            product: { select: { id: true, name: true } },
            class: { select: { id: true, name: true } },
            student: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!member) throw new NotFoundException('会员不存在');
    return {
      member: {
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        phone: null,
        memberProfile: member.memberProfile,
      },
      accounts: [],
      recentOrders: [],
      recentTraining: member.trainingPurchases,
      recentGames: [],
      recentEvents: [],
      recentCoupons: [],
      privacyScope: 'COACH_ASSIGNED' as const,
      financialsRedacted: true,
      accountTypesLimited: true,
    };
  }

  assertAnyRole(
    actor,
    [AppRole.FRONT_DESK, AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    '无权查看会员全景',
  );
  if (isFrontDeskLimited(actor)) {
    const member = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        createdAt: true,
        memberProfile: {
          select: {
            level: true,
            tags: true,
            membershipExpiresAt: true,
            isNewCustomer: true,
            firstVisitAt: true,
            lastVisitAt: true,
            visitCount: true,
          },
        },
        referrer: { select: { displayName: true } },
        accounts: {
          where: { type: { in: FRONT_DESK_ACCOUNT_TYPES } },
          select: { id: true, type: true, balance: true, frozenBalance: true },
          orderBy: { type: 'asc' },
        },
        memberOrders: {
          select: {
            id: true,
            orderNo: true,
            businessType: true,
            status: true,
            title: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        trainingPurchases: {
          select: {
            id: true,
            enrollmentNo: true,
            status: true,
            totalSessions: true,
            consumedSessions: true,
            expiresAt: true,
            product: { select: { id: true, name: true } },
            class: { select: { id: true, name: true } },
            student: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        gameRegistrations: {
          select: {
            id: true,
            status: true,
            checkedInAt: true,
            createdAt: true,
            game: {
              select: {
                id: true,
                code: true,
                title: true,
                startsAt: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        eventCaptains: {
          select: {
            id: true,
            name: true,
            status: true,
            finalRank: true,
            createdAt: true,
            event: {
              select: {
                id: true,
                code: true,
                name: true,
                startsAt: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        couponHoldings: {
          select: {
            id: true,
            code: true,
            status: true,
            claimedAt: true,
            redeemedAt: true,
            expiresAt: true,
            template: {
              select: {
                id: true,
                name: true,
                benefitDescription: true,
                merchant: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!member) throw new NotFoundException('会员不存在');
    const {
      accounts,
      memberOrders,
      trainingPurchases,
      gameRegistrations,
      eventCaptains,
      couponHoldings,
      ...basic
    } = member;
    return {
      member: { ...basic, phone: maskPhone(basic.phone) },
      accounts: [],
      paymentSummary: frontDeskPaymentSummary(accounts),
      recentOrders: memberOrders,
      recentTraining: trainingPurchases,
      recentGames: gameRegistrations,
      recentEvents: eventCaptains,
      recentCoupons: couponHoldings,
      privacyScope: 'FRONT_DESK_LIMITED' as const,
      financialsRedacted: true,
      accountTypesLimited: true,
    };
  }

  const privacyScope = memberPrivacyScope(actor);
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      phone: true,
      status: true,
      createdAt: true,
      memberProfile: true,
      referrer:
        privacyScope === 'ADMIN'
          ? { select: { id: true, displayName: true } }
          : { select: { displayName: true } },
      accounts: {
        select: {
          id: true,
          type: true,
          balance: true,
          frozenBalance: true,
          updatedAt: true,
        },
        orderBy: { type: 'asc' },
      },
      memberOrders: {
        select: {
          id: true,
          orderNo: true,
          businessType: true,
          status: true,
          title: true,
          payableCents: true,
          paidCents: true,
          refundedCents: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      trainingPurchases: {
        select: {
          id: true,
          enrollmentNo: true,
          status: true,
          totalSessions: true,
          consumedSessions: true,
          prepaidBalanceCents: true,
          confirmedRevenueCents: true,
          refundedCents: true,
          expiresAt: true,
          product: { select: { id: true, name: true } },
          class: { select: { id: true, name: true } },
          student: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      gameRegistrations: {
        select: {
          id: true,
          status: true,
          checkedInAt: true,
          createdAt: true,
          game: {
            select: {
              id: true,
              code: true,
              title: true,
              startsAt: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      eventCaptains: {
        select: {
          id: true,
          name: true,
          status: true,
          finalRank: true,
          eventPointsAwarded: true,
          createdAt: true,
          event: {
            select: {
              id: true,
              code: true,
              name: true,
              startsAt: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      couponHoldings: {
        select: {
          id: true,
          code: true,
          status: true,
          claimedAt: true,
          redeemedAt: true,
          expiresAt: true,
          template: {
            select: {
              id: true,
              name: true,
              benefitDescription: true,
              merchant: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!member) throw new NotFoundException('会员不存在');
  const {
    accounts,
    memberOrders,
    trainingPurchases,
    gameRegistrations,
    eventCaptains,
    couponHoldings,
    ...basic
  } = member;
  return {
    member: {
      ...basic,
      phone: privacyScope === 'ADMIN' ? basic.phone : maskPhone(basic.phone),
    },
    accounts,
    recentOrders: memberOrders,
    recentTraining: trainingPurchases,
    recentGames: gameRegistrations,
    recentEvents: eventCaptains,
    recentCoupons: couponHoldings,
    privacyScope,
    financialsRedacted: false,
    accountTypesLimited: false,
  };
}
