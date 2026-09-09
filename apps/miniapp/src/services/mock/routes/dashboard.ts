import {
  getEnrollments,
  getTrainingSettlements,
  getSystemParameters,
} from "../state";
import { ok, requireMockRole } from "../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleDashboardAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/dashboard") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const shareParameter = getSystemParameters()
      .filter(
        (item) =>
          item.key === "finance.operating_share_rate_bps" &&
          new Date(item.effectiveFrom) <= new Date() &&
          (!item.effectiveTo || new Date(item.effectiveTo) > new Date()),
      )
      .sort((left, right) =>
        String(right.effectiveFrom).localeCompare(String(left.effectiveFrom)),
      )[0];
    const operatingShareRateBps = Number(shareParameter?.value ?? 1_500);
    const trainingRecognitionDelta = getEnrollments()
      .flatMap((enrollment) => enrollment.attendances || [])
      .flatMap((attendance: any) => attendance.revenueRecognitions || [])
      .reduce(
        (
          total: { revenueCents: number; venueContributionCents: number },
          recognition: any,
        ) => ({
          revenueCents:
            total.revenueCents + Number(recognition.effectiveRevenueCents || 0),
          venueContributionCents:
            total.venueContributionCents +
            Number(recognition.venueContributionCents || 0),
        }),
        { revenueCents: 0, venueContributionCents: 0 },
      );
    const trainingConfirmedRevenueCents =
      1_680_000 + trainingRecognitionDelta.revenueCents;
    const trainingVenueContributionCents =
      336_000 + trainingRecognitionDelta.venueContributionCents;
    const realizedRevenueCents =
      5_358_000 + trainingRecognitionDelta.revenueCents;
    return {
      handled: true,
      value: ok({
        period: {
          start: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
          end: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
          timezone: "Asia/Shanghai",
          businessDays: 1,
        },
        collections: {
          grossPaymentCents: 4_902_000,
          completedRefundCents: 188_000,
          netPaymentCents: 4_714_000,
          rechargePrepaidCents: 800_000,
          trainingPrepaidCollectedCents: 620_000,
          note: "充值和培训收款均为预收，不计入当期已实现经营收入",
        },
        revenue: {
          byBusinessType: {
            VENUE: 2_866_000,
            GAME: 148_000,
            EVENT: 198_000,
            TRAINING: 620_000,
            GOODS: 368_000,
            MEMBERSHIP: 98_000,
            RECHARGE: 0,
            ALLIANCE: 0,
          },
          venueBusinessRevenueCents: 3_678_000,
          trainingConfirmedRevenueCents,
          realizedRevenueCents,
          venueContractRevenueCents:
            4_014_000 + trainingRecognitionDelta.venueContributionCents,
        },
        operatingShare: {
          basis: "REALIZED_NET_REVENUE",
          basisRevenueCents: realizedRevenueCents,
          accruedCents: Math.round(
            (realizedRevenueCents * operatingShareRateBps) / 10_000,
          ),
          defaultRateBps: 1_500,
          rateAtPeriodEndBps: operatingShareRateBps,
          rateParameterId: shareParameter?.id || null,
          rechargeIncluded: false,
          recognitionBasis:
            "逐笔使用订单创建时保存的分成规则；履约确认计提，退款按原订单比例反冲，充值不参与",
        },
        venue: {
          courtCount: 20,
          bookingCount: 117,
          bookedCourtHours: 146,
          availableCourtHours: 200,
          closureCourtHours: 4,
          revenueCents: 2_866_000,
          utilizationRate: 73,
          daytimeUtilizationRate: 58.5,
          primeUtilizationRate: 91.25,
          revpahCents: 14_330,
        },
        members: {
          newMembers: 18,
          activeMembers: 1_286,
          sevenDayRepurchase: {
            purchaserCount: 106,
            repeatCustomerCount: 42,
            rate: 39.62,
          },
          thirtyDayRepurchase: {
            purchaserCount: 368,
            repeatCustomerCount: 201,
            rate: 54.62,
          },
          expiringWithin30Days: 23,
          inactiveOver30Days: 86,
        },
        events: {
          registrations: 36,
          participantCount: 62,
          repeatedParticipantCount: 29,
          repeatParticipationRate: 46.77,
          paidMemberParticipantCount: 31,
          paidMemberShareRate: 50,
        },
        training: {
          newSignups: 6,
          prepaidCollectedCents: 620_000,
          confirmedRevenueCents: trainingConfirmedRevenueCents,
          unusedBalanceCents: 3_860_000 - trainingRecognitionDelta.revenueCents,
          cumulativeConfirmedRevenueCents:
            18_620_000 + trainingRecognitionDelta.revenueCents,
          refundedCents: 88_000,
          cumulativeRefundedCents: 426_000,
          venueContributionCents: trainingVenueContributionCents,
          contractRateBps: 2_000,
          venueFeeCents: 0,
          trainingPayableVenueCents: 0,
          directCostCents: 486_000,
          cashContributionMarginCents:
            1_194_000 + trainingRecognitionDelta.revenueCents,
          occupiedCourtHours: 48,
          resourceEfficiencyCentsPerCourtHour: 24_875,
          coachOutput: [
            {
              coachId: "user-coach",
              classNames: ["周三晚进阶班", "周末青少年班"],
              completedSessions: 8,
              confirmedRevenueCents: trainingConfirmedRevenueCents,
              directCostCents: 486_000,
              cashContributionCents:
                1_194_000 + trainingRecognitionDelta.revenueCents,
            },
          ],
        },
        marketing: {
          directReferralBindings: 18,
          directReferralConversions: 7,
          badmintonCoinIssuedUnits: 1_260,
          couponIssued: 120,
          couponClaimed: 72,
          couponRedeemed: 48,
          couponRedemptionRate: 40,
          badmintonCoinCostRate: null,
          costRateNote:
            "羽球币现金成本需按实际核销权益成本计量，不能按币值臆算",
        },
        alliance: {
          issued: 120,
          claimed: 72,
          redeemed: 48,
          effectiveNewCustomers: 31,
          attributedGmvCents: 420_000,
          attributedGrossProfitCents: 180_000,
          cooperationFeeCents: 12_000,
          roi: 15,
        },
        goods: {
          revenueCents: 368_000,
          costCents: 186_000,
          grossProfitCents: 182_000,
          grossMarginRate: 49.46,
          inventoryValueCents: 2_260_000,
          inventoryTurnoverApprox: 0.0823,
          inventoryTurnoverBasis: "期间销售成本/期末进价库存值（经营近似值）",
          lowStockCount: 1,
        },
        contract: {
          trainingEffectiveRevenueCents: trainingConfirmedRevenueCents,
          trainingContractRateBps: 2_000,
          trainingVenueContributionCents: trainingVenueContributionCents,
          trainingVenueFeeCents: 0,
          venueBusinessRevenueCents: 3_678_000,
          venueContractRevenueCents:
            4_014_000 + trainingRecognitionDelta.venueContributionCents,
        },
        contractSettlements: getTrainingSettlements(),
      }),
    };
  }
  return { handled: false };
}
