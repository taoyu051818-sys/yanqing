import { describe, expect, it, vi } from 'vitest'

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, CouponStatus, ReconciliationPeriodStatus, SettlementStatus, UserStatus } from '../generated/prisma/enums.js'
import { AllianceService } from './alliance.service.js'

const finance: AuthUser = { sub: 'finance-1', displayName: '财务', roles: [AppRole.FINANCE] }
const merchant: AuthUser = { sub: 'merchant-user', displayName: '商户', roles: [AppRole.MERCHANT] }
const member: AuthUser = { sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER] }

const statement = (status: SettlementStatus = SettlementStatus.DRAFT) => ({
  id: 'statement-1',
  merchantId: 'merchant-1',
  status,
  detail: { codeIds: ['coupon-1'] },
  cooperationFeeCents: 1200,
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
})

const makeTransitionPrisma = (initial: ReturnType<typeof statement>) => {
  let current = { ...initial }
  const findUnique = vi.fn().mockImplementation(async () => ({ ...current }))
  const updateMany = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if (current.status !== data.__expectedStatus) return { count: 0 }
    const { __expectedStatus: _ignored, ...changes } = data
    current = { ...current, ...changes }
    return { count: 1 }
  })
  const findUniqueOrThrow = vi.fn().mockImplementation(async () => ({ ...current }))
  const tx = {
    allianceSettlement: { findUnique, updateMany, findUniqueOrThrow },
    reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma = {
    $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)),
    userRole: { findFirst: vi.fn().mockResolvedValue({ merchantId: 'merchant-1' }) },
    allianceSettlement: { findMany: vi.fn().mockResolvedValue([]) },
  }
  return { prisma, tx, current: () => current }
}

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx))

describe('AllianceService settlement workflow', () => {
  it('moves a statement through submit, merchant confirmation and finance settlement', async () => {
    const setup = makeTransitionPrisma(statement())
    // The conditional update uses the current status as a guard.  The test
    // adapter adds that marker so the in-memory mock behaves like Prisma.
    setup.tx.allianceSettlement.updateMany.mockImplementation(
      async ({ where, data }: { where: { status: SettlementStatus }; data: Record<string, unknown> }) => {
        if (setup.current().status !== where.status) return { count: 0 }
        Object.assign(setup.current(), data)
        return { count: 1 }
      },
    )
    const service = new AllianceService(setup.prisma as never)

    await service.submitSettlement('statement-1', finance)
    expect(setup.current().status).toBe(SettlementStatus.PENDING_CONFIRMATION)

    await service.confirmSettlement('statement-1', merchant)
    expect(setup.current().status).toBe(SettlementStatus.CONFIRMED)
    expect(setup.current().confirmedAt).toBeInstanceOf(Date)

    await service.settleSettlement('statement-1', finance)
    expect(setup.current().status).toBe(SettlementStatus.SETTLED)
    expect(setup.current().settledAt).toBeInstanceOf(Date)
    expect(setup.tx.auditLog.create).toHaveBeenCalledTimes(3)
  })

  it('is idempotent on a repeated action and rejects an out-of-order action', async () => {
    const setup = makeTransitionPrisma(statement(SettlementStatus.PENDING_CONFIRMATION))
    setup.tx.allianceSettlement.updateMany.mockImplementation(
      async ({ where, data }: { where: { status: SettlementStatus }; data: Record<string, unknown> }) => {
        if (setup.current().status !== where.status) return { count: 0 }
        Object.assign(setup.current(), data)
        return { count: 1 }
      },
    )
    const service = new AllianceService(setup.prisma as never)
    const first = await service.confirmSettlement('statement-1', merchant)
    const second = await service.confirmSettlement('statement-1', merchant)
    expect(first.status).toBe(SettlementStatus.CONFIRMED)
    expect(second.status).toBe(SettlementStatus.CONFIRMED)
    expect(setup.tx.auditLog.create).toHaveBeenCalledTimes(1)
    await expect(service.settleSettlement('statement-1', finance)).resolves.toMatchObject({
      status: SettlementStatus.SETTLED,
    })
    await expect(service.submitSettlement('statement-1', finance)).rejects.toBeInstanceOf(ConflictException)
  })

  it('requires a reason for disputes and keeps merchant data scoped', async () => {
    const setup = makeTransitionPrisma(statement(SettlementStatus.PENDING_CONFIRMATION))
    const service = new AllianceService(setup.prisma as never)
    await expect(service.disputeSettlement('statement-1', {}, merchant)).rejects.toBeInstanceOf(BadRequestException)

    setup.prisma.userRole.findFirst.mockResolvedValue(null)
    await expect(
      service.confirmSettlement('statement-1', merchant),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('treats the merchant-period tuple as an idempotency key', async () => {
    const periodStart = new Date('2026-08-01T00:00:00.000Z')
    const periodEnd = new Date('2026-09-01T00:00:00.000Z')
    const created = {
      id: 'statement-1',
      merchantId: 'merchant-1',
      periodStart,
      periodEnd,
      attributedGrossProfitCents: 5000,
      status: SettlementStatus.DRAFT,
    }
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created)
    const tx = {
      allianceSettlement: { create: vi.fn().mockResolvedValue(created) },
      reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      merchant: { findUnique: vi.fn().mockResolvedValue({ id: 'merchant-1', settlementRule: { mode: 'FIXED', feeCents: 100 } }) },
      couponCode: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findUnique },
      $transaction: runner(tx),
    }
    const service = new AllianceService(prisma as never)
    const dto = {
      merchantId: 'merchant-1',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      attributedGrossProfitCents: 5000,
    }
    const first = await service.createSettlement(dto, finance)
    const second = await service.createSettlement(dto, finance)
    expect(first).toEqual(created)
    expect(second).toEqual(created)
    expect(tx.allianceSettlement.create).toHaveBeenCalledOnce()
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('rejects creating or changing a statement that overlaps a locked business day', async () => {
    const locked = { businessDate: new Date('2026-08-14T16:00:00.000Z') }
    const setup = makeTransitionPrisma(statement())
    setup.tx.reconciliationPeriod.findFirst.mockResolvedValue(locked)
    const service = new AllianceService(setup.prisma as never)

    await expect(service.submitSettlement('statement-1', finance)).rejects.toThrow(
      '结算周期覆盖已锁账营业日',
    )
    expect(setup.tx.allianceSettlement.updateMany).not.toHaveBeenCalled()

    const periodStart = new Date('2026-08-01T00:00:00.000Z')
    const periodEnd = new Date('2026-09-01T00:00:00.000Z')
    const tx = {
      reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(locked) },
      allianceSettlement: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const createService = new AllianceService({
      merchant: { findUnique: vi.fn().mockResolvedValue({ id: 'merchant-1', settlementRule: {} }) },
      couponCode: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    } as never)
    await expect(createService.createSettlement({
      merchantId: 'merchant-1',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      attributedGrossProfitCents: 0,
    }, finance)).rejects.toThrow('结算周期覆盖已锁账营业日')
    expect(tx.allianceSettlement.create).not.toHaveBeenCalled()
    expect(ReconciliationPeriodStatus.LOCKED).toBe('LOCKED')
  })

  it('does not expose merchant contacts or settlement rules to public/merchant views', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = {
      merchant: { findMany },
      userRole: { findMany: vi.fn().mockResolvedValue([{ merchantId: 'merchant-1' }]) },
    }
    const service = new AllianceService(prisma as never)
    await service.listMerchants(member)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: UserStatus.ACTIVE },
      select: expect.not.objectContaining({ contactPhone: true, settlementRule: true }),
    }))
    await service.listMerchants(merchant)
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: { in: ['merchant-1'] } },
      select: expect.not.objectContaining({ settlementRule: true }),
    }))
  })
})

describe('AllianceService coupon claim workflow', () => {
  const couponFixture = (holderId: string | null = null) => ({
    id: 'coupon-1',
    code: 'YQ-COFFEE-1',
    templateId: 'template-1',
    status: holderId ? CouponStatus.CLAIMED : CouponStatus.ISSUED,
    holderId,
    claimedAt: holderId ? new Date() : null,
    template: {
      id: 'template-1',
      enabled: true,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      claimLimitPerUser: 1,
    },
  })

  it('increments the claim counter only for the winning transition', async () => {
    const coupon = couponFixture()
    const templateUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      couponCode: {
        findUnique: vi.fn().mockImplementation(async () => coupon),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(coupon, data)
          return { count: 1 }
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(coupon),
      },
      couponTemplate: { update: templateUpdate },
    }
    const prisma = { $transaction: runner(tx) }
    const service = new AllianceService(prisma as never)

    await expect(service.claim(coupon.code, member)).resolves.toMatchObject({ status: CouponStatus.CLAIMED, holderId: member.sub })
    expect(templateUpdate).toHaveBeenCalledOnce()
  })

  it('returns the same claim on retry without a second counter increment', async () => {
    const coupon = couponFixture(member.sub)
    const templateUpdate = vi.fn()
    const tx = {
      couponCode: {
        findUnique: vi.fn().mockResolvedValue(coupon),
        count: vi.fn().mockResolvedValue(1),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      couponTemplate: { update: templateUpdate },
    }
    const service = new AllianceService({ $transaction: runner(tx) } as never)

    await expect(service.claim(coupon.code, member)).resolves.toMatchObject({ status: CouponStatus.CLAIMED, holderId: member.sub })
    expect(templateUpdate).not.toHaveBeenCalled()
  })
})
