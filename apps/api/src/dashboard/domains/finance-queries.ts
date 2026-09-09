import { PrismaService } from '../../database/prisma.service.js';
import { PaymentStatus, RefundStatus } from '../../generated/prisma/enums.js';
import {
  collectionOrderStatuses,
  venueBusinessTypes,
} from '../dashboard-policy.js';

export function loadPaidOrders(prisma: PrismaService, start: Date, end: Date) {
  return prisma.order.findMany({
    where: {
      status: { in: collectionOrderStatuses },
      paidAt: { gte: start, lt: end },
    },
    select: {
      businessType: true,
      memberId: true,
      paidCents: true,
      paidAt: true,
    },
  });
}

export function loadCompletedOrders(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.order.findMany({
    where: {
      businessType: { in: venueBusinessTypes },
      completedAt: { gte: start, lt: end },
    },
    select: {
      businessType: true,
      paidCents: true,
      completedAt: true,
      parameterSnapshot: true,
      refunds: {
        where: { status: RefundStatus.SUCCEEDED },
        select: { amountCents: true, completedAt: true },
      },
    },
  });
}

export function loadCompletedRefunds(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.refund.findMany({
    where: {
      status: RefundStatus.SUCCEEDED,
      completedAt: { gte: start, lt: end },
    },
    select: {
      amountCents: true,
      completedAt: true,
      order: {
        select: {
          businessType: true,
          completedAt: true,
          parameterSnapshot: true,
          payments: {
            where: {
              status: {
                in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED],
              },
            },
            orderBy: { paidAt: 'asc' },
            take: 1,
            select: { channel: true },
          },
        },
      },
    },
  });
}

export function loadPeriodPayments(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.payment.findMany({
    where: {
      status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
      paidAt: { gte: start, lt: end },
    },
    select: { amountCents: true, channel: true },
  });
}
