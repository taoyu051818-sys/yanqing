import { ConflictException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, HostStatus } from '../generated/prisma/enums.js'
import { GamesService } from './games.service.js'

const admin: AuthUser = { sub: 'admin-1', displayName: '管理员', roles: [AppRole.ADMIN] }
const member: AuthUser = { sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER] }

const profile = (status: HostStatus = HostStatus.APPLIED) => ({
  id: 'profile-1', userId: member.sub, status, level: 'BRONZE', appliedAt: new Date(),
  approvedAt: null, suspendedReason: null,
})

const setup = () => {
  const tx = {
    hostProfile: {
      findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(),
    },
    userRole: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  const prisma = {
    hostProfile: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  }
  return { tx, prisma, service: new GamesService(prisma as never) }
}

describe('GamesService host application review', () => {
  it('lists only pending applications with the minimal member context', async () => {
    const { service, prisma } = setup()
    await service.hostApplications()
    expect(prisma.hostProfile.findMany).toHaveBeenCalledWith({
      where: { status: HostStatus.APPLIED },
      select: expect.objectContaining({ userId: true, user: expect.any(Object) }),
      orderBy: { appliedAt: 'asc' },
    })
  })

  it('audits a new application and treats a repeated pending application as idempotent', async () => {
    const { service, prisma, tx } = setup()
    const applied = profile()
    prisma.hostProfile.findUnique.mockResolvedValueOnce(null)
    tx.hostProfile.upsert.mockResolvedValue(applied)
    await expect(service.applyHost(member)).resolves.toEqual(applied)
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'HOST_APPLIED' }) })

    prisma.hostProfile.findUnique.mockResolvedValueOnce(applied)
    await expect(service.applyHost(member)).resolves.toEqual(applied)
    expect(tx.hostProfile.upsert).toHaveBeenCalledOnce()
  })

  it('rejects a host application from a non-member before reading the profile', async () => {
    const { service, prisma } = setup()
    await expect(service.applyHost(admin)).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.hostProfile.findUnique).not.toHaveBeenCalled()
  })

  it('approves only a pending application and grants the HOST role with audit', async () => {
    const { service, tx } = setup()
    tx.hostProfile.findUnique.mockResolvedValue(profile())
    tx.hostProfile.update.mockResolvedValue(profile(HostStatus.APPROVED))
    tx.userRole.findFirst.mockResolvedValue(null)

    await expect(service.approveHost(member.sub, { reason: '服务记录良好' }, admin)).resolves.toMatchObject({ status: HostStatus.APPROVED })
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: member.sub, role: AppRole.HOST } })
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'HOST_APPROVED', reason: '服务记录良好' }) })
  })

  it('rejects a pending application with mandatory reason and removes stale HOST role', async () => {
    const { service, tx } = setup()
    tx.hostProfile.findUnique.mockResolvedValue(profile())
    tx.hostProfile.update.mockResolvedValue(profile(HostStatus.REJECTED))

    await expect(service.rejectHost(member.sub, { reason: '服务经验不足' }, admin)).resolves.toMatchObject({ status: HostStatus.REJECTED })
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: member.sub, role: AppRole.HOST } })
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'HOST_REJECTED', reason: '服务经验不足' }) })
  })

  it('rejects review attempts against a non-pending state', async () => {
    const { service, tx } = setup()
    tx.hostProfile.findUnique.mockResolvedValue(profile(HostStatus.SUSPENDED))
    await expect(service.approveHost(member.sub, {}, admin)).rejects.toBeInstanceOf(ConflictException)
    await expect(service.rejectHost(member.sub, { reason: '状态错误' }, admin)).rejects.toBeInstanceOf(ConflictException)
  })
})
