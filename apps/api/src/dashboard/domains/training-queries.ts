import { PrismaService } from '../../database/prisma.service.js';
import {
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
} from '../../generated/prisma/enums.js';

export function loadTrainingRecognitions(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.trainingRevenueRecognition.findMany({
    where: { createdAt: { gte: start, lt: end } },
    select: {
      effectiveRevenueCents: true,
      venueContributionCents: true,
      enrollment: {
        select: {
          order: { select: { parameterSnapshot: true } },
        },
      },
      attendance: {
        select: {
          session: {
            select: {
              class: { select: { coachId: true, name: true } },
            },
          },
        },
      },
    },
  });
}

export function loadTrainingSessions(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.trainingSession.findMany({
    where: {
      status: TrainingSessionStatus.COMPLETED,
      startsAt: { gte: start, lt: end },
    },
    select: {
      coachCostCents: true,
      assistantCostCents: true,
      materialCostCents: true,
      occupiedCourtHours: true,
      class: { select: { coachId: true, name: true } },
    },
  });
}

export function loadTrainingBalances(prisma: PrismaService) {
  return prisma.trainingEnrollment.aggregate({
    where: {
      status: {
        in: [
          TrainingEnrollmentStatus.ACTIVE,
          TrainingEnrollmentStatus.COMPLETED,
          TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
          TrainingEnrollmentStatus.REFUNDED,
        ],
      },
    },
    _sum: {
      prepaidBalanceCents: true,
      confirmedRevenueCents: true,
      refundedCents: true,
    },
  });
}

export function loadTrainingNewSignups(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.trainingEnrollment.count({
    where: {
      startsAt: { gte: start, lt: end },
      status: {
        in: [
          TrainingEnrollmentStatus.ACTIVE,
          TrainingEnrollmentStatus.COMPLETED,
          TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
        ],
      },
    },
  });
}

export function loadTrainingSettlements(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.trainingSettlement.findMany({
    where: { periodStart: { lt: end }, periodEnd: { gt: start } },
    orderBy: { periodEnd: 'desc' },
  });
}

export function loadOperatingShareParameter(prisma: PrismaService, end: Date) {
  return prisma.systemParameter.findFirst({
    where: {
      key: 'finance.operating_share_rate_bps',
      effectiveFrom: { lt: end },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: end } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
}
