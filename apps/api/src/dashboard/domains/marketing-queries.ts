import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  CouponStatus,
  RewardStatus,
  SettlementStatus,
} from '../../generated/prisma/enums.js';

export function loadDirectReferralBindings(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.auditLog.count({
    where: {
      action: 'DIRECT_REFERRAL_BOUND',
      createdAt: { gte: start, lt: end },
    },
  });
}

export function loadReferralNewCustomers(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.referralReward.count({
    where: {
      createdAt: { gte: start, lt: end },
      status: { in: [RewardStatus.AVAILABLE, RewardStatus.GRANTED] },
    },
  });
}

export function loadBadmintonCoinIssued(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.accountTransaction.aggregate({
    where: {
      account: { type: AccountType.BADMINTON_COIN },
      kind: AccountTxnKind.CREDIT,
      createdAt: { gte: start, lt: end },
    },
    _sum: { amount: true },
  });
}

export function loadCouponIssued(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.couponCode.count({
    where: { createdAt: { gte: start, lt: end } },
  });
}

export function loadCouponClaimed(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.couponCode.count({
    where: { claimedAt: { gte: start, lt: end } },
  });
}

export function loadCouponRedeemed(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.couponCode.count({
    where: {
      status: CouponStatus.REDEEMED,
      redeemedAt: { gte: start, lt: end },
    },
  });
}

export async function loadAllianceSettlements(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  const [settlements, redemptions] = await Promise.all([
    prisma.allianceSettlement.aggregate({
      where: {
        status: SettlementStatus.SETTLED,
        settledAt: { gte: start, lt: end },
      },
      _sum: {
        attributedGmvCents: true,
        attributedGrossProfitCents: true,
        cooperationFeeCents: true,
      },
    }),
    prisma.couponCode.findMany({
      where: {
        status: CouponStatus.REDEEMED,
        redeemedAt: { gte: start, lt: end },
      },
      select: {
        attributedAmountCents: true,
        holderId: true,
        holder: {
          select: { memberProfile: { select: { isNewCustomer: true } } },
        },
      },
    }),
  ]);
  return {
    ...settlements,
    redeemedGmvCents: redemptions.reduce(
      (total, code) => total + code.attributedAmountCents,
      0,
    ),
    effectiveNewCustomers: new Set(
      redemptions
        .filter(
          (code) => code.holder?.memberProfile?.isNewCustomer && code.holderId,
        )
        .map((code) => code.holderId),
    ).size,
  };
}
