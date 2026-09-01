import { createHash } from 'node:crypto'

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, UserStatus } from '../generated/prisma/enums.js'
import { MembersController } from './members.controller.js'
import { MembersService } from './members.service.js'

const inviteCode = 'abcdefghijklmnopqrstuvwxyz_12345'
const tokenHash = createHash('sha256').update(inviteCode).digest('hex')
const member: AuthUser = {
  sub: 'member-1',
  displayName: '绑定会员',
  roles: [AppRole.MEMBER],
}
const activeMember = (id: string, referrerId: string | null = null) => ({
  id,
  referrerId,
  status: UserStatus.ACTIVE,
  deletedAt: null,
  memberProfile: { id: `profile-${id}` },
})
const activeInvite = (overrides: Record<string, unknown> = {}) => ({
  id: 'invite-1',
  expiresAt: new Date(Date.now() + 86_400_000),
  revokedAt: null,
  inviter: activeMember('member-2'),
  ...overrides,
})
const transactionPrisma = (tx: Record<string, unknown>) => ({
  $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
})

describe('MembersService opaque referral binding', () => {
  it('resolves the inviter server-side, audits once and returns no user ids', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const inviteUpdate = vi.fn().mockResolvedValue({})
    const auditCreate = vi.fn().mockResolvedValue({})
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue(activeMember('member-1')), updateMany },
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue(activeInvite()),
        update: inviteUpdate,
      },
      auditLog: { create: auditCreate },
    }
    const service = new MembersService(transactionPrisma(tx) as never)

    const result = await service.bindReferral({ inviteCode }, member)

    expect(result).toEqual({ bound: true })
    expect(result).not.toHaveProperty('referrerId')
    expect(tx.referralInvite.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash } }),
    )
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        referrerId: null,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      data: { referrerId: 'member-2' },
    })
    expect(inviteUpdate).toHaveBeenCalledWith({
      where: { id: 'invite-1' },
      data: {
        useCount: { increment: 1 },
        lastUsedAt: expect.any(Date),
      },
    })
    expect(auditCreate).toHaveBeenCalledOnce()
  })

  it('replays the same member binding without incrementing use count or auditing again', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(activeMember('member-1', 'member-2'))
      .mockResolvedValueOnce({ id: 'member-1', referrerId: 'member-2' })
    const tx = {
      user: { findUnique, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue(activeInvite()),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }

    await expect(
      new MembersService(transactionPrisma(tx) as never)
        .bindReferral({ inviteCode }, member),
    ).resolves.toEqual({ bound: true })
    expect(tx.referralInvite.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown', null],
    ['expired', activeInvite({ expiresAt: new Date(Date.now() - 1) })],
    ['revoked', activeInvite({ revokedAt: new Date() })],
  ])('rejects an %s invite before changing the relation', async (_label, invite) => {
    const updateMany = vi.fn()
    const tx = {
      user: { findUnique: vi.fn().mockResolvedValue(activeMember('member-1')), updateMany },
      referralInvite: { findUnique: vi.fn().mockResolvedValue(invite), update: vi.fn() },
      auditLog: { create: vi.fn() },
    }

    await expect(
      new MembersService(transactionPrisma(tx) as never)
        .bindReferral({ inviteCode }, member),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('preserves self-referral and inactive-referrer protections', async () => {
    const selfTx = {
      user: { findUnique: vi.fn().mockResolvedValue(activeMember('member-1')), updateMany: vi.fn() },
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue(activeInvite({ inviter: activeMember('member-1') })),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    await expect(
      new MembersService(transactionPrisma(selfTx) as never)
        .bindReferral({ inviteCode }, member),
    ).rejects.toBeInstanceOf(BadRequestException)

    const inactiveTx = {
      user: { findUnique: vi.fn().mockResolvedValue(activeMember('member-1')), updateMany: vi.fn() },
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue(activeInvite({
          inviter: { ...activeMember('member-2'), status: UserStatus.DISABLED },
        })),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }
    await expect(
      new MembersService(transactionPrisma(inactiveTx) as never)
        .bindReferral({ inviteCode }, member),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects a referral cycle reached through the resolved inviter', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(activeMember('member-1'))
      .mockResolvedValueOnce({ id: 'member-3', referrerId: 'member-1' })
      .mockResolvedValueOnce({ id: 'member-1', referrerId: null })
    const tx = {
      user: { findUnique, updateMany: vi.fn() },
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue(activeInvite({
          inviter: activeMember('member-2', 'member-3'),
        })),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    }

    await expect(
      new MembersService(transactionPrisma(tx) as never)
        .bindReferral({ inviteCode }, member),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(tx.user.updateMany).not.toHaveBeenCalled()
  })

  it('allows the same reusable invite to bind multiple distinct new members', async () => {
    const users = new Map([
      ['member-a', activeMember('member-a')],
      ['member-b', activeMember('member-b')],
    ])
    const storedInvite = { ...activeInvite(), useCount: 0, lastUsedAt: null as Date | null }
    const tx = {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const user = users.get(where.id)
          if (!user || user.referrerId) return { count: 0 }
          user.referrerId = data.referrerId
          return { count: 1 }
        }),
      },
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue(storedInvite),
        update: vi.fn(async ({ data }: any) => {
          storedInvite.useCount += data.useCount.increment
          storedInvite.lastUsedAt = data.lastUsedAt
          return storedInvite
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const service = new MembersService(transactionPrisma(tx) as never)

    await expect(service.bindReferral(
      { inviteCode },
      { ...member, sub: 'member-a' },
    )).resolves.toEqual({ bound: true })
    await expect(service.bindReferral(
      { inviteCode },
      { ...member, sub: 'member-b' },
    )).resolves.toEqual({ bound: true })

    expect(users.get('member-a')?.referrerId).toBe('member-2')
    expect(users.get('member-b')?.referrerId).toBe('member-2')
    expect(storedInvite.useCount).toBe(2)
  })

  it('surfaces a different concurrent winner as an immutable-binding conflict', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(activeMember('member-1'))
      .mockResolvedValueOnce({ id: 'member-1', referrerId: 'member-3' })
    const tx = {
      user: { findUnique, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      referralInvite: { findUnique: vi.fn().mockResolvedValue(activeInvite()), update: vi.fn() },
      auditLog: { create: vi.fn() },
    }

    await expect(
      new MembersService(transactionPrisma(tx) as never)
        .bindReferral({ inviteCode }, member),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('recovers an exact serialization retry without returning the referrer id', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
      referralInvite: {
        findUnique: vi.fn().mockResolvedValue({
          inviterId: 'member-2',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'member-1', referrerId: 'member-2' }),
      },
    }

    await expect(
      new MembersService(prisma as never).bindReferral({ inviteCode }, member),
    ).resolves.toEqual({ bound: true })
  })
})

describe('MembersController direct referral binding', () => {
  it('delegates only the opaque code with the authenticated actor', async () => {
    const members = { bindReferral: vi.fn().mockResolvedValue({ bound: true }) }
    const controller = new MembersController(members as never)
    const dto = { inviteCode }

    await expect(controller.bindReferral(dto, member)).resolves.toEqual({ bound: true })
    expect(members.bindReferral).toHaveBeenCalledWith(dto, member)
  })
})
