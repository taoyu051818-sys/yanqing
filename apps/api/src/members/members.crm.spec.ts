import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, LeadStatus, SourceChannel } from '../generated/prisma/enums.js'
import { MembersService } from './members.service.js'

const frontDesk: AuthUser = { sub: 'frontdesk-1', displayName: '前台', roles: [AppRole.FRONT_DESK] }
const coach: AuthUser = { sub: 'coach-1', displayName: '教练', roles: [AppRole.COACH] }

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
    leadFollowUp: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma: Record<string, any> = {
    customerLead: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: { findUnique: vi.fn() },
    trainingEnrollment: { findFirst: vi.fn() },
    $transaction: vi.fn(async (work: any) => Array.isArray(work) ? Promise.all(work) : work(tx)),
  }
  return { prisma, tx, service: new MembersService(prisma as never) }
}

describe('MembersService customer leads', () => {
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
