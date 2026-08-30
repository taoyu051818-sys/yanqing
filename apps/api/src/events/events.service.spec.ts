import { describe, expect, it, vi } from 'vitest'

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  EventStatus,
  MatchStatus,
  RegistrationStatus,
  SourceChannel,
  TeamCategory,
} from '../generated/prisma/enums.js'
import type {
  CreateEventDto,
  RegisterEventTeamDto,
  SubmitScoreDto,
} from './events.dto.js'
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js'
import {
  EVENT_MAX_CAPACITY_PEOPLE,
  EVENT_MINIMUM_PEOPLE,
  EVENT_TOTAL_ROUNDS,
} from './events.dto.js'
import { EventsService } from './events.service.js'

const actor: AuthUser = {
  sub: 'operator-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
}

const validCreateDto = (overrides: Partial<CreateEventDto> = {}): CreateEventDto => ({
  code: 'SWISS-2026-01',
  name: '周末瑞士积分赛',
  startsAt: '2099-08-30T10:00:00.000Z',
  registrationEndsAt: '2099-08-30T09:00:00.000Z',
  capacityPeople: EVENT_MAX_CAPACITY_PEOPLE,
  minimumPeople: EVENT_MINIMUM_PEOPLE,
  totalRounds: EVENT_TOTAL_ROUNDS,
  feeCents: 8_800,
  ...overrides,
})

const validRegisterDto = (
  overrides: Partial<RegisterEventTeamDto> = {},
): RegisterEventTeamDto => ({
  name: '一队',
  playerAName: '甲',
  playerBName: '乙',
  playerAUserId: 'player-a',
  playerBUserId: 'player-b',
  category: TeamCategory.MEN_DOUBLES,
  sourceChannel: SourceChannel.MINI_PROGRAM,
  ...overrides,
})

const validStoredEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  code: 'SWISS-2026-01',
  name: '周末瑞士积分赛',
  status: EventStatus.OPEN,
  startsAt: new Date('2099-08-30T10:00:00.000Z'),
  registrationEndsAt: new Date('2099-08-30T09:00:00.000Z'),
  capacityPeople: EVENT_MAX_CAPACITY_PEOPLE,
  minimumPeople: EVENT_MINIMUM_PEOPLE,
  totalRounds: EVENT_TOTAL_ROUNDS,
  currentRound: 0,
  feeCents: 8_800,
  memberFeeCents: null,
  rules: [],
  ...overrides,
})

const txRunner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

describe('EventsService tournament invariants', () => {
  describe('event configuration', () => {
    it.each([
      ['totalRounds', 4, '赛事必须固定为5轮瑞士制'],
      ['minimumPeople', 22, '24人'],
      ['capacityPeople', 23, '双数'],
      ['capacityPeople', 50, '24-48'],
    ])('rejects an invalid %s (%s)', async (field, value, message) => {
      const eventCreate = vi.fn()
      const service = new EventsService({ event: { create: eventCreate } } as never)

      expect(() =>
        service.create(validCreateDto({ [field]: value } as Partial<CreateEventDto>), actor),
      ).toThrow(BadRequestException)
      expect(() =>
        service.create(validCreateDto({ [field]: value } as Partial<CreateEventDto>), actor),
      ).toThrow(message)
      expect(eventCreate).not.toHaveBeenCalled()
    })

    it('accepts only the locked 24-48 people range and five rounds', async () => {
      const eventCreate = vi.fn().mockResolvedValue({ id: 'event-1' })
      const tx = {
        event: { create: eventCreate },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      const service = new EventsService({ $transaction: txRunner(tx) } as never)

      await service.create(validCreateDto({ capacityPeople: 24 }), actor)
      await service.create(validCreateDto({ capacityPeople: 48 }), actor)

      expect(eventCreate).toHaveBeenCalledTimes(2)
      expect(eventCreate.mock.calls[0][0].data).toMatchObject({
        capacityPeople: 24,
        minimumPeople: 24,
        totalRounds: 5,
      })
      expect(eventCreate.mock.calls[1][0].data).toMatchObject({
        capacityPeople: 48,
        minimumPeople: 24,
        totalRounds: 5,
      })
    })

    it('rejects a draft whose registration or start time has already passed', () => {
      const service = new EventsService({} as never)
      expect(() => service.create(validCreateDto({
        startsAt: '2020-08-30T10:00:00.000Z',
        registrationEndsAt: '2020-08-30T09:00:00.000Z',
      }), actor)).toThrow('赛事开始时间必须晚于当前时间')
    })

    it('rejects a stored event whose locked configuration was corrupted', async () => {
      const eventFind = vi.fn().mockResolvedValue(
        validStoredEvent({ totalRounds: 4 }),
      )
      const tx = {
        event: { findUnique: eventFind },
      }
      const service = new EventsService({ $transaction: txRunner(tx) } as never)

      await expect(service.startNextRound('event-1', actor)).rejects.toThrow(
        '赛事必须固定为5轮瑞士制',
      )
    })
  })

  describe('fixed doubles registration', () => {
    it.each([
      ['missing second player', { playerBName: '' }, '必须填写两名队员'],
      ['same player names', { playerBName: '甲' }, '两名队员不能相同'],
      [
        'same player accounts',
        { playerBName: '丙', playerBUserId: 'player-a' },
        '两名账号不能相同',
      ],
    ])('rejects %s before touching persistence', async (_caseName, overrides, message) => {
      const eventFind = vi.fn()
      const service = new EventsService({ event: { findUnique: eventFind } } as never)

      await expect(
        service.register('event-1', validRegisterDto(overrides), actor),
      ).rejects.toThrow(message)
      expect(eventFind).not.toHaveBeenCalled()
    })

    it('rejects an account that already belongs to another team in the same event', async () => {
      const duplicateTeam = { id: 'existing-team' }
      const tx = {
        eventTeam: {
          // The first lookup protects the captain; the second lookup checks
          // every explicitly supplied participant account.
          findFirst: vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(duplicateTeam),
          count: vi.fn(),
        },
      }
      const prisma = {
        event: {
          findUnique: vi.fn().mockResolvedValue({
            ...validStoredEvent(),
            _count: { teams: 1 },
          }),
        },
        memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: txRunner(tx),
      }
      const service = new EventsService(prisma as never)

      await expect(
        service.register(
          'event-1',
          validRegisterDto({
            playerAUserId: 'already-in-event',
            playerBUserId: 'new-player',
          }),
          actor,
        ),
      ).rejects.toThrow('同一账号不能参加同一赛事的多个固定双打队伍')
      expect(tx.eventTeam.findFirst).toHaveBeenCalledTimes(2)
    })

    it('records the registering captain as both order owner and creator', async () => {
      const createdOrder = { id: 'event-order-1', eventTeam: { id: 'team-1' } }
      const tx = {
        eventTeam: {
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
        order: { create: vi.fn().mockResolvedValue(createdOrder) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      const prisma = {
        event: {
          findUnique: vi.fn().mockResolvedValue({
            ...validStoredEvent(),
            _count: { teams: 0 },
          }),
        },
        memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: txRunner(tx),
      }

      await expect(new EventsService(prisma as never).register(
        'event-1',
        validRegisterDto(),
        actor,
      )).resolves.toBe(createdOrder)

      expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ memberId: actor.sub, createdById: actor.sub }),
      }))
      expect(tx.auditLog.create).toHaveBeenCalledOnce()
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'EVENT_ORDER_CREATED',
          objectType: 'Order',
          objectId: createdOrder.id,
          newValue: expect.objectContaining({
            memberId: actor.sub,
            createdById: actor.sub,
            amountCents: 8_800,
            creationIdempotencyKeyPresent: false,
            eventId: 'event-1',
            eventTeamId: 'team-1',
            category: TeamCategory.MEN_DOUBLES,
          }),
        }),
      })
    })

    it('replays a keyed event order without opening a transaction or duplicating its audit', async () => {
      const dto = validRegisterDto({ creationIdempotencyKey: 'event-order-replay-key-1' })
      const existing = {
        id: 'event-order-existing',
        memberId: actor.sub,
        creationCommandHash: orderCreationCommandHash({
          kind: 'EVENT_REGISTRATION',
          eventId: 'event-1',
          name: dto.name,
          playerAName: dto.playerAName,
          playerBName: dto.playerBName,
          playerAUserId: dto.playerAUserId ?? null,
          playerBUserId: dto.playerBUserId ?? null,
          category: dto.category,
          sourceChannel: dto.sourceChannel,
        }),
      }
      const auditCreate = vi.fn()
      const transaction = vi.fn(async (work: (tx: Record<string, unknown>) => unknown) =>
        work({ auditLog: { create: auditCreate } }))
      const service = new EventsService({
        order: {
          findUnique: vi.fn().mockResolvedValue(existing),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ ...existing, eventTeam: { id: 'team-1' } }),
        },
        $transaction: transaction,
      } as never)

      await expect(service.register('event-1', dto, actor)).resolves.toMatchObject({ id: existing.id })
      expect(transaction).not.toHaveBeenCalled()
      expect(auditCreate).not.toHaveBeenCalled()
    })
  })

  describe('score and handicap rules', () => {
    const scoreMatch = (overrides: Record<string, unknown> = {}) => ({
      id: 'match-1',
      eventId: 'event-1',
      round: 1,
      teamAId: 'team-a',
      teamBId: 'team-b',
      startingScoreA: 0,
      startingScoreB: 5,
      scoreA: null,
      scoreB: null,
      status: MatchStatus.PENDING,
      ...overrides,
    })

    const scorePrisma = (match: Record<string, unknown>) => {
      const updatedMatch = { ...match }
      const tx = {
        eventMatch: {
          findUnique: vi.fn().mockResolvedValue(match),
          update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            Object.assign(updatedMatch, data)
            return Promise.resolve(updatedMatch)
          }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(updatedMatch),
        },
        eventTeam: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      return { prisma: { $transaction: txRunner(tx) }, tx, updatedMatch }
    }

    it('accepts a 21-point game at the opponent handicap floor', async () => {
      const { prisma, tx, updatedMatch } = scorePrisma(scoreMatch())
      const service = new EventsService(prisma as never)

      await service.submitScore('match-1', { scoreA: 21, scoreB: 5 }, actor)

      expect(updatedMatch).toMatchObject({
        scoreA: 21,
        scoreB: 5,
        status: MatchStatus.CONFIRMED,
      })
      expect(tx.eventTeam.update).toHaveBeenCalledTimes(2)
      expect(tx.auditLog.create).toHaveBeenCalledOnce()
    })

    it.each([
      [{ scoreA: 21, scoreB: 4 }, 'starting score'],
      [{ scoreA: 22, scoreB: 5 }, 'between its starting score and 21'],
      [{ scoreA: 20, scoreB: 5 }, 'exactly 21'],
      [{ scoreA: 21, scoreB: 21 }, 'tie'],
    ])('rejects an invalid 21-point/handicap score %#', async (dto, message) => {
      const { prisma, tx } = scorePrisma(scoreMatch())
      const service = new EventsService(prisma as never)

      await expect(
        service.submitScore('match-1', dto as SubmitScoreDto, actor),
      ).rejects.toThrow(message)
      expect(tx.eventMatch.update).not.toHaveBeenCalled()
      expect(tx.eventTeam.update).not.toHaveBeenCalled()
    })

    it('rejects score submission after a match is already confirmed', async () => {
      const { prisma, tx } = scorePrisma(
        scoreMatch({ status: MatchStatus.CONFIRMED, scoreA: 21, scoreB: 5 }),
      )
      const service = new EventsService(prisma as never)

      await expect(
        service.submitScore('match-1', { scoreA: 21, scoreB: 5 }, actor),
      ).rejects.toBeInstanceOf(ConflictException)
      expect(tx.eventMatch.update).not.toHaveBeenCalled()
    })

    it('rejects score submission when the match does not exist', async () => {
      const { prisma, tx } = scorePrisma(scoreMatch())
      tx.eventMatch.findUnique.mockResolvedValue(null)
      const service = new EventsService(prisma as never)

      await expect(
        service.submitScore('missing-match', { scoreA: 21, scoreB: 5 }, actor),
      ).rejects.toBeInstanceOf(NotFoundException)
    })

    /**
     * A small in-memory transaction double that models the database's
     * compare-and-set predicate.  It intentionally returns a stale snapshot
     * from findUnique when two callers are released at the same time, then
     * makes the second update fail with Prisma's record-not-found code after
     * the first caller has moved the match to CONFIRMED.
     */
    const concurrentScorePrisma = (synchroniseReads = false) => {
      const match = scoreMatch()
      const teams = new Map([
        ['team-a', { points: 0, wins: 0, losses: 0, scoreDiff: 0, opponents: [] as string[] }],
        ['team-b', { points: 0, wins: 0, losses: 0, scoreDiff: 0, opponents: [] as string[] }],
      ])
      const audits: Record<string, unknown>[] = []
      let reads = 0
      let releaseRead!: () => void
      const readBarrier = new Promise<void>((resolve) => {
        releaseRead = resolve
      })

      const tx = {
        eventMatch: {
          findUnique: vi.fn(async () => {
            reads += 1
            if (synchroniseReads) {
              if (reads === 2) releaseRead()
              if (reads <= 2) await readBarrier
            }
            return { ...match }
          }),
          update: vi.fn(async ({
            where,
            data,
          }: {
            where: { id: string; status?: { in?: MatchStatus[] } }
            data: Record<string, unknown>
          }) => {
            const acceptedStatuses = where.status?.in
            if (
              where.id !== match.id ||
              (acceptedStatuses && !acceptedStatuses.includes(match.status as MatchStatus))
            ) {
              throw { code: 'P2025' }
            }
            Object.assign(match, data)
            return { ...match }
          }),
          findUniqueOrThrow: vi.fn(async () => ({ ...match })),
        },
        eventTeam: {
          update: vi.fn(async ({
            where,
            data,
          }: {
            where: { id: string }
            data: Record<string, { increment?: number; push?: string }>
          }) => {
            const team = teams.get(where.id)
            if (!team) throw new Error(`missing team ${where.id}`)
            for (const field of ['points', 'wins', 'losses', 'scoreDiff'] as const) {
              const increment = data[field]?.increment
              if (typeof increment === 'number') team[field] += increment
            }
            const opponent = data.opponents?.push
            if (typeof opponent === 'string') team.opponents.push(opponent)
            return team
          }),
        },
        auditLog: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            audits.push(data)
            return data
          }),
        },
      }
      return {
        prisma: { $transaction: txRunner(tx) },
        tx,
        match,
        teams,
        audits,
        releaseRead,
      }
    }

    it('is idempotent for a sequential duplicate: only one standings/audit write', async () => {
      const { prisma, tx, match, teams, audits } = concurrentScorePrisma()
      const service = new EventsService(prisma as never)
      const dto: SubmitScoreDto = { scoreA: 21, scoreB: 5 }

      await service.submitScore('match-1', dto, actor)
      await expect(service.submitScore('match-1', dto, actor)).rejects.toBeInstanceOf(
        ConflictException,
      )

      expect(match.status).toBe(MatchStatus.CONFIRMED)
      expect(teams.get('team-a')).toMatchObject({
        points: 1,
        wins: 1,
        losses: 0,
        scoreDiff: 16,
        opponents: ['team-b'],
      })
      expect(teams.get('team-b')).toMatchObject({
        points: 0,
        wins: 0,
        losses: 1,
        scoreDiff: -16,
        opponents: ['team-a'],
      })
      expect(tx.eventTeam.update).toHaveBeenCalledTimes(2)
      expect(tx.auditLog.create).toHaveBeenCalledOnce()
      expect(audits).toHaveLength(1)
    })

    it('serializes concurrent submissions and maps the losing CAS to a conflict', async () => {
      const { prisma, tx, match, teams, audits, releaseRead } = concurrentScorePrisma(true)
      const service = new EventsService(prisma as never)
      const dto: SubmitScoreDto = { scoreA: 21, scoreB: 5 }

      const results = await Promise.allSettled([
        service.submitScore('match-1', dto, actor),
        service.submitScore('match-1', dto, actor),
      ].map((submission) => submission.then((value) => value)))

      // The barrier is released by the second read.  Keeping this assertion
      // here catches a broken test double that accidentally exercised only a
      // sequential path.
      expect(tx.eventMatch.findUnique).toHaveBeenCalledTimes(2)
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected')
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
        ConflictException,
      )
      expect(match.status).toBe(MatchStatus.CONFIRMED)
      expect(teams.get('team-a')?.opponents).toEqual(['team-b'])
      expect(teams.get('team-b')?.opponents).toEqual(['team-a'])
      expect(teams.get('team-a')?.points).toBe(1)
      expect(teams.get('team-b')?.losses).toBe(1)
      expect(tx.eventTeam.update).toHaveBeenCalledTimes(2)
      expect(tx.auditLog.create).toHaveBeenCalledOnce()
      expect(audits).toHaveLength(1)
      // Keep the release function live in this test's closure so TypeScript
      // does not narrow it away before the asynchronous reads execute.
      expect(releaseRead).toBeTypeOf('function')
      void releaseRead
    })

    it('maps a serializable transaction abort to a retryable conflict', async () => {
      const transaction = vi.fn().mockRejectedValue({ code: 'P2034' })
      const service = new EventsService({ $transaction: transaction } as never)

      await expect(
        service.submitScore('match-1', { scoreA: 21, scoreB: 5 }, actor),
      ).rejects.toBeInstanceOf(ConflictException)
    })
  })

  describe('event state gates and finish idempotency', () => {
    it.each([EventStatus.DRAFT, EventStatus.CANCELLED, EventStatus.COMPLETED])(
      'does not generate pairings from %s event',
      async (status) => {
        const tx = {
          event: { findUnique: vi.fn().mockResolvedValue(validStoredEvent({ status })) },
          eventMatch: { create: vi.fn() },
          eventTeam: { update: vi.fn() },
          auditLog: { create: vi.fn() },
        }
        const service = new EventsService({ $transaction: txRunner(tx) } as never)

        await expect(service.startNextRound('event-1', actor)).rejects.toBeInstanceOf(
          ConflictException,
        )
        expect(tx.eventMatch.create).not.toHaveBeenCalled()
      },
    )

    it.each([EventStatus.DRAFT, EventStatus.CANCELLED])(
      'does not finish a %s event',
      async (status) => {
        const tx = {
          event: {
            findUnique: vi.fn().mockResolvedValue(
              validStoredEvent({ status, teams: [], matches: [] }),
            ),
          },
          eventTeam: { update: vi.fn() },
        }
        const service = new EventsService({ $transaction: txRunner(tx) } as never)

        await expect(service.finish('event-1', actor)).rejects.toBeInstanceOf(
          ConflictException,
        )
        expect(tx.eventTeam.update).not.toHaveBeenCalled()
      },
    )

    it('awards event points once when finish is retried', async () => {
      const teams = Array.from({ length: 12 }, (_, index) => ({
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
      }))
      const matches = Array.from({ length: EVENT_TOTAL_ROUNDS }, (_, roundIndex) =>
        Array.from({ length: teams.length / 2 }, (_, pairIndex) => ({
          id: `match-${roundIndex + 1}-${pairIndex + 1}`,
          eventId: 'event-1',
          round: roundIndex + 1,
          courtLabel: `${pairIndex + 1}号场`,
          teamAId: teams[pairIndex * 2].id,
          teamBId: teams[pairIndex * 2 + 1].id,
          startingScoreA: 0,
          startingScoreB: 0,
          scoreA: 21,
          scoreB: 0,
          status: MatchStatus.CONFIRMED,
        })),
      ).flat()

      let eventStatus = EventStatus.IN_PROGRESS
      const awards = new Map<string, Record<string, unknown>>()
      const accounts = new Map<string, { id: string; userId: string; balance: number }>()
      const tx = {
        event: {
          findUnique: vi.fn().mockImplementation(async () => ({
            ...validStoredEvent({
              status: eventStatus,
              currentRound: EVENT_TOTAL_ROUNDS,
            }),
            teams,
            matches,
          })),
          update: vi.fn().mockImplementation(async () => {
            eventStatus = EventStatus.COMPLETED
            return { id: 'event-1', status: eventStatus }
          }),
        },
        eventTeam: {
          update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const team = teams.find((item) => item.id === where.id)
            if (team) Object.assign(team, data)
            return team
          }),
        },
        account: {
          upsert: vi.fn().mockImplementation(async ({ where, create: _create }: { where: { userId_type: { userId: string } }; create: { userId: string } }) => {
            const userId = where.userId_type.userId
            const account = accounts.get(userId) ?? {
              id: `account-${userId}`,
              userId,
              balance: 0,
            }
            accounts.set(userId, account)
            return account
          }),
          update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: { balance: { increment: number } } }) => {
            const account = [...accounts.values()].find((item) => item.id === where.id)
            if (account) account.balance += data.balance.increment
            return account
          }),
        },
        accountTransaction: {
          findUnique: vi.fn().mockImplementation(async ({ where }: { where: { idempotencyKey: string } }) => awards.get(where.idempotencyKey) ?? null),
          create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            awards.set(String(data.idempotencyKey), data)
            return data
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      const service = new EventsService({ $transaction: txRunner(tx) } as never)

      const first = await service.finish('event-1', actor)
      const createsAfterFirstFinish = tx.accountTransaction.create.mock.calls.length
      const second = await service.finish('event-1', actor)

      expect(first).toHaveLength(teams.length)
      expect(second).toHaveLength(teams.length)
      expect(createsAfterFirstFinish).toBe(teams.length * 2)
      expect(tx.accountTransaction.create).toHaveBeenCalledTimes(createsAfterFirstFinish)
      expect(tx.accountTransaction.findUnique).toHaveBeenCalledTimes(createsAfterFirstFinish)
      expect(tx.event.update).toHaveBeenCalledOnce()
      expect(tx.auditLog.create).toHaveBeenCalledOnce()
    })
  })
})
