import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { AppRole, UserStatus } from '../generated/prisma/enums.js'
import { AuthService } from './auth.service.js'

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  displayName: '测试用户',
  primaryRole: AppRole.MEMBER,
  status: UserStatus.ACTIVE,
  deletedAt: null,
  roles: [{ role: AppRole.MEMBER }],
  ...overrides,
})

const setup = (savedUser: ReturnType<typeof user> | null) => {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(savedUser),
      findUniqueOrThrow: vi.fn().mockResolvedValue(savedUser),
      findFirst: vi.fn().mockResolvedValue(savedUser),
    },
  }
  const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') }
  const config = {
    get: vi.fn((key: string, fallback?: string) => key === 'NODE_ENV' ? 'development' : fallback),
  }
  return { service: new AuthService(prisma as never, jwt as never, config as never), prisma, jwt }
}

describe('AuthService login status checks', () => {
  it.each([
    ['disabled', user({ status: UserStatus.DISABLED })],
    ['deleted status', user({ status: UserStatus.DELETED })],
    ['soft-deleted', user({ deletedAt: new Date('2026-08-30T00:00:00.000Z') })],
  ])('does not issue a dev token to a %s user', async (_label, savedUser) => {
    const { service, jwt } = setup(savedUser)

    await expect(service.devLogin({ userId: savedUser.id })).rejects.toBeInstanceOf(UnauthorizedException)
    expect(jwt.signAsync).not.toHaveBeenCalled()
  })

  it('issues current database roles for an active dev user', async () => {
    const savedUser = user({ primaryRole: AppRole.COACH, roles: [{ role: AppRole.MEMBER }] })
    const { service, jwt } = setup(savedUser)

    const result = await service.devLogin({ userId: savedUser.id })

    expect(result).toMatchObject({
      accessToken: 'signed-token',
      user: { roles: [AppRole.COACH, AppRole.MEMBER] },
    })
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({
      sub: savedUser.id,
      roles: [AppRole.COACH, AppRole.MEMBER],
    }))
  })

  it('prefers an exact primary role when switching development identities', async () => {
    const savedUser = user({
      displayName: '延庆会员小林',
      primaryRole: AppRole.MEMBER,
      roles: [{ role: AppRole.MEMBER }],
    })
    const { service, prisma } = setup(savedUser)

    const result = await service.devLogin({ role: AppRole.MEMBER })

    expect(result.user.displayName).toBe('延庆会员小林')
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1)
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { primaryRole: AppRole.MEMBER },
    }))
  })

  it('falls back to a secondary role only when no primary-role account exists', async () => {
    const eventManager = user({
      displayName: '赛事管理员',
      primaryRole: AppRole.ADMIN,
      roles: [{ role: AppRole.MEMBER }, { role: AppRole.EVENT_MANAGER }],
    })
    const { service, prisma } = setup(eventManager)
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(eventManager)

    const result = await service.devLogin({ role: AppRole.EVENT_MANAGER })

    expect(result.user.roles).toContain(AppRole.EVENT_MANAGER)
    expect(prisma.user.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { primaryRole: AppRole.EVENT_MANAGER },
    }))
    expect(prisma.user.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { roles: { some: { role: AppRole.EVENT_MANAGER } } },
    }))
  })

  it('returns a safe session DTO without persisted identity fields', async () => {
    const avatarUrl = 'https://example.test/avatar.png'
    const memberProfile = { level: 'GOLD' }
    const savedAccounts = [{ id: 'account-1', type: 'CASH_PRINCIPAL', balance: 100, frozenBalance: 0 }]
    const savedUser = user({
      referrerId: 'private-referrer-id',
      openId: 'private-open-id',
      unionId: 'private-union-id',
      phone: '13800000000',
      avatarUrl,
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
      memberProfile,
      accounts: savedAccounts,
    })
    const { service, prisma } = setup(savedUser)

    const result = await service.me(savedUser.id)

    expect(result).toMatchObject({
      id: savedUser.id,
      displayName: savedUser.displayName,
      avatarUrl,
      primaryRole: savedUser.primaryRole,
      hasReferrer: true,
      memberProfile,
      accounts: savedAccounts,
    })
    expect(result).not.toHaveProperty('referrerId')
    expect(result).not.toHaveProperty('openId')
    expect(result).not.toHaveProperty('unionId')
    expect(result).not.toHaveProperty('phone')
    expect(result).not.toHaveProperty('status')
    expect(result).not.toHaveProperty('deletedAt')
    expect(result).not.toHaveProperty('createdAt')
    const selection = prisma.user.findUniqueOrThrow.mock.calls[0]?.[0]?.select
    expect(selection).toMatchObject({
      id: true,
      displayName: true,
      roles: { select: { role: true, merchant: { select: { id: true, name: true } } } },
      accounts: { select: { id: true, type: true, balance: true, frozenBalance: true } },
    })
    for (const field of ['openId', 'unionId', 'phone', 'status', 'deletedAt', 'createdAt']) {
      expect(selection).not.toHaveProperty(field)
    }
  })
})
