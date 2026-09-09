import { PrismaService } from '../../database/prisma.service.js';
import { BusinessType, UserStatus } from '../../generated/prisma/enums.js';
import { repeatEligibleStatuses } from '../dashboard-policy.js';

export function loadRepeatOrders(
  prisma: PrismaService,
  end: Date,
  lookback30Start: Date,
) {
  return prisma.order.findMany({
    where: {
      status: { in: repeatEligibleStatuses },
      paidAt: { gte: lookback30Start, lt: end },
      businessType: { not: BusinessType.RECHARGE },
    },
    select: { memberId: true, paidAt: true },
  });
}

export function loadNewMembers(prisma: PrismaService, start: Date, end: Date) {
  return prisma.memberProfile.count({
    where: { createdAt: { gte: start, lt: end } },
  });
}

export function loadActiveMembers(prisma: PrismaService) {
  return prisma.memberProfile.count({
    where: { user: { status: UserStatus.ACTIVE, deletedAt: null } },
  });
}

export function loadExpiringMembers(
  prisma: PrismaService,
  end: Date,
  expiringEnd: Date,
) {
  return prisma.memberProfile.count({
    where: {
      user: { status: UserStatus.ACTIVE, deletedAt: null },
      membershipExpiresAt: { gte: end, lt: expiringEnd },
    },
  });
}

export function loadInactiveMembers(
  prisma: PrismaService,
  lookback30Start: Date,
) {
  return prisma.memberProfile.count({
    where: {
      user: { status: UserStatus.ACTIVE, deletedAt: null },
      OR: [
        { lastVisitAt: { lt: lookback30Start } },
        { lastVisitAt: null, createdAt: { lt: lookback30Start } },
      ],
    },
  });
}
