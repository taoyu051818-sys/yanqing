import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { AppRole, UserStatus } from '../../generated/prisma/enums.js'
import { JwtAuthGuard } from './jwt-auth.guard.js'
import { RolesGuard } from './roles.guard.js'

const activeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  displayName: '当前名称',
  status: UserStatus.ACTIVE,
  deletedAt: null,
  primaryRole: AppRole.MEMBER,
  roles: [{ role: AppRole.MEMBER }],
  ...overrides,
})

const requestContext = (request: Record<string, unknown>) => ({
  getHandler: () => requestContext,
  getClass: () => JwtAuthGuard,
  switchToHttp: () => ({ getRequest: () => request }),
}) as unknown as ExecutionContext

const setup = (options: {
  publicRoute?: boolean
  claims?: Record<string, unknown>
  user?: ReturnType<typeof activeUser> | null
} = {}) => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(options.publicRoute ?? false),
  }
  const jwt = {
    verifyAsync: vi.fn().mockResolvedValue(options.claims ?? {
      sub: 'user-1',
      displayName: '过期名称',
      roles: [AppRole.ADMIN],
    }),
  }
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(options.user === undefined ? activeUser() : options.user) },
  }
  return {
    guard: new JwtAuthGuard(jwt as never, reflector as never, prisma as never),
    jwt,
    prisma,
    reflector,
  }
}

describe('JwtAuthGuard live identity validation', () => {
  it('keeps public routes database-free', async () => {
    const { guard, jwt, prisma } = setup({ publicRoute: true })

    await expect(guard.canActivate(requestContext({ headers: {} }))).resolves.toBe(true)
    expect(jwt.verifyAsync).not.toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('requires and verifies a bearer token before reading identity state', async () => {
    const missing = setup()
    await expect(missing.guard.canActivate(requestContext({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException)
    expect(missing.prisma.user.findUnique).not.toHaveBeenCalled()

    const invalid = setup()
    invalid.jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'))
    await expect(
      invalid.guard.canActivate(requestContext({ headers: { authorization: 'Bearer broken' } })),
    ).rejects.toThrow('登录凭证无效或已过期')
    expect(invalid.prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a signed token without a valid subject', async () => {
    const { guard, prisma } = setup({ claims: { roles: [AppRole.ADMIN] } })

    await expect(
      guard.canActivate(requestContext({ headers: { authorization: 'Bearer valid' } })),
    ).rejects.toThrow('登录凭证缺少用户标识')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('replaces stale token roles and display name with the current database snapshot', async () => {
    const { guard, prisma } = setup({
      user: activeUser({
        displayName: '数据库名称',
        primaryRole: AppRole.MEMBER,
        roles: [{ role: AppRole.MEMBER }, { role: AppRole.COACH }, { role: AppRole.COACH }],
      }),
    })
    const request: Record<string, any> = { headers: { authorization: 'Bearer valid' } }

    await expect(guard.canActivate(requestContext(request))).resolves.toBe(true)
    expect(request.user).toEqual({
      sub: 'user-1',
      displayName: '数据库名称',
      roles: [AppRole.MEMBER, AppRole.COACH],
    })
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: expect.objectContaining({ status: true, deletedAt: true, primaryRole: true, roles: expect.any(Object) }),
    })
  })

  it('makes role revocation effective for the following role check despite an old admin token', async () => {
    const { guard } = setup({ user: activeUser() })
    const request: Record<string, any> = { headers: { authorization: 'Bearer old-admin-token' } }
    const context = requestContext(request)
    await guard.canActivate(context)

    const rolesGuard = new RolesGuard({ getAllAndOverride: () => [AppRole.ADMIN] } as never)
    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException)
  })

  it.each([
    ['missing', null],
    ['disabled', activeUser({ status: UserStatus.DISABLED })],
    ['soft-deleted', activeUser({ deletedAt: new Date('2026-08-30T00:00:00.000Z') })],
    ['deleted status', activeUser({ status: UserStatus.DELETED })],
  ])('rejects a %s user immediately', async (_label, user) => {
    const { guard } = setup({ user })
    await expect(
      guard.canActivate(requestContext({ headers: { authorization: 'Bearer valid' } })),
    ).rejects.toThrow('用户不存在、已停用或已删除')
  })

  it('does not disguise a database outage as a bad token', async () => {
    const { guard, prisma } = setup()
    prisma.user.findUnique.mockRejectedValue(new Error('database unavailable'))

    await expect(
      guard.canActivate(requestContext({ headers: { authorization: 'Bearer valid' } })),
    ).rejects.toThrow('database unavailable')
  })
})
