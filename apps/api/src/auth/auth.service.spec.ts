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
})
