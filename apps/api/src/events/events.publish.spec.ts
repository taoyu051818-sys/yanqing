import { describe, expect, it, vi } from 'vitest'

import { ConflictException, NotFoundException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, EventStatus, TeamCategory } from '../generated/prisma/enums.js'
import type {
  CreateEventDto,
  PublishEventDto,
  RegisterEventTeamDto,
} from './events.dto.js'
import {
  EVENT_MAX_CAPACITY_PEOPLE,
  EVENT_MINIMUM_PEOPLE,
  EVENT_TOTAL_ROUNDS,
} from './events.dto.js'
import { EventsService } from './events.service.js'

const actor: AuthUser = {
  sub: 'reviewer-1',
  displayName: '赛事审核员',
  roles: [AppRole.ADMIN],
}

const txRunner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

const draftEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-draft-1',
  code: 'SWISS-DRAFT-01',
  name: '待审核周末赛',
  status: EventStatus.DRAFT,
  startsAt: new Date('2099-08-30T10:00:00.000Z'),
  registrationEndsAt: new Date('2099-08-30T09:00:00.000Z'),
  capacityPeople: EVENT_MAX_CAPACITY_PEOPLE,
  minimumPeople: EVENT_MINIMUM_PEOPLE,
  totalRounds: EVENT_TOTAL_ROUNDS,
  currentRound: 0,
  feeCents: 8_800,
  memberFeeCents: null,
  rules: [],
  prizePool: null,
  sponsor: null,
  ...overrides,
})

const validCreateDto = (overrides: Partial<CreateEventDto> = {}): CreateEventDto => ({
  code: 'SWISS-DRAFT-02',
  name: '待审核赛事',
  startsAt: '2099-08-30T10:00:00.000Z',
  registrationEndsAt: '2099-08-30T09:00:00.000Z',
  capacityPeople: EVENT_MAX_CAPACITY_PEOPLE,
  minimumPeople: EVENT_MINIMUM_PEOPLE,
  totalRounds: EVENT_TOTAL_ROUNDS,
  feeCents: 8_800,
  ...overrides,
})

describe('EventsService publish workflow', () => {
  it('creates an event as DRAFT until an explicit publish action', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'event-draft-1', status: EventStatus.DRAFT })
    const service = new EventsService({ event: { create } } as never)

    await service.create(validCreateDto())

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EventStatus.DRAFT }),
      }),
    )
  })

  it('publishes a valid draft exactly once and records an audit entry', async () => {
    const current = draftEvent()
    const published = { ...current, status: EventStatus.OPEN }
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(published),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new EventsService({ $transaction: txRunner(tx) } as never)
    const dto: PublishEventDto = { reason: '财务与场地资源已复核' }

    await expect(service.publish(current.id, dto, actor)).resolves.toEqual(published)
    expect(tx.event.updateMany).toHaveBeenCalledWith({
      where: { id: current.id, status: EventStatus.DRAFT },
      data: { status: EventStatus.OPEN },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: actor.sub,
        action: 'EVENT_PUBLISHED',
        objectType: 'Event',
        objectId: current.id,
        oldValue: { status: EventStatus.DRAFT },
        newValue: { status: EventStatus.OPEN, reason: dto.reason },
        reason: dto.reason,
      }),
    })
  })

  it('treats a retry after OPEN as idempotent without another audit entry', async () => {
    const open = draftEvent({ status: EventStatus.OPEN })
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue(open),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    const service = new EventsService({ $transaction: txRunner(tx) } as never)

    await expect(service.publish(open.id, undefined, actor)).resolves.toEqual(open)
    expect(tx.event.updateMany).not.toHaveBeenCalled()
    expect(tx.event.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it.each([EventStatus.FULL, EventStatus.IN_PROGRESS, EventStatus.COMPLETED, EventStatus.CANCELLED])(
    'rejects publishing an event already in %s',
    async (status) => {
      const tx = {
        event: {
          findUnique: vi.fn().mockResolvedValue(draftEvent({ status })),
          updateMany: vi.fn(),
        },
        auditLog: { create: vi.fn() },
      }
      const service = new EventsService({ $transaction: txRunner(tx) } as never)

      await expect(service.publish('event-draft-1', {}, actor)).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(tx.event.updateMany).not.toHaveBeenCalled()
      expect(tx.auditLog.create).not.toHaveBeenCalled()
    },
  )

  it('returns OPEN when a concurrent publisher wins the conditional update', async () => {
    const open = draftEvent({ status: EventStatus.OPEN })
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValueOnce(draftEvent()).mockResolvedValueOnce(open),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: vi.fn() },
    }
    const service = new EventsService({ $transaction: txRunner(tx) } as never)

    await expect(service.publish('event-draft-1', {}, actor)).resolves.toEqual(open)
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('rejects a corrupted draft before making it visible', async () => {
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue(draftEvent({ totalRounds: 4 })),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    const service = new EventsService({ $transaction: txRunner(tx) } as never)

    await expect(service.publish('event-draft-1', {}, actor)).rejects.toThrow('固定为5轮')
    expect(tx.event.updateMany).not.toHaveBeenCalled()
  })

  it('keeps registration closed while an event is still DRAFT', async () => {
    const eventFind = vi.fn().mockResolvedValue({
      ...draftEvent(),
      _count: { teams: 0 },
    })
    const transaction = vi.fn()
    const service = new EventsService({
      event: { findUnique: eventFind },
      $transaction: transaction,
    } as never)
    const dto: RegisterEventTeamDto = {
      name: '一队',
      playerAName: '甲',
      playerBName: '乙',
      playerAUserId: 'player-a',
      playerBUserId: 'player-b',
      category: TeamCategory.MEN_DOUBLES,
    }

    await expect(service.register('event-draft-1', dto, actor)).rejects.toThrow('不在报名期')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('reports a missing event instead of creating a phantom publish audit', async () => {
    const tx = {
      event: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const service = new EventsService({ $transaction: txRunner(tx) } as never)

    await expect(service.publish('missing-event', {}, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })
})
