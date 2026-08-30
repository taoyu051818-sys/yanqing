import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  BusinessType,
  EventStatus,
  MatchStatus,
  OrderStatus,
  RegistrationStatus,
  TeamCategory,
} from '../generated/prisma/client.js'
import { EVENT_TOTAL_ROUNDS } from './events.dto.js'
import { EventsService } from './events.service.js'

const actor: AuthUser = {
  sub: 'event-manager-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
}

describe('EventsService order fulfilment', () => {
  it('completes checked-in orders, records paid no-shows and closes unpaid seats', async () => {
    const participantTeams = Array.from({ length: 12 }, (_, index) => ({
      id: `team-${index + 1}`,
      eventId: 'event-1',
      captainId: `player-${index * 2 + 1}`,
      playerAName: `队员${index * 2 + 1}`,
      playerBName: `队员${index * 2 + 2}`,
      playerAUserId: `player-${index * 2 + 1}`,
      playerBUserId: `player-${index * 2 + 2}`,
      category: TeamCategory.MEN_DOUBLES,
      seed: index + 1,
      status: RegistrationStatus.CHECKED_IN,
      points: 0,
      wins: 0,
      losses: 0,
      scoreDiff: 0,
      opponents: [],
      finalRank: null,
      eventPointsAwarded: null,
      orderId: index === 0 ? 'order-participant' : null,
      paymentDueAt: null,
      cancelledAt: null,
      order: index === 0
        ? {
            id: 'order-participant',
            status: OrderStatus.CHECKED_IN,
            completedAt: null,
            paidCents: 8_800,
            refundedCents: 0,
          }
        : null,
    }))
    const nonParticipants = [
      {
        ...participantTeams[0],
        id: 'team-no-show',
        captainId: 'no-show-captain',
        playerAUserId: 'no-show-a',
        playerBUserId: 'no-show-b',
        status: RegistrationStatus.PAID,
        orderId: 'order-no-show',
        order: {
          id: 'order-no-show',
          status: OrderStatus.PAID,
          completedAt: null,
          paidCents: 8_800,
          refundedCents: 0,
        },
      },
      {
        ...participantTeams[1],
        id: 'team-unpaid',
        status: RegistrationStatus.REGISTERED,
        orderId: 'order-unpaid',
        paymentDueAt: new Date('2026-08-30T08:00:00.000Z'),
        order: {
          id: 'order-unpaid',
          status: OrderStatus.PENDING,
          completedAt: null,
          paidCents: 0,
          refundedCents: 0,
        },
      },
      {
        ...participantTeams[2],
        id: 'team-waitlisted',
        status: RegistrationStatus.WAITLISTED,
        orderId: null,
        order: null,
      },
    ]
    const teams = [...participantTeams, ...nonParticipants]
    const matches = Array.from({ length: EVENT_TOTAL_ROUNDS }, (_, roundIndex) =>
      Array.from({ length: participantTeams.length / 2 }, (_, pairIndex) => ({
        id: `match-${roundIndex + 1}-${pairIndex + 1}`,
        eventId: 'event-1',
        round: roundIndex + 1,
        courtLabel: `${pairIndex + 1}号场`,
        teamAId: participantTeams[pairIndex * 2].id,
        teamBId: participantTeams[pairIndex * 2 + 1].id,
        startingScoreA: 0,
        startingScoreB: 0,
        scoreA: 21,
        scoreB: 0,
        status: MatchStatus.CONFIRMED,
      })),
    ).flat()
    const orders = new Map([
      ['order-participant', {
        id: 'order-participant',
        businessType: BusinessType.EVENT,
        status: OrderStatus.CHECKED_IN,
        completedAt: null as Date | null,
        paidCents: 8_800,
        refundedCents: 0,
      }],
      ['order-no-show', {
        id: 'order-no-show',
        businessType: BusinessType.EVENT,
        status: OrderStatus.PAID,
        completedAt: null as Date | null,
        paidCents: 8_800,
        refundedCents: 0,
      }],
      ['order-unpaid', {
        id: 'order-unpaid',
        businessType: BusinessType.EVENT,
        status: OrderStatus.PENDING,
        completedAt: null as Date | null,
        paidCents: 0,
        refundedCents: 0,
      }],
    ])
    const accountBalances = new Map<string, number>()
    const awardKeys = new Set<string>()
    const auditLogCreate = vi.fn().mockResolvedValue({})
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'event-1',
          code: 'EVENT-1',
          name: '周末积分赛',
          status: EventStatus.IN_PROGRESS,
          startsAt: new Date('2026-08-30T10:00:00.000Z'),
          registrationEndsAt: new Date('2026-08-30T09:00:00.000Z'),
          capacityPeople: 48,
          minimumPeople: 24,
          totalRounds: EVENT_TOTAL_ROUNDS,
          currentRound: EVENT_TOTAL_ROUNDS,
          feeCents: 8_800,
          memberFeeCents: null,
          rules: [],
          teams,
          matches,
        }),
        update: vi.fn().mockResolvedValue({
          id: 'event-1',
          status: EventStatus.COMPLETED,
        }),
      },
      eventTeam: {
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const team = teams.find((candidate) => candidate.id === where.id)
          if (team) Object.assign(team, data)
          return team
        }),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          const team = teams.find((candidate) => candidate.id === where.id)
          if (!team || team.status !== where.status) return { count: 0 }
          Object.assign(team, data)
          return { count: 1 }
        }),
      },
      order: {
        findUnique: vi.fn().mockImplementation(async ({ where }) => orders.get(where.id) ?? null),
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          const order = orders.get(where.id)
          if (!order || (where.status && order.status !== where.status)) return { count: 0 }
          if (where.completedAt === null && order.completedAt !== null) return { count: 0 }
          Object.assign(order, data)
          return { count: 1 }
        }),
      },
      payment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      account: {
        upsert: vi.fn().mockImplementation(async ({ where }) => ({
          id: `account-${where.userId_type.userId}`,
          balance: accountBalances.get(where.userId_type.userId) ?? 0,
        })),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const userId = String(where.id).replace('account-', '')
          accountBalances.set(
            userId,
            (accountBalances.get(userId) ?? 0) + data.balance.increment,
          )
          return { id: where.id }
        }),
      },
      accountTransaction: {
        findUnique: vi.fn().mockImplementation(async ({ where }) =>
          awardKeys.has(where.idempotencyKey) ? { idempotencyKey: where.idempotencyKey } : null,
        ),
        create: vi.fn().mockImplementation(async ({ data }) => {
          awardKeys.add(data.idempotencyKey)
          return data
        }),
      },
      auditLog: { create: auditLogCreate },
    }
    const prisma = {
      $transaction: vi.fn(async (work) => work(tx)),
    }
    const service = new EventsService(prisma as never)

    await service.finish('event-1', actor)

    expect(orders.get('order-participant')).toMatchObject({
      status: OrderStatus.COMPLETED,
      completedAt: expect.any(Date),
    })
    expect(orders.get('order-no-show')).toMatchObject({
      status: OrderStatus.COMPLETED,
      completedAt: expect.any(Date),
    })
    expect(orders.get('order-unpaid')).toMatchObject({
      status: OrderStatus.CANCELLED,
    })
    expect(teams.find((team) => team.id === 'team-no-show')).toMatchObject({
      status: RegistrationStatus.NO_SHOW,
    })
    expect(teams.find((team) => team.id === 'team-unpaid')).toMatchObject({
      status: RegistrationStatus.CANCELLED,
    })
    expect(teams.find((team) => team.id === 'team-waitlisted')).toMatchObject({
      status: RegistrationStatus.CANCELLED,
    })
    expect(auditLogCreate.mock.calls.filter(
      ([call]) => call.data.action === 'ORDER_COMPLETED',
    )).toHaveLength(2)
  })
})
