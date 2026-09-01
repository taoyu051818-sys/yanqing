import { BadRequestException, Injectable } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service.js'
import {
  AccountTxnKind,
  AccountType,
  BookingStatus,
  BusinessType,
  CouponStatus,
  InventoryTxnType,
  OrderStatus,
  PaymentChannel,
  PaymentStatus,
  RefundStatus,
  RewardStatus,
  SlotPeriod,
  TrainingEnrollmentStatus,
  TrainingSessionStatus,
  UserStatus,
} from '../generated/prisma/enums.js'

const DAY_MS = 86_400_000
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000

const shanghaiDay = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const day = formatter.format(new Date())
  return {
    start: new Date(`${day}T00:00:00+08:00`),
    end: new Date(`${day}T24:00:00+08:00`),
  }
}

const collectionOrderStatuses = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.REFUNDED,
]

const repeatEligibleStatuses = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
]

const venueBusinessTypes: BusinessType[] = [
  BusinessType.VENUE,
  BusinessType.GAME,
  BusinessType.EVENT,
  BusinessType.GOODS,
  BusinessType.MEMBERSHIP,
]

const cashPaymentChannels: PaymentChannel[] = [
  PaymentChannel.WECHAT,
  PaymentChannel.OFFLINE_CASH,
]

type SlotDefinition = {
  startMinutes: number
  endMinutes: number
  period: SlotPeriod
}

type PeriodHours = Record<SlotPeriod, number>

const emptyPeriodHours = (): PeriodHours => ({
  [SlotPeriod.EARLY]: 0,
  [SlotPeriod.DAYTIME]: 0,
  [SlotPeriod.PRIME]: 0,
})

const percentage = (numerator: number, denominator: number) =>
  denominator <= 0 ? 0 : Math.round((numerator / denominator) * 10_000) / 100

const nonnegative = (value: number) => Math.max(0, value)

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0)

/**
 * Allocate an absolute interval into the configured Shanghai business slots.
 * Bookings and closures normally stay inside one day, but iterating by local
 * business day also keeps overnight maintenance and custom periods correct.
 */
const allocateIntervalHours = (
  startsAt: Date,
  endsAt: Date,
  rangeStart: Date,
  rangeEnd: Date,
  slots: SlotDefinition[],
): PeriodHours => {
  const result = emptyPeriodHours()
  const clippedStart = Math.max(startsAt.getTime(), rangeStart.getTime())
  const clippedEnd = Math.min(endsAt.getTime(), rangeEnd.getTime())
  if (clippedEnd <= clippedStart) return result

  const shiftedStart = new Date(clippedStart + SHANGHAI_OFFSET_MS)
  let localDayStart =
    Date.UTC(
      shiftedStart.getUTCFullYear(),
      shiftedStart.getUTCMonth(),
      shiftedStart.getUTCDate(),
    ) - SHANGHAI_OFFSET_MS

  while (localDayStart < clippedEnd) {
    const localDayEnd = localDayStart + DAY_MS
    const intervalStartMinutes =
      (Math.max(clippedStart, localDayStart) - localDayStart) / 60_000
    const intervalEndMinutes =
      (Math.min(clippedEnd, localDayEnd) - localDayStart) / 60_000
    for (const slot of slots) {
      const overlapMinutes =
        Math.min(intervalEndMinutes, slot.endMinutes) -
        Math.max(intervalStartMinutes, slot.startMinutes)
      if (overlapMinutes > 0) result[slot.period] += overlapMinutes / 60
    }
    localDayStart = localDayEnd
  }
  return result
}

const addPeriodHours = (target: PeriodHours, source: PeriodHours) => {
  for (const period of Object.values(SlotPeriod))
    target[period] += source[period]
}

const countShanghaiDays = (start: Date, end: Date): number => {
  const shiftedStart = new Date(start.getTime() + SHANGHAI_OFFSET_MS)
  const shiftedEnd = new Date(end.getTime() - 1 + SHANGHAI_OFFSET_MS)
  const first = Date.UTC(
    shiftedStart.getUTCFullYear(),
    shiftedStart.getUTCMonth(),
    shiftedStart.getUTCDate(),
  )
  const last = Date.UTC(
    shiftedEnd.getUTCFullYear(),
    shiftedEnd.getUTCMonth(),
    shiftedEnd.getUTCDate(),
  )
  return Math.max(1, Math.round((last - first) / DAY_MS) + 1)
}

const byBusinessType = <
  T extends { businessType: BusinessType; amountCents: number },
>(
  rows: T[],
) => {
  const result = Object.fromEntries(
    Object.values(BusinessType).map((type) => [type, 0]),
  ) as Record<BusinessType, number>
  for (const row of rows) result[row.businessType] += row.amountCents
  return result
}

const repurchaseWindow = (
  orders: Array<{ memberId: string; paidAt: Date | null }>,
  startsAt: Date,
  endsAt: Date,
) => {
  const counts = new Map<string, number>()
  for (const order of orders) {
    if (!order.paidAt || order.paidAt < startsAt || order.paidAt >= endsAt)
      continue
    counts.set(order.memberId, (counts.get(order.memberId) ?? 0) + 1)
  }
  const purchaserCount = counts.size
  const repeatCustomerCount = [...counts.values()].filter(
    (count) => count >= 2,
  ).length
  return {
    purchaserCount,
    repeatCustomerCount,
    rate: percentage(repeatCustomerCount, purchaserCount),
  }
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(periodStart?: Date, periodEnd?: Date) {
    const today = shanghaiDay()
    const start = periodStart ?? today.start
    const end = periodEnd ?? today.end
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      throw new BadRequestException('驾驶舱查询结束时间必须晚于开始时间')
    }

    const lookback30Start = new Date(end.getTime() - 30 * DAY_MS)
    const lookback7Start = new Date(end.getTime() - 7 * DAY_MS)
    const expiringEnd = new Date(end.getTime() + 30 * DAY_MS)

    const [
      courtCount,
      timeSlots,
      venueBookings,
      venueClosures,
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
    ] = await Promise.all([
      this.prisma.court.count({ where: { enabled: true } }),
      this.prisma.timeSlot.findMany({
        where: { enabled: true },
        select: { startMinutes: true, endMinutes: true, period: true },
        orderBy: { startMinutes: 'asc' },
      }),
      this.prisma.courtBooking.findMany({
        where: {
          startsAt: { lt: end },
          endsAt: { gt: start },
          status: {
            in: [
              BookingStatus.CONFIRMED,
              BookingStatus.CHECKED_IN,
              BookingStatus.COMPLETED,
            ],
          },
        },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.courtClosure.findMany({
        where: {
          status: 'ACTIVE',
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.order.findMany({
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
      }),
      this.prisma.order.findMany({
        where: {
          businessType: { in: venueBusinessTypes },
          completedAt: { gte: start, lt: end },
        },
        select: {
          businessType: true,
          paidCents: true,
          completedAt: true,
          refunds: {
            where: { status: RefundStatus.SUCCEEDED },
            select: { amountCents: true, completedAt: true },
          },
        },
      }),
      this.prisma.refund.findMany({
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
      }),
      this.prisma.payment.findMany({
        where: {
          status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
          paidAt: { gte: start, lt: end },
        },
        select: { amountCents: true, channel: true },
      }),
      this.prisma.order.findMany({
        where: {
          status: { in: repeatEligibleStatuses },
          paidAt: { gte: lookback30Start, lt: end },
          businessType: { not: BusinessType.RECHARGE },
        },
        select: { memberId: true, paidAt: true },
      }),
      this.prisma.memberProfile.count({
        where: { createdAt: { gte: start, lt: end } },
      }),
      this.prisma.memberProfile.count({
        where: { user: { status: UserStatus.ACTIVE, deletedAt: null } },
      }),
      this.prisma.memberProfile.count({
        where: {
          user: { status: UserStatus.ACTIVE, deletedAt: null },
          membershipExpiresAt: { gte: end, lt: expiringEnd },
        },
      }),
      this.prisma.memberProfile.count({
        where: {
          user: { status: UserStatus.ACTIVE, deletedAt: null },
          OR: [
            { lastVisitAt: { lt: lookback30Start } },
            { lastVisitAt: null, createdAt: { lt: lookback30Start } },
          ],
        },
      }),
      this.prisma.eventTeam.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: {
          eventId: true,
          captainId: true,
          playerAUserId: true,
          playerBUserId: true,
        },
      }),
      this.prisma.trainingRevenueRecognition.findMany({
        where: { createdAt: { gte: start, lt: end } },
        select: {
          effectiveRevenueCents: true,
          venueContributionCents: true,
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
      }),
      this.prisma.trainingSession.findMany({
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
      }),
      this.prisma.trainingEnrollment.aggregate({
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
      }),
      this.prisma.trainingEnrollment.count({
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
      }),
      this.prisma.auditLog.count({
        where: {
          action: 'DIRECT_REFERRAL_BOUND',
          createdAt: { gte: start, lt: end },
        },
      }),
      this.prisma.referralReward.count({
        where: {
          createdAt: { gte: start, lt: end },
          status: { in: [RewardStatus.AVAILABLE, RewardStatus.GRANTED] },
        },
      }),
      this.prisma.accountTransaction.aggregate({
        where: {
          account: { type: AccountType.BADMINTON_COIN },
          kind: AccountTxnKind.CREDIT,
          createdAt: { gte: start, lt: end },
        },
        _sum: { amount: true },
      }),
      this.prisma.couponCode.count({
        where: { createdAt: { gte: start, lt: end } },
      }),
      this.prisma.couponCode.count({
        where: { claimedAt: { gte: start, lt: end } },
      }),
      this.prisma.couponCode.count({
        where: {
          status: CouponStatus.REDEEMED,
          redeemedAt: { gte: start, lt: end },
        },
      }),
      this.prisma.allianceSettlement.aggregate({
        where: { periodStart: { lt: end }, periodEnd: { gt: start } },
        _sum: {
          attributedGmvCents: true,
          attributedGrossProfitCents: true,
          cooperationFeeCents: true,
          issuedCount: true,
          claimedCount: true,
          redeemedCount: true,
          effectiveNewCustomers: true,
        },
      }),
      this.prisma.inventoryItem.findMany({
        where: { enabled: true },
        select: {
          stock: true,
          safeStock: true,
          purchasePriceCents: true,
        },
      }),
      this.prisma.inventoryTransaction.findMany({
        where: {
          OR: [
            {
              type: InventoryTxnType.SALE_OUT,
              orderItem: {
                order: {
                  businessType: BusinessType.GOODS,
                  completedAt: { gte: start, lt: end },
                },
              },
            },
            {
              type: InventoryTxnType.ADJUSTMENT,
              quantity: { gt: 0 },
              createdAt: { gte: start, lt: end },
              idempotencyKey: { startsWith: 'GOODS-REFUND:' },
              orderItem: { order: { businessType: BusinessType.GOODS } },
            },
          ],
        },
        select: { type: true, quantity: true, unitCostCents: true },
      }),
      this.prisma.trainingSettlement.findMany({
        where: { periodStart: { lt: end }, periodEnd: { gt: start } },
        orderBy: { periodEnd: 'desc' },
      }),
    ])

    const collectedOrdersByBusiness = byBusinessType(
      paidOrders.map((order) => ({
        businessType: order.businessType,
        amountCents: order.paidCents,
      })),
    )
    const collectedRefundsByBusiness = byBusinessType(
      completedRefunds.map((refund) => ({
        businessType: refund.order.businessType,
        amountCents: refund.amountCents,
      })),
    )
    const netCollectionsByBusiness = Object.fromEntries(
      Object.values(BusinessType).map((type) => [
        type,
        collectedOrdersByBusiness[type] - collectedRefundsByBusiness[type],
      ]),
    ) as Record<BusinessType, number>

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
    )
    const recognizedRefundsByBusiness = byBusinessType(
      completedRefunds
        .filter(
          (refund) =>
            refund.completedAt !== null &&
            refund.order.completedAt !== null &&
            refund.order.completedAt <= refund.completedAt &&
            venueBusinessTypes.includes(refund.order.businessType),
        )
        .map((refund) => ({
          businessType: refund.order.businessType,
          amountCents: refund.amountCents,
        })),
    )
    const realizedBusinessRevenue = Object.fromEntries(
      Object.values(BusinessType).map((type) => [
        type,
        recognizedOrdersByBusiness[type] - recognizedRefundsByBusiness[type],
      ]),
    ) as Record<BusinessType, number>

    const slots = timeSlots as SlotDefinition[]
    const businessDays = countShanghaiDays(start, end)
    const baselineHours = allocateIntervalHours(start, end, start, end, slots)
    for (const period of Object.values(SlotPeriod)) {
      baselineHours[period] *= courtCount
    }
    const closureHours = emptyPeriodHours()
    for (const closure of venueClosures) {
      addPeriodHours(
        closureHours,
        allocateIntervalHours(
          closure.startsAt,
          closure.endsAt,
          start,
          end,
          slots,
        ),
      )
    }
    const availableHours = emptyPeriodHours()
    for (const period of Object.values(SlotPeriod)) {
      availableHours[period] = nonnegative(
        baselineHours[period] - closureHours[period],
      )
    }
    const bookedHours = emptyPeriodHours()
    for (const booking of venueBookings) {
      addPeriodHours(
        bookedHours,
        allocateIntervalHours(
          booking.startsAt,
          booking.endsAt,
          start,
          end,
          slots,
        ),
      )
    }
    const totalAvailableCourtHours = sum(Object.values(availableHours))
    const totalBookedCourtHours = sum(Object.values(bookedHours))
    const daytimeAvailableCourtHours =
      availableHours[SlotPeriod.EARLY] + availableHours[SlotPeriod.DAYTIME]
    const daytimeBookedCourtHours =
      bookedHours[SlotPeriod.EARLY] + bookedHours[SlotPeriod.DAYTIME]
    const primeAvailableCourtHours = availableHours[SlotPeriod.PRIME]
    const primeBookedCourtHours = bookedHours[SlotPeriod.PRIME]

    const trainingRevenue = sum(
      trainingRecognitions.map((item) => item.effectiveRevenueCents),
    )
    const trainingVenueContribution = sum(
      trainingRecognitions.map((item) => item.venueContributionCents),
    )
    const trainingDirectCosts = sum(
      trainingSessions.map(
        (session) =>
          session.coachCostCents +
          session.assistantCostCents +
          session.materialCostCents,
      ),
    )
    const trainingCashContributionMargin = trainingRevenue - trainingDirectCosts
    const occupiedCourtHours = sum(
      trainingSessions.map((session) => Number(session.occupiedCourtHours)),
    )

    const coachOutputMap = new Map<
      string,
      {
        coachId: string | null
        classNames: Set<string>
        completedSessions: number
        confirmedRevenueCents: number
        directCostCents: number
      }
    >()
    const coachOutput = (coachId: string | null, className: string) => {
      const key = coachId ?? 'UNASSIGNED'
      const current = coachOutputMap.get(key) ?? {
        coachId,
        classNames: new Set<string>(),
        completedSessions: 0,
        confirmedRevenueCents: 0,
        directCostCents: 0,
      }
      current.classNames.add(className)
      coachOutputMap.set(key, current)
      return current
    }
    for (const session of trainingSessions) {
      const output = coachOutput(session.class.coachId, session.class.name)
      output.completedSessions += 1
      output.directCostCents +=
        session.coachCostCents +
        session.assistantCostCents +
        session.materialCostCents
    }
    for (const recognition of trainingRecognitions) {
      const trainingClass = recognition.attendance.session.class
      const output = coachOutput(trainingClass.coachId, trainingClass.name)
      output.confirmedRevenueCents += recognition.effectiveRevenueCents
    }

    const participantEvents = new Map<string, Set<string>>()
    for (const team of eventTeams) {
      const participantIds = new Set(
        [team.captainId, team.playerAUserId, team.playerBUserId].filter(
          (value): value is string => Boolean(value),
        ),
      )
      for (const participantId of participantIds) {
        const events = participantEvents.get(participantId) ?? new Set<string>()
        events.add(team.eventId)
        participantEvents.set(participantId, events)
      }
    }
    const repeatedEventParticipants = [...participantEvents.values()].filter(
      (events) => events.size >= 2,
    ).length
    const eventParticipantIds = [...participantEvents.keys()]
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
      : []
    const paidMemberParticipants = eventMemberProfiles.filter(
      (profile) => profile.subscriptions.length > 0,
    ).length

    const goodsCostCents = goodsCostTransactions.reduce(
      (total, transaction) =>
        total +
        (transaction.type === InventoryTxnType.SALE_OUT ? 1 : -1) *
          Math.abs(transaction.quantity) *
          (transaction.unitCostCents ?? 0),
      0,
    )
    const inventoryValueCents = inventoryItems.reduce(
      (total, item) => total + item.stock * item.purchasePriceCents,
      0,
    )
    const goodsRevenueCents = realizedBusinessRevenue[BusinessType.GOODS]
    const venueBusinessRevenueCents = venueBusinessTypes.reduce(
      (total, type) => total + realizedBusinessRevenue[type],
      0,
    )
    const realizedRevenueCents = venueBusinessRevenueCents + trainingRevenue
    const venueContractRevenueCents =
      venueBusinessRevenueCents + trainingVenueContribution
    const completedRefundCents = completedRefunds.reduce(
      (total, refund) => total + refund.amountCents,
      0,
    )
    const grossPaymentCents = sum(
      periodPayments.map((payment) => payment.amountCents),
    )
    const cashCollectedCents = sum(
      periodPayments
        .filter((payment) => cashPaymentChannels.includes(payment.channel))
        .map((payment) => payment.amountCents),
    )
    const cashRefundedCents = sum(
      completedRefunds
        .filter((refund) => {
          const channel = refund.order.payments[0]?.channel
          return channel !== undefined && cashPaymentChannels.includes(channel)
        })
        .map((refund) => refund.amountCents),
    )
    const sevenDayRepurchase = repurchaseWindow(
      repeatOrders,
      lookback7Start,
      end,
    )
    const thirtyDayRepurchase = repurchaseWindow(
      repeatOrders,
      lookback30Start,
      end,
    )
    const allianceGrossProfit =
      allianceSettlements._sum.attributedGrossProfitCents ?? 0
    const allianceFee = allianceSettlements._sum.cooperationFeeCents ?? 0

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
      venue: {
        courtCount,
        bookingCount: venueBookings.length,
        bookedCourtHours: totalBookedCourtHours,
        availableCourtHours: totalAvailableCourtHours,
        closureCourtHours: sum(Object.values(closureHours)),
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
    }
  }
}
