import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AccountType, AppRole, BusinessType, LeadStatus, OrderStatus, SourceChannel } from '../generated/prisma/enums.js'
import { MembersService } from './members.service.js'

const frontDesk: AuthUser = { sub: 'frontdesk-1', displayName: '前台', roles: [AppRole.FRONT_DESK] }
const coach: AuthUser = { sub: 'coach-1', displayName: '教练', roles: [AppRole.COACH] }
const finance: AuthUser = { sub: 'finance-1', displayName: '财务', roles: [AppRole.FINANCE] }
const admin: AuthUser = { sub: 'admin-1', displayName: '管理员', roles: [AppRole.ADMIN] }
const memberActor: AuthUser = { sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER] }

const lead = (overrides: Record<string, unknown> = {}) => ({
  id: 'lead-1',
  displayName: '体验客户',
  phone: '13812345678',
  status: LeadStatus.NEW,
  sourceChannel: SourceChannel.DOUYIN,
  campaign: '周末体验课',
  referrerId: null,
  ownerId: null,
  convertedMemberId: null,
  createdById: frontDesk.sub,
  nextFollowUpAt: null,
  slaDueAt: new Date('2099-01-01T00:00:00.000Z'),
  convertedAt: null,
  lostAt: null,
  archivedAt: null,
  lostReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

const makePrisma = () => {
  const tx: Record<string, any> = {
    customerLead: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    memberProfile: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    leadFollowUp: { create: vi.fn() },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma: Record<string, any> = {
    customerLead: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    memberProfile: { findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    trainingEnrollment: { findFirst: vi.fn() },
    $transaction: vi.fn(async (work: any) => Array.isArray(work) ? Promise.all(work) : work(tx)),
  }
  return { prisma, tx, service: new MembersService(prisma as never) }
}

describe('MembersService customer leads', () => {
  it('builds an anonymous source/campaign funnel through paid and training conversion', async () => {
    const { prisma, service } = makePrisma()
    const periodStart = new Date('2026-08-01T00:00:00.000Z')
    const periodEnd = new Date('2026-09-01T00:00:00.000Z')
    prisma.memberProfile.findMany.mockResolvedValue([{
      userId: 'member-1',
      sourceChannel: SourceChannel.MINI_PROGRAM,
      createdAt: new Date('2026-08-03T00:00:00.000Z'),
      firstVisitAt: new Date('2026-08-06T00:00:00.000Z'),
    }])
    prisma.order.findMany.mockResolvedValue([
      {
        memberId: 'member-1', sourceChannel: SourceChannel.MINI_PROGRAM,
        businessType: BusinessType.VENUE, status: OrderStatus.COMPLETED,
        paidCents: 8_800, refundedCents: 0,
      },
      {
        memberId: 'member-1', sourceChannel: SourceChannel.MINI_PROGRAM,
        businessType: BusinessType.TRAINING, status: OrderStatus.PAID,
        paidCents: 128_000, refundedCents: 8_000,
      },
    ])
    prisma.customerLead.findMany.mockResolvedValue([{
      sourceChannel: SourceChannel.DOUYIN,
      campaign: '暑期体验',
      status: LeadStatus.CONVERTED,
      convertedMemberId: 'member-1',
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      convertedAt: new Date('2026-08-06T00:00:00.000Z'),
      followUps: [
        { statusAfter: LeadStatus.CONTACTING },
        { statusAfter: LeadStatus.TRIAL_RESERVED },
        { statusAfter: LeadStatus.ATTENDED },
      ],
    }])

    const result = await service.leadFunnel({
      from: periodStart.toISOString(),
      to: periodEnd.toISOString(),
    })

    expect(result.privacy).toBe('AGGREGATED_NO_PII')
    expect(result.sources).toEqual([expect.objectContaining({
      sourceChannel: SourceChannel.DOUYIN,
      leads: 1,
      contacted: 1,
      trialReserved: 1,
      attended: 1,
      converted: 1,
      registeredMembers: 1,
      firstVisits: 1,
      payingCustomers: 1,
      paidOrders: 2,
      netGmvCents: 128_800,
      trainingCustomers: 1,
      trainingNetGmvCents: 120_000,
      leadToPaidRate: 100,
    })])
    expect(result.campaigns).toEqual([expect.objectContaining({
      sourceChannel: SourceChannel.DOUYIN,
      campaign: '暑期体验',
      netGmvCents: 128_800,
    })])
    expect(JSON.stringify(result)).not.toContain('member-1')
    expect(JSON.stringify(result)).not.toContain('138')
  })

  it('scopes coach lists to assigned or class-related leads and hides phone data', async () => {
    const { prisma, service } = makePrisma()
    prisma.customerLead.findMany.mockResolvedValue([{ ...lead(), owner: null, referrer: null, convertedMember: null, followUps: [] }])
    prisma.customerLead.count.mockResolvedValue(1)

    const result = await service.listLeads({ page: 1, pageSize: 20, keyword: '体验' }, coach)

    expect(result.items[0].phone).toBe('已登记（教练不可见）')
    const where = prisma.customerLead.findMany.mock.calls[0][0].where
    expect(JSON.stringify(where)).toContain('coach-1')
    expect(JSON.stringify(where)).not.toContain('"phone"')
  })

  it('rejects coach write attempts at the service boundary', async () => {
    const { service, tx } = makePrisma()
    await expect(service.createLead({
      displayName: '客户', sourceChannel: SourceChannel.STORE_VISIT,
    }, coach)).rejects.toBeInstanceOf(ForbiddenException)
    expect(tx.customerLead.create).not.toHaveBeenCalled()
  })

  it('creates a lead and its audit record atomically', async () => {
    const { service, tx } = makePrisma()
    const created = lead()
    tx.customerLead.create.mockResolvedValue(created)

    const result = await service.createLead({
      displayName: ' 体验客户 ', sourceChannel: SourceChannel.DOUYIN, campaign: ' 周末体验课 ',
    }, frontDesk)

    expect(result).toEqual(created)
    expect(tx.customerLead.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      displayName: '体验客户', campaign: '周末体验课', createdById: frontDesk.sub,
    }) })
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'CUSTOMER_LEAD_CREATED', objectId: created.id,
    }) })
  })

  it('appends an immutable follow-up and advances the state with a guarded update', async () => {
    const { service, tx } = makePrisma()
    const current = lead({ status: LeadStatus.CONTACTING })
    tx.customerLead.findUnique.mockResolvedValue(current)
    tx.customerLead.updateMany.mockResolvedValue({ count: 1 })
    tx.leadFollowUp.create.mockResolvedValue({ id: 'follow-up-1' })

    const result = await service.addLeadFollowUp(current.id, {
      kind: 'WECHAT', content: '已约周六体验课', nextStatus: LeadStatus.TRIAL_RESERVED,
    }, frontDesk)

    expect(result).toEqual({ id: 'follow-up-1' })
    expect(tx.customerLead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: current.id, status: LeadStatus.CONTACTING },
      data: expect.objectContaining({ status: LeadStatus.TRIAL_RESERVED }),
    }))
    expect(tx.leadFollowUp.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      statusBefore: LeadStatus.CONTACTING, statusAfter: LeadStatus.TRIAL_RESERVED,
    }) })
    expect(tx.auditLog.create).toHaveBeenCalledOnce()
  })

  it('does not allow follow-up state regression or terminal shortcuts', async () => {
    const { service, tx } = makePrisma()
    tx.customerLead.findUnique.mockResolvedValue(lead({ status: LeadStatus.ATTENDED }))

    await expect(service.addLeadFollowUp('lead-1', {
      kind: 'CALL', content: '错误回退', nextStatus: LeadStatus.CONTACTING,
    }, frontDesk)).rejects.toBeInstanceOf(ConflictException)
    expect(tx.leadFollowUp.create).not.toHaveBeenCalled()
  })

  it('converts only to an existing member and records the linked member id', async () => {
    const { service, tx } = makePrisma()
    tx.customerLead.findUnique.mockResolvedValue(lead({ status: LeadStatus.ATTENDED }))
    tx.user.findUnique.mockResolvedValue({ id: 'member-1', memberProfile: { id: 'profile-1' } })
    tx.customerLead.updateMany.mockResolvedValue({ count: 1 })
    tx.customerLead.findUniqueOrThrow.mockResolvedValue(lead({ status: LeadStatus.CONVERTED, convertedMemberId: 'member-1' }))

    const result = await service.convertLead('lead-1', { memberId: 'member-1' }, frontDesk)

    expect(result).toMatchObject({ status: LeadStatus.CONVERTED, convertedMemberId: 'member-1' })
    expect(tx.customerLead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: LeadStatus.CONVERTED, convertedMemberId: 'member-1' }),
    }))
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CUSTOMER_LEAD_CONVERTED' }) })
  })

  it('rejects conversion to a user without a member profile', async () => {
    const { service, tx } = makePrisma()
    tx.customerLead.findUnique.mockResolvedValue(lead({ status: LeadStatus.ATTENDED }))
    tx.user.findUnique.mockResolvedValue({ id: 'staff-1', memberProfile: null })

    await expect(service.convertLead('lead-1', { memberId: 'staff-1' }, frontDesk)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('MembersService customer 360 privacy', () => {
  const accounts = [
    { id: 'cash', type: AccountType.CASH_PRINCIPAL, balance: 10_000, frozenBalance: 0 },
    { id: 'gift', type: AccountType.GIFT_BALANCE, balance: 2_000, frozenBalance: 0 },
    { id: 'coin', type: AccountType.BADMINTON_COIN, balance: 50, frozenBalance: 0 },
    { id: 'event', type: AccountType.EVENT_POINTS, balance: 126, frozenBalance: 0 },
    { id: 'growth', type: AccountType.GROWTH_POINTS, balance: 860, frozenBalance: 0 },
  ]
  const customerFixture = () => ({
    id: 'member-1',
    displayName: '会员',
    avatarUrl: null,
    phone: '13812345678',
    status: 'ACTIVE',
    createdAt: new Date(),
    memberProfile: { level: 'GOLD' },
    referrer: null,
    accounts,
    memberOrders: [],
    trainingPurchases: [],
    gameRegistrations: [],
    eventCaptains: [],
    couponHoldings: [],
  })

  it('returns a whitelisted directory with masked phones and no account or WeChat identifiers to front desk', async () => {
    const { prisma, service } = makePrisma()
    prisma.user.findMany.mockResolvedValue([{
      id: 'member-1', displayName: '会员', avatarUrl: null, phone: '13812345678',
      status: 'ACTIVE', createdAt: new Date(), memberProfile: { level: 'GOLD' },
    }])
    prisma.user.count.mockResolvedValue(1)

    const result = await service.list({ page: 1, pageSize: 20 }, frontDesk)

    expect(result.items[0]).toMatchObject({ phone: '138****5678', privacyScope: 'FRONT_DESK_LIMITED' })
    const query = prisma.user.findMany.mock.calls[0][0]
    expect(query.include).toBeUndefined()
    expect(query.select.accounts).toBeUndefined()
    expect(query.select.openId).toBeUndefined()
    expect(query.select.unionId).toBeUndefined()
  })

  it('denies member directory and profile access at the service boundary', async () => {
    const { prisma, service } = makePrisma()

    await expect(service.list({ page: 1, pageSize: 20 }, memberActor)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.profile('member-2', memberActor)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it('limits front desk customer360 to masked identity and payment-usable accounts', async () => {
    const { prisma, service } = makePrisma()
    prisma.user.findUnique.mockResolvedValue(customerFixture())

    const result = await service.customer360('member-1', frontDesk)

    expect(result).toMatchObject({
      member: { phone: '138****5678' },
      privacyScope: 'FRONT_DESK_LIMITED',
      financialsRedacted: true,
      accountTypesLimited: true,
      accounts: [],
      paymentSummary: {
        storedValueAvailableCents: 12_000,
        badmintonCoinAvailable: 50,
      },
    })
    const select = prisma.user.findUnique.mock.calls[0][0].select
    expect(select.accounts.where.type.in).toEqual([
      AccountType.CASH_PRINCIPAL,
      AccountType.GIFT_BALANCE,
      AccountType.BADMINTON_COIN,
    ])
    expect(select.memberOrders.select.paidCents).toBeUndefined()
    expect(select.trainingPurchases.select.prepaidBalanceCents).toBeUndefined()
    expect(select.eventCaptains.select.eventPointsAwarded).toBeUndefined()
    expect(select.referrer.select).toEqual({ displayName: true })
    expect(JSON.stringify(result)).not.toContain('13812345678')
    expect(JSON.stringify(result)).not.toContain(AccountType.CASH_PRINCIPAL)
    expect(JSON.stringify(result)).not.toContain(AccountType.GIFT_BALANCE)
    expect(JSON.stringify(result)).not.toContain(AccountType.EVENT_POINTS)
    expect(JSON.stringify(result)).not.toContain(AccountType.GROWTH_POINTS)
  })

  it('keeps all account types for finance while masking unnecessary phone PII', async () => {
    const { prisma, service } = makePrisma()
    prisma.user.findUnique.mockResolvedValue(customerFixture())

    const result = await service.customer360('member-1', finance)

    expect(result.member.phone).toBe('138****5678')
    expect(result.privacyScope).toBe('FINANCE')
    expect(result.accountTypesLimited).toBe(false)
    expect(result.accounts.map((account) => account.type)).toEqual(accounts.map((account) => account.type))
  })

  it('keeps full phone and account scope only for administrators', async () => {
    const { prisma, service } = makePrisma()
    prisma.user.findUnique.mockResolvedValue(customerFixture())

    const result = await service.customer360('member-1', admin)

    expect(result.member.phone).toBe('13812345678')
    expect(result.privacyScope).toBe('ADMIN')
    expect(result.accounts).toHaveLength(5)
  })

  it('applies the same whitelist to the legacy profile route', async () => {
    const { prisma, service } = makePrisma()
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'member-1', displayName: '会员', avatarUrl: null, phone: '13812345678',
      status: 'ACTIVE', primaryRole: AppRole.MEMBER, createdAt: new Date(), updatedAt: new Date(),
      memberProfile: { level: 'GOLD' }, accounts: accounts.slice(0, 3), guardianStudents: [], referrer: null,
    })

    const result = await service.profile('member-1', frontDesk)

    expect(result).toMatchObject({
      phone: '138****5678',
      privacyScope: 'FRONT_DESK_LIMITED',
      accountTypesLimited: true,
      accounts: [],
      paymentSummary: { storedValueAvailableCents: 12_000, badmintonCoinAvailable: 50 },
    })
    const select = prisma.user.findUniqueOrThrow.mock.calls[0][0].select
    expect(select.openId).toBeUndefined()
    expect(select.unionId).toBeUndefined()
    expect(select.accounts.where.type.in).toEqual([
      AccountType.CASH_PRINCIPAL,
      AccountType.GIFT_BALANCE,
      AccountType.BADMINTON_COIN,
    ])
    expect(select.referrer.select).toEqual({ displayName: true })
  })

  it('returns only assigned training context to a coach', async () => {
    const { prisma, service } = makePrisma()
    prisma.trainingEnrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' })
    prisma.user.findUnique.mockResolvedValue({
      id: 'member-1', displayName: '会员', avatarUrl: null, memberProfile: { level: 'GOLD' },
      trainingPurchases: [{ id: 'enrollment-1', consumedSessions: 2 }],
    })

    const result = await service.customer360('member-1', coach)

    expect(result).toMatchObject({ financialsRedacted: true, accounts: [], recentOrders: [], recentGames: [] })
    expect(result.member.phone).toBeNull()
    expect(result.recentTraining).toHaveLength(1)
    expect(prisma.trainingEnrollment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ class: { OR: [{ coachId: coach.sub }, { assistantId: coach.sub }] } }),
    }))
  })

  it('denies a coach access to unrelated members', async () => {
    const { prisma, service } = makePrisma()
    prisma.trainingEnrollment.findFirst.mockResolvedValue(null)
    await expect(service.customer360('member-2', coach)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
