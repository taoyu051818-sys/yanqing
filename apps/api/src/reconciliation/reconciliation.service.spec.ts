import { describe, expect, it, vi } from 'vitest'
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  ReconciliationPeriodStatus,
} from '../generated/prisma/enums.js'
import { ReconciliationService } from './reconciliation.service.js'

const finance: AuthUser = { sub: 'finance-1', displayName: '财务', roles: [AppRole.FINANCE] }
const member: AuthUser = { sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER] }

const period = (overrides: Record<string, unknown> = {}) => ({
  id: 'period-1',
  businessDate: new Date('2026-08-28T16:00:00.000Z'),
  status: ReconciliationPeriodStatus.OPEN,
  totals: {},
  exceptionCount: 0,
  closedById: null,
  closedAt: null,
  detail: {},
  createdAt: new Date('2026-08-29T00:00:00.000Z'),
  updatedAt: new Date('2026-08-29T00:00:00.000Z'),
  ...overrides,
})

const baseTx = () => ({
  reconciliationPeriod: {
    findUnique: vi.fn().mockResolvedValue(null),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(period(data)),
    ),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  refund: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }),
  },
  payment: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }),
  },
  allianceSettlement: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { attributedGmvCents: 0, cooperationFeeCents: 0 } }),
  },
  trainingSettlement: {
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue({ _sum: { venueContributionCents: 0 } }),
  },
  order: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { paidCents: 0, refundedCents: 0 } }),
  },
  trainingRevenueRecognition: {
    aggregate: vi.fn().mockResolvedValue({ _sum: { effectiveRevenueCents: 0, venueContributionCents: 0 } }),
  },
  inventoryTransaction: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  frontDeskShift: {
    count: vi.fn().mockResolvedValue(0),
  },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
})

const serviceWith = (tx: Record<string, any>) => {
  const transaction = vi.fn(async (work: (value: Record<string, any>) => unknown) => work(tx))
  return { service: new ReconciliationService({ $transaction: transaction } as never), transaction }
}

describe('ReconciliationService', () => {
  it('rejects unauthorised actors and malformed business dates before touching the database', async () => {
    const { service } = serviceWith({})
    await expect(service.close('2026-08-29', {}, member)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.close('2026-02-31', {}, finance)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('keeps the current Shanghai business day live until midnight', async () => {
    const currentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const { service, transaction } = serviceWith({})

    await expect(service.close(currentDate, {}, finance)).rejects.toThrow('营业日结束后才可关账')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('closes a clean day and records one audit event', async () => {
    const tx = baseTx()
    const created = period({
      status: ReconciliationPeriodStatus.LOCKED,
      closedById: finance.sub,
      closedAt: new Date(),
    })
    tx.reconciliationPeriod.create.mockResolvedValue(created)
    const { service } = serviceWith(tx)

    const result = await service.close('2026-08-29', { reason: '日结核对完成' }, finance)

    expect(result).toMatchObject({ id: 'period-1', status: ReconciliationPeriodStatus.LOCKED, closedById: finance.sub })
    expect(tx.reconciliationPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: ReconciliationPeriodStatus.LOCKED,
        businessDate: new Date('2026-08-28T16:00:00.000Z'),
        closedById: finance.sub,
      }),
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'RECONCILIATION_PERIOD_CLOSED', objectId: 'period-1' }),
    })
  })

  it('returns REVIEW when pending money or settlement work remains', async () => {
    const tx = baseTx()
    tx.refund.count.mockResolvedValue(2)
    tx.allianceSettlement.count.mockResolvedValue(1)
    const reviewed = period({ status: ReconciliationPeriodStatus.REVIEW, exceptionCount: 2 })
    tx.reconciliationPeriod.create.mockResolvedValue(reviewed)
    const { service } = serviceWith(tx)

    const result = await service.close('2026-08-29', undefined, finance)

    expect(result).toMatchObject({ status: ReconciliationPeriodStatus.REVIEW, blocked: true, exceptionCount: 2 })
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'PENDING_REFUNDS', count: 2 }),
      expect.objectContaining({ kind: 'PENDING_ALLIANCE_SETTLEMENTS', count: 1 }),
    ]))
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'RECONCILIATION_PERIOD_BLOCKED' }),
    })
  })

  it('blocks close while a front-desk shift is open or a cash variance is awaiting finance review', async () => {
    const tx = baseTx()
    tx.frontDeskShift.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
    const reviewed = period({ status: ReconciliationPeriodStatus.REVIEW, exceptionCount: 2 })
    tx.reconciliationPeriod.create.mockResolvedValue(reviewed)
    const { service } = serviceWith(tx)

    const result = await service.close('2026-08-29', { reason: '检查交接班' }, finance)

    expect(result).toMatchObject({
      status: ReconciliationPeriodStatus.REVIEW,
      blocked: true,
      exceptionCount: 2,
    })
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'OPEN_FRONT_DESK_SHIFTS', count: 1 }),
      expect.objectContaining({ kind: 'UNREVIEWED_CASH_VARIANCES', count: 2 }),
    ]))
    expect(tx.frontDeskShift.count).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        businessDate: new Date('2026-08-28T16:00:00.000Z'),
        status: 'OPEN',
      }),
    })
    expect(tx.frontDeskShift.count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        cashVarianceCents: { not: 0 },
        varianceReviewedAt: null,
      }),
    })
  })

  it('makes a reviewed period LOCKED after blockers clear', async () => {
    const tx = baseTx()
    const reviewed = period({ status: ReconciliationPeriodStatus.REVIEW, exceptionCount: 1 })
    const locked = period({ status: ReconciliationPeriodStatus.LOCKED, closedById: finance.sub, closedAt: new Date() })
    tx.reconciliationPeriod.findUnique.mockResolvedValue(reviewed)
    tx.reconciliationPeriod.findUniqueOrThrow.mockResolvedValue(locked)
    const { service } = serviceWith(tx)

    const result = await service.close('2026-08-29', {}, finance)

    expect(result.status).toBe(ReconciliationPeriodStatus.LOCKED)
    expect(tx.reconciliationPeriod.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: reviewed.id, status: { in: [ReconciliationPeriodStatus.OPEN, ReconciliationPeriodStatus.REVIEW] } }),
      data: expect.objectContaining({ status: ReconciliationPeriodStatus.LOCKED, closedById: finance.sub }),
    }))
  })

  it('treats a LOCKED retry as idempotent and does not write a second audit', async () => {
    const tx = baseTx()
    const locked = period({ status: ReconciliationPeriodStatus.LOCKED, closedById: finance.sub, closedAt: new Date() })
    tx.reconciliationPeriod.findUnique.mockResolvedValue(locked)
    const { service } = serviceWith(tx)

    const result = await service.close('2026-08-29', {}, finance)

    expect(result).toMatchObject({ id: locked.id, status: ReconciliationPeriodStatus.LOCKED, blocked: false })
    expect(tx.refund.count).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('rejects an invalid transition when a concurrent worker changed the state', async () => {
    const tx = baseTx()
    const open = period()
    tx.reconciliationPeriod.findUnique.mockResolvedValue(open)
    tx.reconciliationPeriod.updateMany.mockResolvedValue({ count: 0 })
    tx.reconciliationPeriod.findUniqueOrThrow.mockResolvedValue({ ...open, status: ReconciliationPeriodStatus.OPEN })
    const { service } = serviceWith(tx)

    await expect(service.close('2026-08-29', {}, finance)).rejects.toBeInstanceOf(ConflictException)
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })
})
