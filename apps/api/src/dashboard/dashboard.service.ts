import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  BusinessType,
  InventoryTxnType,
  SlotPeriod,
} from '../generated/prisma/enums.js';
import {
  DEFAULT_OPERATING_SHARE_RATE_BPS,
  operatingShareCents,
  operatingShareSnapshotFromOrder,
} from '../common/finance/operating-share.js';
import {
  DAY_MS,
  shanghaiDay,
  venueBusinessTypes,
  cashPaymentChannels,
  emptyPeriodHours,
  percentage,
  sum,
  countShanghaiDays,
  byBusinessType,
  repurchaseWindow,
} from './dashboard-policy.js';
import { loadCapacity } from './domains/venue-queries.js';
import {
  loadPaidOrders,
  loadCompletedOrders,
  loadCompletedRefunds,
  loadPeriodPayments,
} from './domains/finance-queries.js';
import {
  loadRepeatOrders,
  loadNewMembers,
  loadActiveMembers,
  loadExpiringMembers,
  loadInactiveMembers,
} from './domains/members-queries.js';
import { loadEventTeams } from './domains/events-queries.js';
import {
  loadTrainingRecognitions,
  loadTrainingSessions,
  loadTrainingBalances,
  loadTrainingNewSignups,
  loadTrainingSettlements,
  loadOperatingShareParameter,
} from './domains/training-queries.js';
import {
  loadDirectReferralBindings,
  loadReferralNewCustomers,
  loadBadmintonCoinIssued,
  loadCouponIssued,
  loadCouponClaimed,
  loadCouponRedeemed,
  loadAllianceSettlements,
} from './domains/marketing-queries.js';
import {
  loadInventoryItems,
  loadGoodsCostTransactions,
} from './domains/inventory-queries.js';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(periodStart?: Date, periodEnd?: Date) {
    const today = shanghaiDay();
    const start = periodStart ?? today.start;
    const end = periodEnd ?? today.end;
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException('驾驶舱查询结束时间必须晚于开始时间');
    }

    const lookback30Start = new Date(end.getTime() - 30 * DAY_MS);
    const lookback7Start = new Date(end.getTime() - 7 * DAY_MS);
    const expiringEnd = new Date(end.getTime() + 30 * DAY_MS);

    const [
      capacity,
      paidOrders,
      completedOrders,
      completedRefunds,
      periodPayments,
      repeatOrders,
      newMembers,
      activeMembers,
      expiringMembers,
      inactiveMembers,
      eventTeams,
      trainingRecognitions,
      trainingSessions,
      trainingBalances,
      trainingNewSignups,
      directReferralBindings,
      referralNewCustomers,
      badmintonCoinIssued,
      couponIssued,
      couponClaimed,
      couponRedeemed,
      allianceSettlements,
      inventoryItems,
      goodsCostTransactions,
      trainingSettlements,
      operatingShareParameter,
    ] = await Promise.all([
      loadCapacity(this.prisma, start, end),
      loadPaidOrders(this.prisma, start, end),
      loadCompletedOrders(this.prisma, start, end),
      loadCompletedRefunds(this.prisma, start, end),
      loadPeriodPayments(this.prisma, start, end),
      loadRepeatOrders(this.prisma, end, lookback30Start),
      loadNewMembers(this.prisma, start, end),
      loadActiveMembers(this.prisma),
      loadExpiringMembers(this.prisma, end, expiringEnd),
      loadInactiveMembers(this.prisma, lookback30Start),
      loadEventTeams(this.prisma, start, end),
      loadTrainingRecognitions(this.prisma, start, end),
      loadTrainingSessions(this.prisma, start, end),
      loadTrainingBalances(this.prisma),
      loadTrainingNewSignups(this.prisma, start, end),
      loadDirectReferralBindings(this.prisma, start, end),
      loadReferralNewCustomers(this.prisma, start, end),
      loadBadmintonCoinIssued(this.prisma, start, end),
      loadCouponIssued(this.prisma, start, end),
      loadCouponClaimed(this.prisma, start, end),
      loadCouponRedeemed(this.prisma, start, end),
      loadAllianceSettlements(this.prisma, start, end),
      loadInventoryItems(this.prisma),
      loadGoodsCostTransactions(this.prisma, start, end),
      loadTrainingSettlements(this.prisma, start, end),
      loadOperatingShareParameter(this.prisma, end),
    ]);

    const collectedOrdersByBusiness = byBusinessType(
      paidOrders.map((order) => ({
        businessType: order.businessType,
        amountCents: order.paidCents,
      })),
    );
    const collectedRefundsByBusiness = byBusinessType(
      completedRefunds.map((refund) => ({
        businessType: refund.order.businessType,
        amountCents: refund.amountCents,
      })),
    );
    const netCollectionsByBusiness = Object.fromEntries(
      Object.values(BusinessType).map((type) => [
        type,
        collectedOrdersByBusiness[type] - collectedRefundsByBusiness[type],
      ]),
    ) as Record<BusinessType, number>;

    const recognizedOrdersByBusiness = byBusinessType(
      completedOrders.map((order) => ({
        businessType: order.businessType,
        amountCents:
          order.paidCents -
          order.refunds.reduce(
            (total, refund) =>
              refund.completedAt &&
              order.completedAt &&
              refund.completedAt < order.completedAt
                ? total + refund.amountCents
                : total,
            0,
          ),
      })),
    );
    const recognizedRefunds = completedRefunds.filter(
      (refund) =>
        refund.completedAt !== null &&
        refund.order.completedAt !== null &&
        refund.order.completedAt <= refund.completedAt &&
        venueBusinessTypes.includes(refund.order.businessType),
    );
    const recognizedRefundsByBusiness = byBusinessType(
      recognizedRefunds.map((refund) => ({
        businessType: refund.order.businessType,
        amountCents: refund.amountCents,
      })),
    );
    const realizedBusinessRevenue = Object.fromEntries(
      Object.values(BusinessType).map((type) => [
        type,
        recognizedOrdersByBusiness[type] - recognizedRefundsByBusiness[type],
      ]),
    ) as Record<BusinessType, number>;

    const businessDays = countShanghaiDays(start, end);
    const availableHours = emptyPeriodHours(),
      bookedHours = emptyPeriodHours();
    for (const row of capacity.rows) {
      availableHours[row.period] += row.availableMinutes / 60;
      bookedHours[row.period] += row.occupiedMinutes / 60;
    }
    const totalAvailableCourtHours = sum(Object.values(availableHours));
    const totalBookedCourtHours = sum(Object.values(bookedHours));
    const daytimeAvailableCourtHours =
      availableHours[SlotPeriod.EARLY] + availableHours[SlotPeriod.DAYTIME];
    const daytimeBookedCourtHours =
      bookedHours[SlotPeriod.EARLY] + bookedHours[SlotPeriod.DAYTIME];
    const primeAvailableCourtHours = availableHours[SlotPeriod.PRIME];
    const primeBookedCourtHours = bookedHours[SlotPeriod.PRIME];

    const trainingRevenue = sum(
      trainingRecognitions.map((item) => item.effectiveRevenueCents),
    );
    const trainingVenueContribution = sum(
      trainingRecognitions.map((item) => item.venueContributionCents),
    );
    const trainingDirectCosts = sum(
      trainingSessions.map(
        (session) =>
          session.coachCostCents +
          session.assistantCostCents +
          session.materialCostCents,
      ),
    );
    const trainingCashContributionMargin =
      trainingRevenue - trainingDirectCosts;
    const occupiedCourtHours = sum(
      trainingSessions.map((session) => Number(session.occupiedCourtHours)),
    );

    const coachOutputMap = new Map<
      string,
      {
        coachId: string | null;
        classNames: Set<string>;
        completedSessions: number;
        confirmedRevenueCents: number;
        directCostCents: number;
      }
    >();
    const coachOutput = (coachId: string | null, className: string) => {
      const key = coachId ?? 'UNASSIGNED';
      const current = coachOutputMap.get(key) ?? {
        coachId,
        classNames: new Set<string>(),
        completedSessions: 0,
        confirmedRevenueCents: 0,
        directCostCents: 0,
      };
      current.classNames.add(className);
      coachOutputMap.set(key, current);
      return current;
    };
    for (const session of trainingSessions) {
      const output = coachOutput(session.class.coachId, session.class.name);
      output.completedSessions += 1;
      output.directCostCents +=
        session.coachCostCents +
        session.assistantCostCents +
        session.materialCostCents;
    }
    for (const recognition of trainingRecognitions) {
      const trainingClass = recognition.attendance.session.class;
      const output = coachOutput(trainingClass.coachId, trainingClass.name);
      output.confirmedRevenueCents += recognition.effectiveRevenueCents;
    }

    const participantEvents = new Map<string, Set<string>>();
    for (const team of eventTeams) {
      const participantIds = new Set(
        [team.captainId, team.playerAUserId, team.playerBUserId].filter(
          (value): value is string => Boolean(value),
        ),
      );
      for (const participantId of participantIds) {
        const events =
          participantEvents.get(participantId) ?? new Set<string>();
        events.add(team.eventId);
        participantEvents.set(participantId, events);
      }
    }
    const repeatedEventParticipants = [...participantEvents.values()].filter(
      (events) => events.size >= 2,
    ).length;
    const eventParticipantIds = [...participantEvents.keys()];
    const eventMemberProfiles = eventParticipantIds.length
      ? await this.prisma.memberProfile.findMany({
          where: { userId: { in: eventParticipantIds } },
          select: {
            userId: true,
            subscriptions: {
              where: {
                status: 'ACTIVE',
                startsAt: { lt: end },
                endsAt: { gt: start },
              },
              select: { id: true },
              take: 1,
            },
          },
        })
      : [];
    const paidMemberParticipants = eventMemberProfiles.filter(
      (profile) => profile.subscriptions.length > 0,
    ).length;

    const goodsCostCents = goodsCostTransactions.reduce(
      (total, transaction) =>
        total +
        (transaction.type === InventoryTxnType.SALE_OUT ? 1 : -1) *
          Math.abs(transaction.quantity) *
          (transaction.unitCostCents ?? 0),
      0,
    );
    const inventoryValueCents = inventoryItems.reduce(
      (total, item) => total + item.stock * item.purchasePriceCents,
      0,
    );
    const goodsRevenueCents = realizedBusinessRevenue[BusinessType.GOODS];
    const venueBusinessRevenueCents = venueBusinessTypes.reduce(
      (total, type) => total + realizedBusinessRevenue[type],
      0,
    );
    const realizedRevenueCents = venueBusinessRevenueCents + trainingRevenue;
    const completedOrderShareCents = completedOrders.reduce((total, order) => {
      const recognizedCents =
        order.paidCents -
        order.refunds.reduce(
          (refundTotal, refund) =>
            refund.completedAt &&
            order.completedAt &&
            refund.completedAt < order.completedAt
              ? refundTotal + refund.amountCents
              : refundTotal,
          0,
        );
      return (
        total +
        operatingShareCents(
          recognizedCents,
          operatingShareSnapshotFromOrder(
            order.parameterSnapshot,
            order.businessType,
          ),
        )
      );
    }, 0);
    const completedRefundShareCents = recognizedRefunds.reduce(
      (total, refund) =>
        total +
        operatingShareCents(
          refund.amountCents,
          operatingShareSnapshotFromOrder(
            refund.order.parameterSnapshot,
            refund.order.businessType,
          ),
        ),
      0,
    );
    const trainingOperatingShareCents = trainingRecognitions.reduce(
      (total, recognition) =>
        total +
        operatingShareCents(
          recognition.effectiveRevenueCents,
          operatingShareSnapshotFromOrder(
            recognition.enrollment?.order?.parameterSnapshot,
            BusinessType.TRAINING,
          ),
        ),
      0,
    );
    const accruedOperatingShareCents =
      completedOrderShareCents -
      completedRefundShareCents +
      trainingOperatingShareCents;
    const periodEndOperatingShare = operatingShareSnapshotFromOrder(
      operatingShareParameter
        ? {
            operatingShare: {
              included: true,
              rateBps: operatingShareParameter.value,
            },
          }
        : null,
      BusinessType.VENUE,
    );
    const venueContractRevenueCents =
      venueBusinessRevenueCents + trainingVenueContribution;
    const completedRefundCents = completedRefunds.reduce(
      (total, refund) => total + refund.amountCents,
      0,
    );
    const grossPaymentCents = sum(
      periodPayments.map((payment) => payment.amountCents),
    );
    const cashCollectedCents = sum(
      periodPayments
        .filter((payment) => cashPaymentChannels.includes(payment.channel))
        .map((payment) => payment.amountCents),
    );
    const cashRefundedCents = sum(
      completedRefunds
        .filter((refund) => {
          const channel = refund.order.payments[0]?.channel;
          return channel !== undefined && cashPaymentChannels.includes(channel);
        })
        .map((refund) => refund.amountCents),
    );
    const sevenDayRepurchase = repurchaseWindow(
      repeatOrders,
      lookback7Start,
      end,
    );
    const thirtyDayRepurchase = repurchaseWindow(
      repeatOrders,
      lookback30Start,
      end,
    );
    const allianceGrossProfit =
      allianceSettlements._sum.attributedGrossProfitCents ?? 0;
    const allianceFee = allianceSettlements._sum.cooperationFeeCents ?? 0;

    return {
      period: { start, end, timezone: 'Asia/Shanghai', businessDays },
      collections: {
        grossPaymentCents,
        completedRefundCents,
        netPaymentCents: grossPaymentCents - completedRefundCents,
        cashCollectedCents,
        cashRefundedCents,
        netCashCents: cashCollectedCents - cashRefundedCents,
        rechargePrepaidCents: netCollectionsByBusiness[BusinessType.RECHARGE],
        trainingPrepaidCollectedCents:
          netCollectionsByBusiness[BusinessType.TRAINING],
        note: '充值和培训收款均为预收，不计入当期已实现经营收入',
      },
      revenue: {
        byBusinessType: {
          ...realizedBusinessRevenue,
          [BusinessType.TRAINING]: trainingRevenue,
          [BusinessType.RECHARGE]: 0,
        },
        venueBusinessRevenueCents,
        trainingConfirmedRevenueCents: trainingRevenue,
        realizedRevenueCents,
        venueContractRevenueCents,
        recognitionBasis:
          '场馆、活动、商品及会员业务按订单 completedAt 确认，退款按 completedAt 反冲；培训按复核消课确认',
      },
      operatingShare: {
        basis: 'REALIZED_NET_REVENUE',
        basisRevenueCents: realizedRevenueCents,
        accruedCents: accruedOperatingShareCents,
        defaultRateBps: DEFAULT_OPERATING_SHARE_RATE_BPS,
        rateAtPeriodEndBps: periodEndOperatingShare.rateBps,
        rateParameterId: operatingShareParameter?.id ?? null,
        rechargeIncluded: false,
        recognitionBasis:
          '逐笔使用订单创建时保存的分成规则；履约确认计提，退款按原订单比例反冲，充值不参与',
      },
      venue: {
        courtCount: capacity.courtCount,
        bookingCount: capacity.bookingCount,
        bookedCourtHours: totalBookedCourtHours,
        availableCourtHours: totalAvailableCourtHours,
        closureCourtHours: capacity.rows.reduce(
          (sum, row) => sum + row.closedMinutes / 60,
          0,
        ),
        utilizationRate: percentage(
          totalBookedCourtHours,
          totalAvailableCourtHours,
        ),
        daytimeUtilizationRate: percentage(
          daytimeBookedCourtHours,
          daytimeAvailableCourtHours,
        ),
        primeUtilizationRate: percentage(
          primeBookedCourtHours,
          primeAvailableCourtHours,
        ),
        revenueCents: realizedBusinessRevenue[BusinessType.VENUE],
        revpahCents:
          totalAvailableCourtHours <= 0
            ? null
            : Math.round(
                realizedBusinessRevenue[BusinessType.VENUE] /
                  totalAvailableCourtHours,
              ),
      },
      members: {
        newMembers,
        activeMembers,
        sevenDayRepurchase,
        thirtyDayRepurchase,
        expiringWithin30Days: expiringMembers,
        inactiveOver30Days: inactiveMembers,
      },
      events: {
        registrations: eventTeams.length,
        participantCount: participantEvents.size,
        repeatedParticipantCount: repeatedEventParticipants,
        repeatParticipationRate: percentage(
          repeatedEventParticipants,
          participantEvents.size,
        ),
        paidMemberParticipantCount: paidMemberParticipants,
        paidMemberShareRate: percentage(
          paidMemberParticipants,
          participantEvents.size,
        ),
      },
      training: {
        newSignups: trainingNewSignups,
        prepaidCollectedCents: netCollectionsByBusiness[BusinessType.TRAINING],
        confirmedRevenueCents: trainingRevenue,
        unusedBalanceCents: trainingBalances._sum.prepaidBalanceCents ?? 0,
        cumulativeConfirmedRevenueCents:
          trainingBalances._sum.confirmedRevenueCents ?? 0,
        refundedCents: collectedRefundsByBusiness[BusinessType.TRAINING],
        cumulativeRefundedCents: trainingBalances._sum.refundedCents ?? 0,
        venueContributionCents: trainingVenueContribution,
        contractRateBps: 2_000,
        venueFeeCents: 0,
        trainingPayableVenueCents: 0,
        directCostCents: trainingDirectCosts,
        cashContributionMarginCents: trainingCashContributionMargin,
        occupiedCourtHours,
        resourceEfficiencyCentsPerCourtHour:
          occupiedCourtHours <= 0
            ? null
            : Math.round(trainingCashContributionMargin / occupiedCourtHours),
        coachOutput: [...coachOutputMap.values()]
          .map((output) => ({
            coachId: output.coachId,
            classNames: [...output.classNames].sort(),
            completedSessions: output.completedSessions,
            confirmedRevenueCents: output.confirmedRevenueCents,
            directCostCents: output.directCostCents,
            cashContributionCents:
              output.confirmedRevenueCents - output.directCostCents,
          }))
          .sort(
            (left, right) =>
              right.confirmedRevenueCents - left.confirmedRevenueCents,
          ),
      },
      marketing: {
        directReferralBindings,
        directReferralConversions: referralNewCustomers,
        badmintonCoinIssuedUnits: badmintonCoinIssued._sum.amount ?? 0,
        couponIssued,
        couponClaimed,
        couponRedeemed,
        couponRedemptionRate: percentage(couponRedeemed, couponIssued),
        badmintonCoinCostRate: null,
        costRateNote: '羽球币现金成本需按实际核销权益成本计量，不能按币值臆算',
      },
      alliance: {
        issued: allianceSettlements._sum.issuedCount ?? 0,
        claimed: allianceSettlements._sum.claimedCount ?? 0,
        redeemed: allianceSettlements._sum.redeemedCount ?? 0,
        effectiveNewCustomers:
          allianceSettlements._sum.effectiveNewCustomers ?? 0,
        attributedGmvCents: allianceSettlements._sum.attributedGmvCents ?? 0,
        attributedGrossProfitCents: allianceGrossProfit,
        cooperationFeeCents: allianceFee,
        roi: allianceFee <= 0 ? null : allianceGrossProfit / allianceFee,
      },
      goods: {
        revenueCents: goodsRevenueCents,
        costCents: goodsCostCents,
        grossProfitCents: goodsRevenueCents - goodsCostCents,
        grossMarginRate: percentage(
          goodsRevenueCents - goodsCostCents,
          goodsRevenueCents,
        ),
        inventoryValueCents,
        inventoryTurnoverApprox:
          inventoryValueCents <= 0
            ? null
            : goodsCostCents / inventoryValueCents,
        inventoryTurnoverBasis: '期间销售成本/期末进价库存值（经营近似值）',
        lowStockCount: inventoryItems.filter(
          (item) => item.stock <= item.safeStock,
        ).length,
      },
      contract: {
        trainingEffectiveRevenueCents: trainingRevenue,
        trainingContractRateBps: 2_000,
        trainingVenueContributionCents: trainingVenueContribution,
        trainingVenueFeeCents: 0,
        venueBusinessRevenueCents,
        venueContractRevenueCents,
      },
      contractSettlements: trainingSettlements,
    };
  }
}
