import { describe, expect, it, vi } from 'vitest'

import { BadRequestException, ConflictException } from '@nestjs/common'

import type { AuthUser } from '../auth/auth-user.js'
import { AppRole } from '../../generated/prisma/client.js'
import { assertOperationTimeWindow } from './operation-time-window.js'

const member: AuthUser = {
  sub: 'operator-1',
  displayName: '操作员',
  roles: [AppRole.FRONT_DESK],
}
const admin: AuthUser = {
  ...member,
  sub: 'admin-1',
  roles: [AppRole.ADMIN],
}
const base = {
  parameterKey: 'operations.test_window.v1',
  defaults: { earlyMinutes: 30, lateMinutes: 30 },
  scheduledStartsAt: new Date('2026-08-30T10:00:00.000Z'),
  scheduledEndsAt: new Date('2026-08-30T10:00:00.000Z'),
  action: 'TEST_CHECK_IN',
  objectType: 'TestObject',
  objectId: 'object-1',
}

describe('operation time window', () => {
  it('uses the effective versioned parameter and returns its audit snapshot', async () => {
    const tx = {
      systemParameter: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'parameter-1',
          value: { version: 1, earlyMinutes: 15, lateMinutes: 20 },
        }),
      },
      auditLog: { create: vi.fn() },
    }

    await expect(assertOperationTimeWindow(tx as never, {
      ...base,
      actor: member,
      observedAt: new Date('2026-08-30T09:50:00.000Z'),
    })).resolves.toMatchObject({
      parameterId: 'parameter-1',
      parameterSource: 'SYSTEM_PARAMETER',
      earlyMinutes: 15,
      lateMinutes: 20,
      decision: 'IN_WINDOW',
    })
  })

  it('never permits an early operation, including for an administrator', async () => {
    const tx = { auditLog: { create: vi.fn() } }
    await expect(assertOperationTimeWindow(tx as never, {
      ...base,
      actor: admin,
      overrideReason: '管理员提前处理',
      observedAt: new Date('2026-08-30T09:00:00.000Z'),
    })).rejects.toBeInstanceOf(ConflictException)
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it('falls back to the safe default when a parameter tries to open a year-long window', async () => {
    const tx = {
      systemParameter: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'unsafe-parameter',
          value: { version: 1, earlyMinutes: 525_600, lateMinutes: 525_600 },
        }),
      },
      auditLog: { create: vi.fn() },
    }

    await expect(assertOperationTimeWindow(tx as never, {
      ...base,
      actor: member,
      observedAt: new Date('2026-08-30T09:45:00.000Z'),
    })).resolves.toMatchObject({
      parameterId: 'unsafe-parameter',
      parameterSource: 'DEFAULT_INVALID_PARAMETER',
      earlyMinutes: 30,
      lateMinutes: 30,
    })
  })

  it('requires a reason and separate audit for an administrator historical override', async () => {
    const tx = { auditLog: { create: vi.fn().mockResolvedValue({}) } }
    await expect(assertOperationTimeWindow(tx as never, {
      ...base,
      actor: admin,
      observedAt: new Date('2026-08-30T11:00:00.000Z'),
    })).rejects.toBeInstanceOf(BadRequestException)

    await expect(assertOperationTimeWindow(tx as never, {
      ...base,
      actor: admin,
      overrideReason: '补录纸质签到表',
      observedAt: new Date('2026-08-30T11:00:00.000Z'),
    })).resolves.toMatchObject({ decision: 'ADMIN_HISTORICAL_OVERRIDE' })
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'TEST_CHECK_IN_HISTORICAL_OVERRIDE',
        reason: '补录纸质签到表',
      }),
    })
  })

  it('does not let a non-admin create a late historical record', async () => {
    await expect(assertOperationTimeWindow({ auditLog: { create: vi.fn() } } as never, {
      ...base,
      actor: member,
      observedAt: new Date('2026-08-30T11:00:00.000Z'),
    })).rejects.toBeInstanceOf(ConflictException)
  })
})
