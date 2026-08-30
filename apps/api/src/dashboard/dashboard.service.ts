import { Injectable } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service.js'
import {
  BookingStatus,
  BusinessType,
  CouponStatus,
  OrderStatus,
  TrainingSessionStatus,
} from '../generated/prisma/enums.js'

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

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(periodStart?: Date, periodEnd?: Date) {
    const today = shanghaiDay()
    const start = periodStart ?? today.start
    const end = periodEnd ?? today.end
    const activeOrderStatuses = [
      OrderStatus.PAID,
      OrderStatus.CHECKED_IN,
      OrderStatus.COMPLETED,
      OrderStatus.PARTIALLY_REFUNDED,
    ]
    const [
      courtCount,
      slotCount,
      venueBookings,
      venueRevenue,
      newMembers,
      eventTeams,
      trainingRecognitions,
      trainingSessions,
      referralNewCustomers,
      allianceRedeemed,
      allianceSettlements,
      goodsRevenue,
      lowStock,
      trainingSettlements,
    ] = await Promise.all([
      this.prisma.court.count({ where: { enabled: true } }),
      this.prisma.timeSlot.count({ where: { enabled: true } }),
      this.prisma.courtBooking.count({
        where: { startsAt: { gte: start, lt: end }, status: { not: BookingStatus.CANCELLED } },
      }),
      this.prisma.order.aggregate({
        where: {
          businessType: BusinessType.VENUE,
          status: { in: activeOrderStatuses },
          paidAt: { gte: start, lt: end },
        },
        _sum: { paidCents: true, refundedCents: true },
      }),
      this.prisma.memberProfile.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.eventTeam.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.trainingRevenueRecognition.aggregate({
        where: { createdAt: { gte: start, lt: end } },
        _sum: { effectiveRevenueCents: true, venueContributionCents: true },
      }),
      this.prisma.trainingSession.aggregate({
        where: {
          status: TrainingSessionStatus.COMPLETED,
          startsAt: { gte: start, lt: end },
        },
        _sum: {
          coachCostCents: true,
          assistantCostCents: true,
          materialCostCents: true,
          occupiedCourtHours: true,
        },
      }),
      this.prisma.referralReward.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.couponCode.count({
        where: { status: CouponStatus.REDEEMED, redeemedAt: { gte: start, lt: end } },
      }),
      this.prisma.allianceSettlement.aggregate({
        where: { periodStart: { gte: start }, periodEnd: { lte: end } },
        _sum: { attributedGmvCents: true, cooperationFeeCents: true },
      }),
      this.prisma.order.aggregate({
        where: {
          businessType: BusinessType.GOODS,
          status: { in: activeOrderStatuses },
          paidAt: { gte: start, lt: end },
        },
        _sum: { paidCents: true, refundedCents: true },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "InventoryItem" WHERE enabled = true AND stock <= "safeStock"`,
      this.prisma.trainingSettlement.findMany({
        where: { periodStart: { gte: start }, periodEnd: { lte: end } },
        orderBy: { periodEnd: 'desc' },
      }),
    ])
    const availableSlots = Math.max(1, courtCount * slotCount)
    const trainingRevenue = trainingRecognitions._sum.effectiveRevenueCents ?? 0
    const trainingDirectCosts =
      (trainingSessions._sum.coachCostCents ?? 0) +
      (trainingSessions._sum.assistantCostCents ?? 0) +
      (trainingSessions._sum.materialCostCents ?? 0)

    return {
      period: { start, end },
      venue: {
        courtCount,
        bookingCount: venueBookings,
        utilizationRate: Math.round((venueBookings / availableSlots) * 10_000) / 100,
        revenueCents:
          (venueRevenue._sum.paidCents ?? 0) - (venueRevenue._sum.refundedCents ?? 0),
      },
      members: { newMembers },
      events: { registrations: eventTeams },
      training: {
        confirmedRevenueCents: trainingRevenue,
        venueContributionCents: trainingRecognitions._sum.venueContributionCents ?? 0,
        venueFeeCents: 0,
        directCostCents: trainingDirectCosts,
        cashContributionMarginCents: trainingRevenue - trainingDirectCosts,
        occupiedCourtHours: Number(trainingSessions._sum.occupiedCourtHours ?? 0),
      },
      marketing: { directReferralConversions: referralNewCustomers },
      alliance: {
        redeemed: allianceRedeemed,
        attributedGmvCents: allianceSettlements._sum.attributedGmvCents ?? 0,
        cooperationFeeCents: allianceSettlements._sum.cooperationFeeCents ?? 0,
      },
      goods: {
        revenueCents: (goodsRevenue._sum.paidCents ?? 0) - (goodsRevenue._sum.refundedCents ?? 0),
        lowStockCount: Number(lowStock[0]?.count ?? 0),
      },
      contractSettlements: trainingSettlements,
    }
  }
}
