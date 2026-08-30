import { ConflictException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole, FrontDeskShiftStatus } from '../generated/prisma/enums.js'
import {
  auditAdminShiftBypass,
  requireOpenFrontDeskShift,
} from './frontdesk-shift-gate.js'

const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
}
const administrator: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
}

describe('front-desk shift transaction gate', () => {
  it('requires the pure front desk own MAIN shift to be open today', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'shift-open' })

    await expect(requireOpenFrontDeskShift(
      { frontDeskShift: { findFirst } } as never,
      frontDesk,
      new Date('2026-08-30T02:00:00.000Z'),
    )).resolves.toEqual({ mode: 'OPEN_SHIFT', shiftId: 'shift-open' })
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        businessDate: new Date('2026-08-29T16:00:00.000Z'),
        venueCode: 'MAIN',
        operatorId: frontDesk.sub,
        status: FrontDeskShiftStatus.OPEN,
      },
      select: { id: true },
    })
  })

  it('rejects a missing or already closed shift', async () => {
    await expect(requireOpenFrontDeskShift(
      { frontDeskShift: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      frontDesk,
    )).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects unrelated roles and records the administrator emergency bypass', async () => {
    const frontDeskShift = { findFirst: vi.fn() }
    await expect(requireOpenFrontDeskShift(
      { frontDeskShift } as never,
      { sub: 'finance-1', displayName: '财务', roles: [AppRole.FINANCE] },
    )).rejects.toBeInstanceOf(ForbiddenException)

    const authorization = await requireOpenFrontDeskShift(
      { frontDeskShift } as never,
      administrator,
    )
    expect(frontDeskShift.findFirst).not.toHaveBeenCalled()
    const auditLog = { create: vi.fn().mockResolvedValue({}) }
    await auditAdminShiftBypass(
      { auditLog } as never,
      administrator,
      authorization,
      'OFFLINE_CASH_PAYMENT',
      'Payment',
      'payment-1',
    )
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_GATE_BYPASSED',
        actorId: administrator.sub,
        objectType: 'Payment',
        objectId: 'payment-1',
      }),
    })
  })
})
