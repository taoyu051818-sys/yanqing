import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { ROLES_KEY } from '../common/auth/auth.decorators.js'
import { AppRole } from '../generated/prisma/enums.js'
import { PrivacyController } from './privacy.controller.js'

const member: AuthUser = { sub: 'member-1', displayName: '会员', roles: [AppRole.MEMBER] }
const admin: AuthUser = { sub: 'admin-1', displayName: '管理员', roles: [AppRole.SUPER_ADMIN] }

describe('PrivacyController', () => {
  it('always binds self-service creation and cancellation to the authenticated actor', async () => {
    const privacy = {
      create: vi.fn().mockResolvedValue({ id: 'request-1' }),
      cancel: vi.fn().mockResolvedValue({ id: 'request-1', status: 'CANCELLED' }),
    }
    const controller = new PrivacyController(privacy as never)
    const create = { reason: '不再使用', idempotencyKey: 'privacy-request-0001' }
    const cancel = { reason: '决定继续使用', idempotencyKey: 'privacy-cancel-0001' }

    await controller.request(create, member)
    await controller.cancel('request-1', cancel, member)

    expect(privacy.create).toHaveBeenCalledWith(create, member)
    expect(privacy.cancel).toHaveBeenCalledWith('request-1', cancel, member)
  })

  it('restricts irreversible decisions to super admins and keeps listing read-only for admins', async () => {
    const privacy = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      complete: vi.fn().mockResolvedValue({ id: 'request-1', status: 'COMPLETED' }),
    }
    const controller = new PrivacyController(privacy as never)
    const query = { page: 1, pageSize: 20 }
    const decision = { reason: '业务已全部结清', idempotencyKey: 'privacy-complete-0001' }

    await controller.list(query, admin)
    await controller.complete('request-1', decision, admin)

    expect(privacy.list).toHaveBeenCalledWith(query, admin)
    expect(privacy.complete).toHaveBeenCalledWith('request-1', decision, admin)
    expect(Reflect.getMetadata(ROLES_KEY, PrivacyController.prototype.list)).toEqual([
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ])
    expect(Reflect.getMetadata(ROLES_KEY, PrivacyController.prototype.complete)).toEqual([
      AppRole.SUPER_ADMIN,
    ])
    expect(Reflect.getMetadata(ROLES_KEY, PrivacyController.prototype.reject)).toEqual([
      AppRole.SUPER_ADMIN,
    ])
  })
})
