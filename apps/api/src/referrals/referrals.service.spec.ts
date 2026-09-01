import { createHash } from 'node:crypto'

import { NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import {
  AppRole,
  OrderStatus,
  RewardStatus,
  UserStatus,
} from '../generated/prisma/enums.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { ReferralsService } from './referrals.service.js'

const actor: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
}

const runInTx = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

const baseReward = (overrides: Record<string, unknown> = {}) => ({
  id: 'reward-1',
  referrerId: 'referrer-1',
  newUserId: 'new-user-1',
  triggerOrderId: 'order-1',
  triggerType: 'FIRST_PAYMENT',
  rewardType: 'BADMINTON_COIN',
  rewardValue: 50,
  newUserRewardValue: 30,
  status: RewardStatus.PENDING_OBSERVATION,
  observationEndsAt: new Date('2026-08-01T00:00:00.000Z'),
  grantedAt: null,
  reversedAt: null,
  triggerOrder: {
    id: 'order-1',
    status: OrderStatus.COMPLETED,
    completedAt: new Date('2026-07-20T00:00:00.000Z'),
    refundedCents: 0,
  },
  ...overrides,
})

describe('ReferralsService opaque invites', () => {
  it('returns a random code while persisting only its SHA-256 hash', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'invite-1' })
    const service = new ReferralsService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          status: UserStatus.ACTIVE,
          deletedAt: null,
          memberProfile: { id: 'profile-1' },
        }),
      },
      referralInvite: { create },
    } as never)

    const before = Date.now()
    const result = await service.createInvite({
      sub: 'member-1',
      displayName: '会员',
      roles: [AppRole.MEMBER],
    })

    expect(result.inviteCode).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(result.expiresAt.getTime()).toBeGreaterThan(before + 29 * 86_400_000)
    const data = create.mock.calls[0][0].data
    expect(data).not.toHaveProperty('inviteCode')
    expect(data).toMatchObject({
      inviterId: 'member-1',
      tokenHash: createHash('sha256').update(result.inviteCode).digest('hex'),
    })
  })

  it('does not issue an invite for an inactive or non-member account', async () => {
    const create = vi.fn()
    const service = new ReferralsService({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          status: UserStatus.DISABLED,
          deletedAt: null,
          memberProfile: { id: 'profile-1' },
        }),
      },
      referralInvite: { create },
    } as never)

    await expect(service.createInvite({
      sub: 'member-1',
      displayName: '会员',
      roles: [AppRole.MEMBER],
    })).rejects.toBeInstanceOf(NotFoundException)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('ReferralsService reward release', () => {
  it('returns only the minimum trigger-order state needed by the referrer', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const service = new ReferralsService({
      referralReward: { findMany },
    } as never)

    await service.myRewards(actor)

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ referrerId: actor.sub }, { newUserId: actor.sub }] },
        select: expect.objectContaining({
          triggerOrder: {
            select: expect.not.objectContaining({
              payableCents: true,
              paidCents: true,
              paymentChannel: true,
              parameterSnapshot: true,
            }),
          },
        }),
      }),
    )
  })

  it('does not return participant or trigger ids in the member reward view', async () => {
    const service = new ReferralsService({
      referralReward: {
        findMany: vi.fn().mockResolvedValue([{
          ...baseReward(),
          newUser: { displayName: '新会员' },
          referrer: { displayName: '邀请人' },
        }]),
      },
    } as never)

    const [result] = await service.myRewards({
      sub: 'referrer-1',
      displayName: '邀请人',
      roles: [AppRole.MEMBER],
    })

    expect(result).toMatchObject({ recipientRole: 'REFERRER' })
    expect(result).not.toHaveProperty('referrerId')
    expect(result).not.toHaveProperty('newUserId')
    expect(result).not.toHaveProperty('triggerOrderId')
  })

  it('credits inviter and new member once and records two idempotent ledger entries', async () => {
    const reward = baseReward()
    const transactions = new Map<string, { id: string; amount: number }>()
    const accounts = new Map([
      ['referrer-1', { id: 'account-referrer', balance: 100, version: 0 }],
      ['new-user-1', { id: 'account-new-user', balance: 20, version: 0 }],
    ])
    const tx = {
      referralReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        updateMany: vi
          .fn()
          .mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(reward, data)
              return { count: 1 }
            },
          ),
        findUniqueOrThrow: vi.fn().mockResolvedValue(reward),
      },
      account: {
        upsert: vi
          .fn()
          .mockImplementation(
            async ({ where }: { where: { userId_type: { userId: string } } }) =>
              accounts.get(where.userId_type.userId),
          ),
        updateMany: vi
          .fn()
          .mockImplementation(
            async ({
              where,
              data,
            }: {
              where: { id: string }
              data: { balance: { increment: number } }
            }) => {
              const account = [...accounts.values()].find(
                (item) => item.id === where.id,
              )!
              account.balance += data.balance.increment
              account.version += 1
              return { count: 1 }
            },
          ),
      },
      accountTransaction: {
        findUnique: vi
          .fn()
          .mockImplementation(
            async ({ where }: { where: { idempotencyKey: string } }) =>
              transactions.get(where.idempotencyKey) ?? null,
          ),
        create: vi
          .fn()
          .mockImplementation(
            async ({
              data,
            }: {
              data: { idempotencyKey: string; amount: number }
            }) => {
              const row = { id: 'txn-1', amount: data.amount }
              transactions.set(data.idempotencyKey, row)
              return row
            },
          ),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      referralReward: { findMany: vi.fn().mockResolvedValue([reward]) },
      $transaction: runInTx(tx),
    }
    const service = new ReferralsService(prisma as never)

    const first = await service.grantMatured(actor)
    const second = await service.grantMatured(actor)

    expect(first.processed).toBe(1)
    expect(second.processed).toBe(0)
    expect(reward.status).toBe(RewardStatus.GRANTED)
    expect(accounts.get('referrer-1')?.balance).toBe(150)
    expect(accounts.get('new-user-1')?.balance).toBe(50)
    expect(tx.accountTransaction.create).toHaveBeenCalledTimes(2)
    expect(tx.accountTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 30,
          reasonCode: 'NEW_MEMBER_REFERRAL_REWARD',
          idempotencyKey: 'REFERRAL_NEW_USER:reward-1',
        }),
      }),
    )
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('reverses a matured reward when the trigger order was refunded', async () => {
    const reward = baseReward({
      triggerOrder: {
        id: 'order-1',
        status: OrderStatus.PARTIALLY_REFUNDED,
        completedAt: new Date('2026-07-20T00:00:00.000Z'),
        refundedCents: 1_000,
      },
    })
    const update = vi
      .fn()
      .mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return reward
        },
      )
    const tx = {
      referralReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        update,
        findUniqueOrThrow: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      referralReward: { findMany: vi.fn().mockResolvedValue([reward]) },
      $transaction: runInTx(tx),
    }
    const service = new ReferralsService(prisma as never)

    await service.grantMatured(actor)

    expect(reward.status).toBe(RewardStatus.REVERSED)
    expect(update).toHaveBeenCalledOnce()
  })

  it('does not release a reward before its observation window', async () => {
    const reward = baseReward({
      observationEndsAt: new Date('2099-08-01T00:00:00.000Z'),
    })
    const tx = {
      referralReward: { findUnique: vi.fn().mockResolvedValue(reward) },
      account: { upsert: vi.fn() },
      accountTransaction: { findUnique: vi.fn(), create: vi.fn() },
    }
    const prisma = {
      referralReward: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: runInTx(tx),
    }
    const service = new ReferralsService(prisma as never)

    const result = await service.grantMatured(actor)

    expect(result.processed).toBe(0)
    expect(tx.account.upsert).not.toHaveBeenCalled()
    expect(reward.status).toBe(RewardStatus.PENDING_OBSERVATION)
  })

  it('does not grant a matured reward until its trigger order is fulfilled', async () => {
    const reward = baseReward({
      triggerOrder: {
        id: 'order-1',
        status: OrderStatus.PAID,
        completedAt: null,
        refundedCents: 0,
      },
    })
    const tx = {
      referralReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        updateMany: vi.fn(),
      },
      account: { upsert: vi.fn() },
    }
    const prisma = {
      referralReward: { findMany: vi.fn().mockResolvedValue([reward]) },
      $transaction: runInTx(tx),
    }

    const result = await new ReferralsService(prisma as never).grantMatured(
      actor,
    )

    expect(result.processed).toBe(0)
    expect(tx.referralReward.updateMany).not.toHaveBeenCalled()
    expect(tx.account.upsert).not.toHaveBeenCalled()
  })

  it('does not credit an account when another worker claims the reward first', async () => {
    const reward = baseReward()
    const tx = {
      referralReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      account: { upsert: vi.fn() },
      accountTransaction: { findUnique: vi.fn(), create: vi.fn() },
    }
    const prisma = {
      referralReward: { findMany: vi.fn().mockResolvedValue([reward]) },
      $transaction: runInTx(tx),
    }
    const service = new ReferralsService(prisma as never)

    const result = await service.grantMatured(actor)

    expect(result.processed).toBe(0)
    expect(tx.account.upsert).not.toHaveBeenCalled()
    expect(tx.accountTransaction.create).not.toHaveBeenCalled()
  })
})
