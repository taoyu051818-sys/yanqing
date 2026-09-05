import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import { ROLES_KEY } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { GamesController } from './games.controller.js'

describe('GamesController management list', () => {
  it('passes the authenticated member to the public list projection', async () => {
    const list = vi.fn().mockResolvedValue([])
    const controller = new GamesController({ list } as never)
    const actor: AuthUser = {
      sub: 'member-1',
      displayName: '会员',
      roles: [AppRole.MEMBER],
    }

    await controller.list(actor)

    expect(list).toHaveBeenCalledWith(actor)
  })

  it('only exposes the management route to hosts and administrators', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, GamesController.prototype.managed),
    ).toEqual([AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN])
  })

  it('passes the authenticated actor to the scoped service query', async () => {
    const managed = vi.fn().mockResolvedValue([])
    const controller = new GamesController({ managed } as never)
    const actor: AuthUser = {
      sub: 'admin-1',
      displayName: '管理员',
      roles: [AppRole.ADMIN],
    }

    await controller.managed(actor)

    expect(managed).toHaveBeenCalledWith(actor)
  })

  it('does not authorize finance to promote a game waitlist', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        GamesController.prototype.promoteWaitlist,
      ),
    ).toEqual([
      AppRole.HOST,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ])
  })
})
