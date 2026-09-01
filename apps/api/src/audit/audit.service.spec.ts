import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { AuditService } from './audit.service.js'

const actor = (role: AppRole): AuthUser => ({
  sub: `${role.toLowerCase()}-1`,
  displayName: role,
  roles: [role],
})

function fixture() {
  const findMany = vi.fn().mockResolvedValue([])
  const count = vi.fn().mockResolvedValue(0)
  const prisma = {
    $transaction: vi.fn(async (callback: any) =>
      callback({ auditLog: { findMany, count } }),
    ),
  }
  return { service: new AuditService(prisma as never), findMany, count }
}

describe('AuditService role projection', () => {
  it('limits finance to finance object types and omits raw before/after and device fields', async () => {
    const { service, findMany, count } = fixture()

    await service.list({ page: 1, pageSize: 20 }, actor(AppRole.FINANCE))

    const query = findMany.mock.calls[0][0]
    expect(query.where.objectType.in).toContain('Refund')
    expect(query.where.objectType.in).not.toContain('SystemParameter')
    expect(query.select).toBeDefined()
    expect(query.select.oldValue).toBeUndefined()
    expect(query.select.newValue).toBeUndefined()
    expect(query.select.ip).toBeUndefined()
    expect(query.select.deviceInfo).toBeUndefined()
    expect(count).toHaveBeenCalledWith({ where: query.where })
  })

  it('rejects a finance query for governance-only object types', () => {
    const { service } = fixture()

    expect(() =>
      service.list(
        { page: 1, pageSize: 20, objectType: 'SystemParameter' },
        actor(AppRole.FINANCE),
      ),
    ).toThrow(ForbiddenException)
  })

  it('keeps the full evidence record available to administrators', async () => {
    const { service, findMany } = fixture()

    await service.list(
      { page: 1, pageSize: 20, objectType: 'SystemParameter' },
      actor(AppRole.ADMIN),
    )

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { objectType: 'SystemParameter' },
        include: { actor: { select: { id: true, displayName: true } } },
      }),
    )
  })

  it('defends the service from unrelated roles even when called directly', () => {
    const { service } = fixture()

    expect(() =>
      service.list({ page: 1, pageSize: 20 }, actor(AppRole.MEMBER)),
    ).toThrow(ForbiddenException)
  })
})
