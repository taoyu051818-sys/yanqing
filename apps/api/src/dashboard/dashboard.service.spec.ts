import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import {
  BusinessType,
  PaymentChannel,
  SlotPeriod,
} from '../generated/prisma/enums.js'
import { DashboardService } from './dashboard.service.js'

const date = (iso: string) => new Date(iso)

const makePrisma = () => ({
  court: { count: vi.fn().mockResolvedValue(20) },
  timeSlot: {
    findMany: vi.fn().mockResolvedValue([
      { startMinutes: 9 * 60, endMinutes: 11 * 60, period: SlotPeriod.DAYTIME },
      { startMinutes: 19 * 60, endMinutes: 21 * 60, period: SlotPeriod.PRIME },
    ]),
  },
  courtBooking: {
    findMany: vi.fn().mockResolvedValue([
      {
        startsAt: date('2026-08-30T01:00:00.000Z'),
        endsAt: date('2026-08-30T03:00:00.000Z'),
      },
      {
        startsAt: date('2026-08-30T11:00:00.000Z'),
        endsAt: date('2026-08-30T13:00:00.000Z'),
      },
    ]),
  },
  courtClosure: { findMany: vi.fn().mockResolvedValue([]) },
  order: {
    findMany: vi
      .fn()
      .mockResolvedValueOnce([
        {
          businessType: BusinessType.VENUE,
          memberId: 'member-1',
          paidCents: 10_000,
          paidAt: date('2026-08-30T02:00:00.000Z'),
        },
        {
          businessType: BusinessType.GOODS,
          memberId: 'member-1',
          paidCents: 5_000,
          paidAt: date('2026-08-30T03:00:00.000Z'),
        },
        {
          businessType: BusinessType.EVENT,
          memberId: 'member-2',
          paidCents: 3_000,
          paidAt: date('2026-08-30T04:00:00.000Z'),
        },
        {
          businessType: BusinessType.TRAINING,
          memberId: 'member-3',
          paidCents: 12_000,
          paidAt: date('2026-08-30T05:00:00.000Z'),
        },
        {
          businessType: BusinessType.RECHARGE,
          memberId: 'member-3',
          paidCents: 20_000,
          paidAt: date('2026-08-30T06:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          businessType: BusinessType.VENUE,
          paidCents: 10_000,
          completedAt: date('2026-08-30T07:00:00.000Z'),
          refunds: [],
        },
        {
          businessType: BusinessType.GOODS,
          paidCents: 5_000,
          completedAt: date('2026-08-30T08:00:00.000Z'),
          refunds: [],
        },
        {
          businessType: BusinessType.EVENT,
          paidCents: 3_000,
          completedAt: date('2026-08-30T09:00:00.000Z'),
          refunds: [],
        },
      ])
      .mockResolvedValueOnce([
        { memberId: 'member-1', paidAt: date('2026-08-29T02:00:00.000Z') },
        { memberId: 'member-1', paidAt: date('2026-08-30T02:00:00.000Z') },
        { memberId: 'member-2', paidAt: date('2026-08-15T02:00:00.000Z') },
      ]),
  },
  refund: {
    findMany: vi.fn().mockResolvedValue([
      {
        amountCents: 2_000,
        completedAt: date('2026-08-30T10:00:00.000Z'),
        order: {
          businessType: BusinessType.TRAINING,
          completedAt: null,
          payments: [{ channel: PaymentChannel.WECHAT }],
        },
      },
      {
        amountCents: 1_000,
        completedAt: date('2026-08-30T10:00:00.000Z'),
        order: {
          businessType: BusinessType.GOODS,
          completedAt: date('2026-08-30T08:00:00.000Z'),
          payments: [{ channel: PaymentChannel.CASH_PRINCIPAL }],
        },
      },
    ]),
  },
  payment: {
    findMany: vi.fn().mockResolvedValue([
      { amountCents: 30_000, channel: PaymentChannel.WECHAT },
      { amountCents: 10_000, channel: PaymentChannel.OFFLINE_CASH },
      { amountCents: 10_000, channel: PaymentChannel.CASH_PRINCIPAL },
    ]),
  },
  memberProfile: {
    count: vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5),
    findMany: vi.fn().mockResolvedValue([
      { userId: 'member-1', subscriptions: [{ id: 'subscription-1' }] },
      { userId: 'member-2', subscriptions: [] },
    ]),
  },
  eventTeam: {
    findMany: vi.fn().mockResolvedValue([
      {
        eventId: 'event-1',
        captainId: 'member-1',
        playerAUserId: 'member-1',
        playerBUserId: 'member-2',
      },
      {
        eventId: 'event-2',
        captainId: 'member-1',
        playerAUserId: 'member-3',
        playerBUserId: null,
      },
    ]),
  },
  trainingRevenueRecognition: {
    findMany: vi.fn().mockResolvedValue([
      {
        effectiveRevenueCents: 10_000,
        venueContributionCents: 2_000,
        attendance: {
          session: { class: { coachId: 'coach-1', name: '成人班' } },
        },
      },
      {
        effectiveRevenueCents: -2_000,
        venueContributionCents: -400,
        attendance: {
          session: { class: { coachId: 'coach-1', name: '成人班' } },
        },
      },
    ]),
  },
  trainingSession: {
    findMany: vi.fn().mockResolvedValue([
      {
        coachCostCents: 3_000,
        assistantCostCents: 1_000,
        materialCostCents: 500,
        occupiedCourtHours: 2,
        class: { coachId: 'coach-1', name: '成人班' },
      },
    ]),
  },
  trainingEnrollment: {
    aggregate: vi.fn().mockResolvedValue({
      _sum: {
        prepaidBalanceCents: 60_000,
        confirmedRevenueCents: 40_000,
        refundedCents: 7_000,
      },
    }),
    count: vi.fn().mockResolvedValue(2),
  },
  referralReward: { count: vi.fn().mockResolvedValue(1) },
  accountTransaction: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 100 } }),
  },
  couponCode: {
    count: vi
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4),
  },
  allianceSettlement: {
    aggregate: vi.fn().mockResolvedValue({
      _sum: {
        attributedGmvCents: 20_000,
        attributedGrossProfitCents: 8_000,
        cooperationFeeCents: 2_000,
        issuedCount: 10,
        claimedCount: 5,
        redeemedCount: 4,
        effectiveNewCustomers: 3,
      },
    }),
  },
  inventoryItem: {
    findMany: vi.fn().mockResolvedValue([
      { stock: 8, safeStock: 10, purchasePriceCents: 1_000 },
      { stock: 20, safeStock: 5, purchasePriceCents: 500 },
    ]),
  },
  inventoryTransaction: {
    findMany: vi
      .fn()
      .mockResolvedValue([
        {
          type: 'SALE_OUT',
          quantity: -3,
          unitCostCents: 1_000,
        },
        {
          type: 'ADJUSTMENT',
          quantity: 1,
          unitCostCents: 1_000,
        },
      ]),
  },
  trainingSettlement: {
    findMany: vi.fn().mockResolvedValue([{ id: 'settlement-1', status: 'SETTLED' }]),
  },
})

describe('DashboardService', () => {
  it('separates cash collection, prepayment, recognised revenue and contract revenue', async () => {
    const prisma = makePrisma()
    const service = new DashboardService(prisma as never)

    const result = await service.overview(
      date('2026-08-29T16:00:00.000Z'),
      date('2026-08-30T16:00:00.000Z'),
    )

    expect(result.collections).toMatchObject({
      grossPaymentCents: 50_000,
      completedRefundCents: 3_000,
      netPaymentCents: 47_000,
      cashCollectedCents: 40_000,
      cashRefundedCents: 2_000,
      netCashCents: 38_000,
      rechargePrepaidCents: 20_000,
      trainingPrepaidCollectedCents: 10_000,
    })
    expect(result.revenue).toMatchObject({
      venueBusinessRevenueCents: 17_000,
      trainingConfirmedRevenueCents: 8_000,
      realizedRevenueCents: 25_000,
      venueContractRevenueCents: 18_600,
    })
    expect(result.revenue.byBusinessType).toMatchObject({
      [BusinessType.VENUE]: 10_000,
      [BusinessType.GOODS]: 4_000,
      [BusinessType.EVENT]: 3_000,
      [BusinessType.TRAINING]: 8_000,
      [BusinessType.RECHARGE]: 0,
    })
    expect(result.training).toMatchObject({
      prepaidCollectedCents: 10_000,
      confirmedRevenueCents: 8_000,
      unusedBalanceCents: 60_000,
      refundedCents: 2_000,
      cumulativeRefundedCents: 7_000,
      venueContributionCents: 1_600,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      directCostCents: 4_500,
      cashContributionMarginCents: 3_500,
      resourceEfficiencyCentsPerCourtHour: 1_750,
    })
    expect(prisma.order.findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        completedAt: {
          gte: date('2026-08-29T16:00:00.000Z'),
          lt: date('2026-08-30T16:00:00.000Z'),
        },
      },
    })
    expect(result.training.coachOutput).toEqual([
      expect.objectContaining({
        coachId: 'coach-1',
        completedSessions: 1,
        confirmedRevenueCents: 8_000,
        directCostCents: 4_500,
      }),
    ])
    expect(prisma.trainingEnrollment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: expect.arrayContaining(['REFUNDED']),
          },
        },
      }),
    )
    expect(prisma.memberProfile.count.mock.calls[3]?.[0]).toMatchObject({
      where: {
        OR: expect.arrayContaining([
          expect.objectContaining({ lastVisitAt: null }),
        ]),
      },
    })
  })

  it('calculates total/daytime/prime utilisation and RevPAH from court-hours', async () => {
    const prisma = makePrisma()
    const result = await new DashboardService(prisma as never).overview(
      date('2026-08-29T16:00:00.000Z'),
      date('2026-08-30T16:00:00.000Z'),
    )

    expect(result.venue).toMatchObject({
      courtCount: 20,
      bookingCount: 2,
      bookedCourtHours: 4,
      availableCourtHours: 80,
      utilizationRate: 5,
      daytimeUtilizationRate: 5,
      primeUtilizationRate: 5,
      revenueCents: 10_000,
      revpahCents: 125,
    })
    expect(result.members.sevenDayRepurchase).toEqual({
      purchaserCount: 1,
      repeatCustomerCount: 1,
      rate: 100,
    })
    expect(result.members.thirtyDayRepurchase).toEqual({
      purchaserCount: 2,
      repeatCustomerCount: 1,
      rate: 50,
    })
    expect(result.events).toMatchObject({
      participantCount: 3,
      repeatedParticipantCount: 1,
      repeatParticipationRate: 33.33,
      paidMemberParticipantCount: 1,
      paidMemberShareRate: 33.33,
    })
    expect(prisma.memberProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: { in: ['member-1', 'member-2', 'member-3'] } },
      }),
    )
    expect(result.goods).toMatchObject({
      revenueCents: 4_000,
      costCents: 2_000,
      grossProfitCents: 2_000,
      grossMarginRate: 50,
      lowStockCount: 1,
    })
    expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    )
  })

  it('clips available court-hours to an arbitrary partial-day range', async () => {
    const prisma = makePrisma()
    prisma.courtBooking.findMany.mockResolvedValue([
      {
        startsAt: date('2026-08-30T01:00:00.000Z'),
        endsAt: date('2026-08-30T03:00:00.000Z'),
      },
    ])
    prisma.courtClosure.findMany.mockResolvedValue([
      {
        startsAt: date('2026-08-30T01:45:00.000Z'),
        endsAt: date('2026-08-30T02:15:00.000Z'),
      },
    ])

    const result = await new DashboardService(prisma as never).overview(
      date('2026-08-30T01:30:00.000Z'),
      date('2026-08-30T02:30:00.000Z'),
    )

    expect(result.venue).toMatchObject({
      bookedCourtHours: 1,
      availableCourtHours: 19.5,
      closureCourtHours: 0.5,
      utilizationRate: 5.13,
      daytimeUtilizationRate: 5.13,
      primeUtilizationRate: 0,
    })
  })

  it('recognizes pre-fulfilment and same-instant refunds exactly once', async () => {
    const prisma = makePrisma()
    prisma.order.findMany
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          businessType: BusinessType.GOODS,
          paidCents: 10_000,
          completedAt: date('2026-08-30T10:00:00.000Z'),
          refunds: [
            {
              amountCents: 2_000,
              completedAt: date('2026-08-30T09:00:00.000Z'),
            },
            {
              amountCents: 1_000,
              completedAt: date('2026-08-30T10:00:00.000Z'),
            },
          ],
        },
      ])
      .mockResolvedValueOnce([])
    prisma.refund.findMany.mockResolvedValue([
      {
        amountCents: 2_000,
        completedAt: date('2026-08-30T09:00:00.000Z'),
        order: {
          businessType: BusinessType.GOODS,
          completedAt: date('2026-08-30T10:00:00.000Z'),
          payments: [],
        },
      },
      {
        amountCents: 1_000,
        completedAt: date('2026-08-30T10:00:00.000Z'),
        order: {
          businessType: BusinessType.GOODS,
          completedAt: date('2026-08-30T10:00:00.000Z'),
          payments: [],
        },
      },
    ])
    prisma.payment.findMany.mockResolvedValue([])
    prisma.inventoryTransaction.findMany.mockResolvedValue([])

    const result = await new DashboardService(prisma as never).overview(
      date('2026-08-29T16:00:00.000Z'),
      date('2026-08-30T16:00:00.000Z'),
    )

    expect(result.collections).toMatchObject({
      grossPaymentCents: 0,
      completedRefundCents: 3_000,
      netPaymentCents: -3_000,
    })
    expect(result.goods.revenueCents).toBe(7_000)
    expect(result.revenue.realizedRevenueCents).toBe(15_000)
  })

  it('rejects an invalid custom range before querying the database', async () => {
    const prisma = makePrisma()
    const service = new DashboardService(prisma as never)

    await expect(
      service.overview(
        date('2026-08-30T16:00:00.000Z'),
        date('2026-08-29T16:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.court.count).not.toHaveBeenCalled()
  })
})
