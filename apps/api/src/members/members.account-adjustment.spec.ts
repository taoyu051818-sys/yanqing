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
  it('projects ledger and adjustment queries without command or actor identifiers', async () => {
    const rawTransaction = {
      id: 'txn-1', accountId: 'account-1', orderId: 'order-1',
      kind: 'CREDIT', amount: 20, balanceBefore: 50, balanceAfter: 70,
      reasonCode: 'MANUAL_ADJUSTMENT', reason: '活动补发', expiresAt: null,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      operatorId: admin.sub, idempotencyKey: 'secret-ledger-key',
      metadata: { requestId: 'adjustment-1' },
      account: { type: AccountType.BADMINTON_COIN },
      operator: { id: admin.sub, displayName: admin.displayName },
    }
    const rawRequest = {
      id: 'adjustment-1', accountId: 'account-1', amount: 20,
      reason: '活动补发', status: AccountAdjustmentStatus.POSTED,
      requestedById: finance.sub, reviewedById: admin.sub,
      requestIdempotencyKey: 'secret-request-key', commandHash: 'hash',
      transactionId: rawTransaction.id, transaction: rawTransaction,
      account: { type: AccountType.BADMINTON_COIN, balance: 70, frozenBalance: 0,
        user: { id: 'member-1', displayName: '会员甲', phone: '13800000000' } },
      requestedBy: { id: finance.sub, displayName: finance.displayName },
      reviewedBy: { id: admin.sub, displayName: admin.displayName },
      createdAt: rawTransaction.createdAt, updatedAt: rawTransaction.createdAt,
    }
    const prisma = {
      accountTransaction: { findMany: vi.fn().mockResolvedValue([rawTransaction]) },
      accountAdjustmentRequest: { findMany: vi.fn().mockResolvedValue([rawRequest]) },
    }
    const service = new MembersService(prisma as never)

    const [transaction] = await service.accountTransactions('member-1')
    const [request] = await service.accountAdjustmentRequests({}, finance)
    const serialized = JSON.stringify({ transaction, request })

    expect(transaction).toEqual(expect.objectContaining({ id: rawTransaction.id, amount: 20 }))
    expect(request).toEqual(expect.objectContaining({ id: rawRequest.id, isOwnRequest: true }))
    for (const forbidden of [
      'idempotencyKey', 'requestIdempotencyKey', 'commandHash', 'metadata',
      'operatorId', 'requestedById', 'reviewedById', 'transactionId', 'accountId',
    ]) expect(serialized).not.toContain(`"${forbidden}"`)
  })

  it('enforces the finance review role inside the service when listing requests', async () => {
    const prisma = { accountAdjustmentRequest: { findMany: vi.fn() } }
    const member: AuthUser = {
      sub: 'member-1',
      displayName: '普通会员',
      roles: [AppRole.MEMBER],
    }

    await expect(new MembersService(prisma as never).accountAdjustmentRequests({}, member))
      .rejects.toBeInstanceOf(ForbiddenException)
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

    expect(result).toMatchObject({
      id: request.id,
      amount: request.amount,
      reason: request.reason,
      status: request.status,
      isOwnRequest: true,
      account: expect.objectContaining({ type: account.type }),
    })
    expect(result).not.toHaveProperty('requestIdempotencyKey')
    expect(result).not.toHaveProperty('commandHash')
    expect(result).not.toHaveProperty('requestedById')
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
    expect(result).not.toHaveProperty('reviewedById')
    expect(result).not.toHaveProperty('transactionId')
    expect(result.transaction).not.toHaveProperty('idempotencyKey')
    expect(result.transaction).not.toHaveProperty('operatorId')
    expect(result.transaction).not.toHaveProperty('metadata')
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
