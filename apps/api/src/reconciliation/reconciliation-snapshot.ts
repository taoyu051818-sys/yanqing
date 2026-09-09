import {
  AttendanceStatus,
  BookingStatus,
  BusinessType,
  FrontDeskShiftStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  RegistrationStatus,
  SettlementStatus,
  TrainingRecognitionType,
  TrainingSessionStatus,
} from '../generated/prisma/client.js';
import {
  PENDING_REFUNDS,
  PENDING_PAYMENTS,
  FINAL_ORDER_STATUSES,
  ReconciliationBlocker,
  BusinessDay,
  Snapshot,
} from './reconciliation-policy.js';

export async function snapshot(
  client: Pick<
    Prisma.TransactionClient,
    | 'refund'
    | 'payment'
    | 'allianceSettlement'
    | 'trainingSettlement'
    | 'consignmentSettlement'
    | 'consignmentPayableEntry'
    | 'order'
    | 'trainingSession'
    | 'trainingRevenueRecognition'
    | 'inventoryTransaction'
    | 'frontDeskShift'
  >,
  day: BusinessDay,
): Promise<Snapshot> {
  const [
    pendingRefunds,
    pendingPayments,
    openFrontDeskShifts,
    unreviewedCashVariances,
    unfulfilledOrders,
    unfulfilledTrainingSessions,
    orders,
    payments,
    refunds,
    recognitions,
    alliance,
    trainingSettlement,
    consignmentPayables,
    consignmentSettlements,
    inventory,
  ] = await Promise.all([
    // Daily close locks source-business evidence. Periodic settlements are
    // downstream finance work and remain visible in their workbench rather
    // than blocking every business day in a weekly/monthly cycle.
    client.refund.count({
      where: {
        requestedAt: { lt: day.end },
        status: { in: [...PENDING_REFUNDS] },
      },
    }),
    client.payment.count({
      where: {
        createdAt: { lt: day.end },
        status: { in: [...PENDING_PAYMENTS] },
      },
    }),
    client.frontDeskShift.count({
      where: {
        businessDate: day.start,
        status: FrontDeskShiftStatus.OPEN,
      },
    }),
    client.frontDeskShift.count({
      where: {
        businessDate: day.start,
        status: FrontDeskShiftStatus.CLOSED,
        cashVarianceCents: { not: 0 },
        varianceReviewedAt: null,
      },
    }),
    client.order.count({
      where: {
        businessType: {
          in: [BusinessType.VENUE, BusinessType.GAME, BusinessType.EVENT],
        },
        completedAt: null,
        status: {
          in: [
            OrderStatus.PAID,
            OrderStatus.CHECKED_IN,
            OrderStatus.COMPLETED,
            OrderStatus.REFUND_PENDING,
            OrderStatus.PARTIALLY_REFUNDED,
          ],
        },
        OR: [
          {
            businessType: BusinessType.VENUE,
            bookings: {
              some: {
                endsAt: { lt: day.end },
                status: {
                  in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
                },
              },
            },
          },
          {
            businessType: BusinessType.GAME,
            gameRegistration: {
              is: {
                status: {
                  in: [RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN],
                },
                game: { endsAt: { lt: day.end } },
              },
            },
          },
          {
            businessType: BusinessType.EVENT,
            eventTeam: {
              is: {
                status: {
                  in: [RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN],
                },
                event: { startsAt: { lt: day.end } },
              },
            },
          },
        ],
      },
    }),
    client.trainingSession.count({
      where: {
        status: { not: TrainingSessionStatus.CANCELLED },
        endsAt: { lt: day.end },
        attendances: {
          some: {
            OR: [
              { status: AttendanceStatus.PENDING },
              {
                status: AttendanceStatus.ATTENDED,
                OR: [
                  { consumedSessions: 0 },
                  {
                    revenueRecognitions: {
                      none: {
                        type: TrainingRecognitionType.CONSUME,
                        reversedBy: { is: null },
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    }),
    client.order.aggregate({
      where: {
        paidAt: { gte: day.start, lt: day.end },
        status: { in: [...FINAL_ORDER_STATUSES] },
      },
      _sum: { paidCents: true, refundedCents: true },
    }),
    client.payment.aggregate({
      where: {
        paidAt: { gte: day.start, lt: day.end },
        status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
      },
      _sum: { amountCents: true },
    }),
    client.refund.aggregate({
      where: {
        completedAt: { gte: day.start, lt: day.end },
        status: RefundStatus.SUCCEEDED,
      },
      _sum: { amountCents: true },
    }),
    client.trainingRevenueRecognition.aggregate({
      where: { createdAt: { gte: day.start, lt: day.end } },
      _sum: { effectiveRevenueCents: true, venueContributionCents: true },
    }),
    client.allianceSettlement.aggregate({
      where: {
        status: SettlementStatus.SETTLED,
        settledAt: { gte: day.start, lt: day.end },
      },
      _sum: { attributedGmvCents: true, cooperationFeeCents: true },
    }),
    client.trainingSettlement.aggregate({
      where: {
        status: SettlementStatus.SETTLED,
        settledAt: { gte: day.start, lt: day.end },
      },
      _sum: { venueContributionCents: true },
    }),
    client.consignmentPayableEntry.aggregate({
      where: { occurredAt: { gte: day.start, lt: day.end } },
      _sum: { payableCents: true },
    }),
    client.consignmentSettlement.aggregate({
      where: {
        status: SettlementStatus.SETTLED,
        settledAt: { gte: day.start, lt: day.end },
      },
      _sum: { payableCents: true },
    }),
    client.inventoryTransaction.findMany({
      where: { createdAt: { gte: day.start, lt: day.end } },
      select: { quantity: true, unitCostCents: true },
    }),
  ]);

  const blockers: ReconciliationBlocker[] = [];
  if (pendingRefunds > 0)
    blockers.push({
      kind: 'PENDING_REFUNDS',
      count: pendingRefunds,
      message: `有 ${pendingRefunds} 笔退款待处理`,
    });
  if (pendingPayments > 0)
    blockers.push({
      kind: 'PENDING_PAYMENTS',
      count: pendingPayments,
      message: `有 ${pendingPayments} 笔支付待处理`,
    });
  if (openFrontDeskShifts > 0)
    blockers.push({
      kind: 'OPEN_FRONT_DESK_SHIFTS',
      count: openFrontDeskShifts,
      message: `有 ${openFrontDeskShifts} 个前台班次尚未关班`,
    });
  if (unreviewedCashVariances > 0)
    blockers.push({
      kind: 'UNREVIEWED_CASH_VARIANCES',
      count: unreviewedCashVariances,
      message: `有 ${unreviewedCashVariances} 个现金差异尚未由财务复核`,
    });
  if (unfulfilledOrders > 0)
    blockers.push({
      kind: 'UNFULFILLED_ORDERS',
      count: unfulfilledOrders,
      message: `有 ${unfulfilledOrders} 笔已到期场地/球局/赛事订单尚未确认履约`,
    });
  if (unfulfilledTrainingSessions > 0)
    blockers.push({
      kind: 'UNFULFILLED_TRAINING_SESSIONS',
      count: unfulfilledTrainingSessions,
      message: `有 ${unfulfilledTrainingSessions} 节已结束培训课次尚未完成点名或消课`,
    });

  return {
    totals: {
      orderPaidCents: orders._sum.paidCents ?? 0,
      orderRefundedCents: orders._sum.refundedCents ?? 0,
      successfulPaymentCents: payments._sum.amountCents ?? 0,
      completedRefundCents: refunds._sum.amountCents ?? 0,
      trainingEffectiveRevenueCents:
        recognitions._sum.effectiveRevenueCents ?? 0,
      trainingVenueContributionCents:
        recognitions._sum.venueContributionCents ?? 0,
      trainingSettlementVenueContributionCents:
        trainingSettlement._sum.venueContributionCents ?? 0,
      allianceAttributedGmvCents: alliance._sum.attributedGmvCents ?? 0,
      allianceCooperationFeeCents: alliance._sum.cooperationFeeCents ?? 0,
      consignmentPayableCents: consignmentPayables._sum.payableCents ?? 0,
      consignmentSettledPayableCents:
        consignmentSettlements._sum.payableCents ?? 0,
      inventoryTransactionCount: inventory.length,
      // Inventory transactions carry a unit cost and a signed quantity.
      // Summing only unitCostCents under-reported multi-item movements and
      // made the close snapshot impossible to reconcile with the stock
      // ledger.  Use absolute quantity so both in/out movements contribute
      // their auditable cost value; the transaction type remains available
      // in the detailed inventory ledger for a net-cost interpretation.
      inventoryCostCents: inventory.reduce(
        (sum, item) =>
          sum + Math.abs(item.quantity) * (item.unitCostCents ?? 0),
        0,
      ),
    },
    blockers,
  };
}
