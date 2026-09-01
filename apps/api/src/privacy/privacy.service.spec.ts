import { ConflictException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { DataErasureRequestStatus } from '../generated/prisma/enums.js'
import { PrivacyService } from './privacy.service.js'

const member: AuthUser = { sub: 'member-1', displayName: '会员甲', roles: ['MEMBER'] }
const superAdmin: AuthUser = { sub: 'admin-1', displayName: '超级管理员', roles: ['SUPER_ADMIN'] }
const privateReplayFields = [
  'requestIdempotencyKey',
  'requestCommandHash',
  'decisionIdempotencyKey',
  'decisionCommandHash',
] as const

const expectPrivateReplayFieldsHidden = (value: unknown) => {
  for (const field of privateReplayFields) {
    expect(value).not.toHaveProperty(field)
  }
}

const emptyCounts = () => ({
  account: { count: vi.fn().mockResolvedValue(0) },
  order: { count: vi.fn().mockResolvedValue(0) },
  payment: { count: vi.fn().mockResolvedValue(0) },
  refund: { count: vi.fn().mockResolvedValue(0) },
  memberSubscription: { count: vi.fn().mockResolvedValue(0) },
  gameRegistration: { count: vi.fn().mockResolvedValue(0) },
  eventTeam: { count: vi.fn().mockResolvedValue(0) },
  trainingEnrollment: { count: vi.fn().mockResolvedValue(0) },
  trainingTrial: { count: vi.fn().mockResolvedValue(0) },
  couponCode: { count: vi.fn().mockResolvedValue(0) },
  accountAdjustmentRequest: { count: vi.fn().mockResolvedValue(0) },
  referralReward: { count: vi.fn().mockResolvedValue(0) },
  hostReward: { count: vi.fn().mockResolvedValue(0) },
  frontDeskShift: { count: vi.fn().mockResolvedValue(0) },
})

describe('PrivacyService data-erasure workflow', () => {
  it('creates one auditable self-service request and replays the same command', async () => {
    const request = {
      id: 'erasure-1',
      userId: member.sub,
      status: DataErasureRequestStatus.REQUESTED,
      requestIdempotencyKey: 'erasure-request-0001',
      requestCommandHash: '',
    }
    let stored: typeof request | null = null
    const tx: any = {
      dataErasureRequest: {
        findUnique: vi.fn(({ where }) => Promise.resolve(where.requestIdempotencyKey ? stored : null)),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(({ data }) => {
          stored = { ...request, requestCommandHash: data.requestCommandHash }
          return Promise.resolve(stored)
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve({ ...stored, user: { id: member.sub, displayName: member.displayName, status: 'ACTIVE' }, reviewedBy: null })),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: member.sub, status: 'ACTIVE', deletedAt: null, memberProfile: { id: member.sub } }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
    const prisma: any = { ...tx, $transaction: (callback: any) => callback(tx) }
    const service = new PrivacyService(prisma)
    const command = { reason: '不再使用服务', idempotencyKey: 'erasure-request-0001' }

    const first = await service.create(command, member)
    const second = await service.create(command, member)

    expect(first.id).toBe('erasure-1')
    expect(second.id).toBe('erasure-1')
    expectPrivateReplayFieldsHidden(first)
    expectPrivateReplayFieldsHidden(second)
    expect(tx.dataErasureRequest.create).toHaveBeenCalledTimes(1)
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1)
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: member.sub,
        action: 'DATA_ERASURE_REQUESTED',
        requestId: command.idempotencyKey,
      }),
    })
  })

  it('projects member and administrator lists without replay keys or command hashes', async () => {
    const raw = {
      id: 'erasure-private-fields',
      userId: member.sub,
      status: DataErasureRequestStatus.REQUESTED,
      reason: '不再使用服务',
      requestIdempotencyKey: 'private-request-key',
      requestCommandHash: 'private-request-hash',
      decisionIdempotencyKey: 'private-decision-key',
      decisionCommandHash: 'private-decision-hash',
      reviewedById: superAdmin.sub,
      reviewReason: '待处理',
      requestedAt: new Date('2026-08-30T00:00:00.000Z'),
      reviewedAt: null,
      completedAt: null,
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
      updatedAt: new Date('2026-08-30T00:00:00.000Z'),
      user: {
        id: member.sub,
        displayName: member.displayName,
        phone: '13800000000',
        status: 'ACTIVE',
      },
      reviewedBy: { id: superAdmin.sub, displayName: superAdmin.displayName },
    }
    const prisma: any = {
      dataErasureRequest: {
        findMany: vi.fn().mockResolvedValue([raw]),
        count: vi.fn().mockResolvedValue(1),
      },
      $transaction: (values: Promise<unknown>[]) => Promise.all(values),
    }
    const service = new PrivacyService(prisma)

    const mine = await service.listMine(member)
    const managed = await service.list({ page: 1, pageSize: 20 } as any, superAdmin)

    expect(mine[0]).toMatchObject({ id: raw.id, status: raw.status })
    expect(managed.items[0]).toMatchObject({
      id: raw.id,
      user: { displayName: member.displayName, phone: '13800000000' },
    })
    expectPrivateReplayFieldsHidden(mine[0])
    expectPrivateReplayFieldsHidden(managed.items[0])
  })

  it('does not let the requester approve their own irreversible anonymization', async () => {
    const tx: any = {
      dataErasureRequest: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'erasure-1', userId: superAdmin.sub, status: 'REQUESTED' }),
      },
    }
    const prisma: any = { ...tx, $transaction: (callback: any) => callback(tx) }
    const service = new PrivacyService(prisma)

    await expect(service.complete('erasure-1', {
      reason: '复核通过', idempotencyKey: 'erasure-decision-0001',
    }, superAdmin)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('returns explicit blockers instead of deleting an account with spendable value', async () => {
    const counts: any = emptyCounts()
    counts.account.count.mockResolvedValue(1)
    const tx: any = {
      ...counts,
      dataErasureRequest: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'erasure-1', userId: member.sub, status: 'REQUESTED' }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: member.sub, status: 'DISABLED', deletedAt: null,
          primaryRole: 'MEMBER', roles: [{ role: 'MEMBER' }],
        }),
      },
    }
    const prisma: any = { ...tx, $transaction: (callback: any) => callback(tx) }
    const service = new PrivacyService(prisma)

    const failure = service.complete('erasure-1', {
      reason: '余额未结清测试', idempotencyKey: 'erasure-decision-0002',
    }, superAdmin)
    await expect(failure).rejects.toBeInstanceOf(ConflictException)
    await expect(failure).rejects.toMatchObject({
      response: expect.objectContaining({
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: 'SPENDABLE_ACCOUNT_BALANCE', count: 1 }),
        ]),
      }),
    })
  })

  it('anonymizes identifiers atomically while retaining business ledgers and audit evidence', async () => {
    const counts: any = emptyCounts()
    const current = { id: 'erasure-1', userId: member.sub, status: 'REQUESTED' }
    const completed = {
      ...current,
      status: 'COMPLETED',
      requestIdempotencyKey: 'private-request-key',
      requestCommandHash: 'private-request-hash',
      decisionIdempotencyKey: 'private-decision-key',
      decisionCommandHash: 'private-decision-hash',
      user: { id: member.sub, displayName: '已注销用户-mber-1', status: 'DELETED' },
      reviewedBy: { id: superAdmin.sub, displayName: superAdmin.displayName },
    }
    const tx: any = {
      ...counts,
      dataErasureRequest: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(completed),
      },
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: member.sub, status: 'DISABLED', deletedAt: null, primaryRole: 'MEMBER', roles: [{ role: 'MEMBER' }] })
          .mockResolvedValueOnce({ id: member.sub, displayName: member.displayName, updatedAt: new Date('2026-08-30T00:00:00Z') }),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 1 }),
      },
      eventTeam: {
        count: counts.eventTeam.count,
        findMany: vi.fn().mockResolvedValue([{
          id: 'team-1',
          playerAName: member.displayName,
          playerBName: '搭档乙',
          playerAUserId: member.sub,
          playerBUserId: 'member-2',
        }]),
        update: vi.fn().mockResolvedValue({ id: 'team-1' }),
      },
      eventPrizeAward: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'award-1',
          recipientNames: [member.displayName, '搭档乙'],
          receivedByName: member.displayName,
        }]),
        update: vi.fn().mockResolvedValue({ id: 'award-1' }),
      },
      userRole: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      memberProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      student: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      customerLead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      hostProfile: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      notification: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      exportJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-complete' }) },
    }
    const prisma: any = { ...tx, $transaction: (callback: any) => callback(tx) }
    const service = new PrivacyService(prisma)

    const result = await service.complete('erasure-1', {
      reason: '确认全部业务已结清', idempotencyKey: 'erasure-decision-0003',
    }, superAdmin)

    expect(result.status).toBe('COMPLETED')
    expectPrivateReplayFieldsHidden(result)
    expect(tx.user.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: member.sub, status: 'DISABLED', deletedAt: null }),
      data: expect.objectContaining({
        openId: null, unionId: null, phone: null, avatarUrl: null,
        status: 'DELETED', primaryRole: 'MEMBER', deletedAt: expect.any(Date),
      }),
    })
    expect(tx.order).toEqual(expect.objectContaining({ count: expect.any(Function) }))
    expect(tx.eventTeam.update).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { playerAName: '已匿名参赛者' },
    })
    expect(tx.eventPrizeAward.update).toHaveBeenCalledWith({
      where: { id: 'award-1' },
      data: {
        recipientNames: ['已匿名参赛者', '搭档乙'],
        receivedByName: '已匿名参赛者',
      },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'DATA_ERASURE_COMPLETED',
        newValue: expect.objectContaining({ personalIdentifiersRemoved: true }),
      }),
    })
  })
})
