import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AccountAdjustmentStatus, AccountType, AppRole } from '../generated/prisma/client.js'
import { MembersService } from './members.service.js'

const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务制单员',
  roles: [AppRole.FINANCE],
}

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员复核员',
  roles: [AppRole.ADMIN],
}

describe('MembersService account adjustment approval', () => {
  it('enforces the finance review role inside the service when listing requests', () => {
    const prisma = { accountAdjustmentRequest: { findMany: vi.fn() } }
    const member: AuthUser = {
      sub: 'member-1',
      displayName: '普通会员',
      roles: [AppRole.MEMBER],
    }

    expect(() => new MembersService(prisma as never).accountAdjustmentRequests({}, member))
      .toThrow(ForbiddenException)
    expect(prisma.accountAdjustmentRequest.findMany).not.toHaveBeenCalled()
  })

  it('creates an idempotent review request without mutating the account balance', async () => {
    const account = {
      id: 'account-1', userId: 'member-1', type: AccountType.BADMINTON_COIN,
      balance: 50, frozenBalance: 0, version: 2,
    }
    const request = {
      id: 'adjustment-1', accountId: account.id, amount: 20, reason: '活动补发',
      requestedById: finance.sub, requestIdempotencyKey: 'adjustment-request-0001',
      commandHash: 'a'.repeat(64), status: AccountAdjustmentStatus.REQUESTED,
    }
    const tx = {
      accountAdjustmentRequest: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(request),
      },
      account: { updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      account: { findUnique: vi.fn().mockResolvedValue(account) },
      accountAdjustmentRequest: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    }

    const result = await new MembersService(prisma as never).adjustAccount('member-1', {
      accountType: AccountType.BADMINTON_COIN,
      amount: 20,
      reason: '活动补发',
      idempotencyKey: 'adjustment-request-0001',
    }, finance)

    expect(result).toBe(request)
    expect(tx.account.updateMany).not.toHaveBeenCalled()
    expect(tx.accountAdjustmentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: account.id,
        requestedById: finance.sub,
        amount: 20,
        requestIdempotencyKey: 'adjustment-request-0001',
        commandHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ACCOUNT_ADJUSTMENT_REQUESTED' }),
    })
  })

  it('prevents the maker from approving their own request', async () => {
    const request = {
      id: 'adjustment-1', requestedById: finance.sub,
      status: AccountAdjustmentStatus.REQUESTED, amount: 20,
      account: { id: 'account-1', balance: 50, version: 2 }, transaction: null,
    }
    const tx = {
      accountAdjustmentRequest: { findUnique: vi.fn().mockResolvedValue(request) },
      account: { updateMany: vi.fn() },
    }
    const prisma = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) }

    await expect(new MembersService(prisma as never).approveAccountAdjustment(
      request.id,
      { reason: '复核确认' },
      finance,
    )).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.account.updateMany).not.toHaveBeenCalled()
  })

  it('posts one immutable ledger transaction when a different checker approves', async () => {
    const request = {
      id: 'adjustment-1', accountId: 'account-1', requestedById: finance.sub,
      status: AccountAdjustmentStatus.REQUESTED, amount: -20, reason: '重复奖励追回',
      account: { id: 'account-1', type: AccountType.BADMINTON_COIN, balance: 50, version: 2 },
      transaction: null,
    }
    const transaction = { id: 'account-txn-1', balanceBefore: 50, balanceAfter: 30 }
    const tx = {
      accountAdjustmentRequest: {
        findUnique: vi.fn().mockResolvedValue(request),
        update: vi.fn().mockResolvedValue({ ...request, status: AccountAdjustmentStatus.POSTED, transactionId: transaction.id }),
      },
      account: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      accountTransaction: { create: vi.fn().mockResolvedValue(transaction) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) }

    const result = await new MembersService(prisma as never).approveAccountAdjustment(
      request.id,
      { reason: '核对原奖励流水' },
      admin,
    )

    expect(result).toMatchObject({ status: AccountAdjustmentStatus.POSTED, transaction })
    expect(tx.account.updateMany).toHaveBeenCalledWith({
      where: { id: request.account.id, version: 2 },
      data: { balance: 30, version: { increment: 1 } },
    })
    expect(tx.accountTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: -20,
        balanceBefore: 50,
        balanceAfter: 30,
        operatorId: admin.sub,
        idempotencyKey: `ACCOUNT_ADJUSTMENT:${request.id}`,
      }),
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'ACCOUNT_ADJUSTMENT_POSTED' }),
    })
  })
})
