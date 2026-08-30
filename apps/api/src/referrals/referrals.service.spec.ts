import { describe, expect, it, vi } from 'vitest'

import { AppRole, OrderStatus, RewardStatus } from '../generated/prisma/enums.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { ReferralsService } from './referrals.service.js'

const actor: AuthUser = { sub: 'finance-1', displayName: '财务', roles: [AppRole.FINANCE] }

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
  status: RewardStatus.PENDING_OBSERVATION,
  observationEndsAt: new Date('2026-08-01T00:00:00.000Z'),
  grantedAt: null,
  reversedAt: null,
  triggerOrder: { id: 'order-1', status: OrderStatus.PAID },
  ...overrides,
})

describe('ReferralsService reward release', () => {
  it('credits a matured reward once and records an idempotent ledger entry', async () => {
    const reward = baseReward()
    const transactions = new Map<string, { id: string; amount: number }>()
    const account = { id: 'account-1', balance: 100, version: 0 }
    const tx = {
      referralReward: {
        findUnique: vi.fn().mockResolvedValue(reward),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reward, data)
          return { count: 1 }
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(reward),
      },
      account: {
        upsert: vi.fn().mockResolvedValue(account),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: { balance: { increment: number } } }) => {
          account.balance += data.balance.increment
          account.version += 1
          return { count: 1 }
        }),
      },
      accountTransaction: {
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { idempotencyKey: string } }) =>
          transactions.get(where.idempotencyKey) ?? null),
        create: vi.fn().mockImplementation(async ({ data }: { data: { idempotencyKey: string; amount: number } }) => {
          const row = { id: 'txn-1', amount: data.amount }
          transactions.set(data.idempotencyKey, row)
          return row
        }),
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
    expect(account.balance).toBe(150)
    expect(tx.accountTransaction.create).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('reverses a matured reward when the trigger order was refunded', async () => {
    const reward = baseReward({ triggerOrder: { id: 'order-1', status: OrderStatus.PARTIALLY_REFUNDED } })
    const update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(reward, data)
      return reward
    })
    const tx = {
      referralReward: { findUnique: vi.fn().mockResolvedValue(reward), update, findUniqueOrThrow: vi.fn() },
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
    const reward = baseReward({ observationEndsAt: new Date('2099-08-01T00:00:00.000Z') })
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
