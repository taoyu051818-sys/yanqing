import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  EventStatus,
  SourceChannel,
  TeamCategory,
  UserStatus,
} from '../generated/prisma/enums.js'
import { EventsService } from './events.service.js'

const captain: AuthUser = {
  sub: 'member-captain',
  displayName: '队长甲',
  roles: [AppRole.MEMBER],
}

const partner: AuthUser = {
  sub: 'member-partner',
  displayName: '搭档乙',
  roles: [AppRole.MEMBER],
}

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  code: 'EVENT-1',
  name: '延庆固定双打赛',
  status: EventStatus.OPEN,
  startsAt: new Date('2099-09-02T10:00:00.000Z'),
  registrationEndsAt: new Date('2099-09-02T09:00:00.000Z'),
  capacityPeople: 24,
  minimumPeople: 24,
  totalRounds: 5,
  currentRound: 0,
  feeCents: 8_800,
  memberFeeCents: null,
  rules: [],
  ...overrides,
})

const txRunner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

describe('event partner account authorization', () => {
  it('lets the partner create an event-scoped code without storing the raw code', async () => {
    const inviteCreate = vi.fn().mockResolvedValue({ id: 'invite-1' })
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      eventPartnerInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: inviteCreate,
      },
      auditLog: { create: auditCreate },
    }
    const service = new EventsService({
      event: { findUnique: vi.fn().mockResolvedValue(event()) },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: partner.sub,
          displayName: partner.displayName,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          memberProfile: { id: 'profile-partner' },
        }),
      },
      eventTeam: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: txRunner(tx),
    } as never)

    const result = await service.createPartnerInvite('event-1', partner)

    expect(result.partnerInviteCode).toMatch(/^EP_[A-Za-z0-9_-]{20,}$/)
    expect(result.partnerDisplayName).toBe(partner.displayName)
    const stored = inviteCreate.mock.calls[0][0].data
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(result.partnerInviteCode).digest('hex'),
    )
    expect(JSON.stringify(stored)).not.toContain(result.partnerInviteCode)
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'EVENT_PARTNER_INVITE_CREATED',
        actorId: partner.sub,
      }),
    })
  })

  it('requires a partner-issued code for member self-service registration', async () => {
    const eventFind = vi.fn()
    const service = new EventsService({ event: { findUnique: eventFind } } as never)

    await expect(
      service.register(
        'event-1',
        {
          name: '真账号队',
          category: TeamCategory.MIXED_DOUBLES,
          sourceChannel: SourceChannel.MINI_PROGRAM,
        },
        captain,
      ),
    ).rejects.toThrow('搭档本人生成的授权码')
    expect(eventFind).not.toHaveBeenCalled()
  })

  it('binds authoritative captain and partner accounts and consumes the code once', async () => {
    const partnerInviteCode = 'EP_partner_authorization_code_123456'
    const createdOrder = {
      id: 'order-1',
      eventTeam: { id: 'team-1' },
    }
    const eventTeamFindFirst = vi.fn().mockResolvedValue(null)
    const eventPartnerInviteUpdate = vi.fn().mockResolvedValue({ count: 1 })
    const orderCreate = vi.fn().mockResolvedValue(createdOrder)
    const tx = {
      event: {
        findUnique: vi.fn().mockResolvedValue(event()),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      eventPartnerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invite-1',
          eventId: 'event-1',
          partnerId: partner.sub,
          expiresAt: new Date('2099-09-02T08:30:00.000Z'),
          revokedAt: null,
          consumedAt: null,
          partner: {
            id: partner.sub,
            displayName: partner.displayName,
            status: UserStatus.ACTIVE,
            deletedAt: null,
            memberProfile: { id: 'profile-partner' },
          },
        }),
        updateMany: eventPartnerInviteUpdate,
      },
      memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      eventTeam: {
        findFirst: eventTeamFindFirst,
        count: vi.fn().mockResolvedValue(0),
      },
      order: { create: orderCreate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new EventsService({
      event: { findUnique: vi.fn().mockResolvedValue(event()) },
      memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: txRunner(tx),
    } as never)

    const result = await service.register(
      'event-1',
      {
        name: '真账号队',
        partnerInviteCode,
        category: TeamCategory.MIXED_DOUBLES,
        sourceChannel: SourceChannel.MINI_PROGRAM,
      },
      captain,
    )

    expect(result).toBe(createdOrder)
    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberId: captain.sub,
          eventTeam: {
            create: expect.objectContaining({
              captainId: captain.sub,
              playerAName: captain.displayName,
              playerAUserId: captain.sub,
              playerBName: partner.displayName,
              playerBUserId: partner.sub,
            }),
          },
        }),
      }),
    )
    expect(eventPartnerInviteUpdate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'invite-1',
        consumedAt: null,
        revokedAt: null,
      }),
      data: expect.objectContaining({
        consumedAt: expect.any(Date),
        consumedTeamId: 'team-1',
      }),
    })
    expect(eventTeamFindFirst).toHaveBeenCalledTimes(3)
  })

  it('rejects a consumed code before creating an order', async () => {
    const orderCreate = vi.fn()
    const tx = {
      event: { findUnique: vi.fn().mockResolvedValue(event()) },
      eventPartnerInvite: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'invite-used',
          eventId: 'event-1',
          partnerId: partner.sub,
          expiresAt: new Date('2099-09-02T08:30:00.000Z'),
          revokedAt: null,
          consumedAt: new Date(),
          partner: {
            id: partner.sub,
            displayName: partner.displayName,
            status: UserStatus.ACTIVE,
            deletedAt: null,
            memberProfile: { id: 'profile-partner' },
          },
        }),
      },
      eventTeam: { findFirst: vi.fn() },
      order: { create: orderCreate },
    }
    const service = new EventsService({
      event: { findUnique: vi.fn().mockResolvedValue(event()) },
      memberProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: txRunner(tx),
    } as never)

    await expect(
      service.register(
        'event-1',
        {
          name: '重复使用队',
          partnerInviteCode: 'EP_partner_authorization_code_123456',
          category: TeamCategory.MEN_DOUBLES,
          sourceChannel: SourceChannel.MINI_PROGRAM,
        },
        captain,
      ),
    ).rejects.toThrow('已使用或已过期')
    expect(orderCreate).not.toHaveBeenCalled()
  })
})
