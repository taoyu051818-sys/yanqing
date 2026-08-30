import { ConflictException, ForbiddenException } from '@nestjs/common'

import type { AuthUser } from '../common/auth/auth-user.js'
import {
  AppRole,
  FrontDeskShiftStatus,
  type Prisma,
} from '../generated/prisma/client.js'

export const MAIN_VENUE_CODE = 'MAIN'

export interface BusinessDay {
  label: string
  start: Date
  end: Date
}

export type FrontDeskShiftAuthorization =
  | { mode: 'OPEN_SHIFT'; shiftId: string }
  | { mode: 'ADMIN_BYPASS'; shiftId: null }

type ShiftGateClient = Pick<Prisma.TransactionClient, 'frontDeskShift'>
type ShiftGateAuditClient = Pick<Prisma.TransactionClient, 'auditLog'>

export function shanghaiBusinessDay(now = new Date()): BusinessDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const label = `${values.year}-${values.month}-${values.day}`
  const start = new Date(`${label}T00:00:00+08:00`)
  return { label, start, end: new Date(start.getTime() + 86_400_000) }
}

export function isFrontDeskShiftAdministrator(actor: AuthUser): boolean {
  return actor.roles.some((role) =>
    [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
  )
}

export function isShiftBoundFrontDesk(actor: AuthUser): boolean {
  return actor.roles.includes(AppRole.FRONT_DESK) && !isFrontDeskShiftAdministrator(actor)
}

/**
 * Authorise an operator-only action at the same transaction boundary as the
 * business mutation. Administrators are an explicit emergency path; callers
 * must persist the returned bypass evidence in the same transaction.
 */
export async function requireOpenFrontDeskShift(
  tx: ShiftGateClient,
  actor: AuthUser,
  now = new Date(),
): Promise<FrontDeskShiftAuthorization> {
  if (isFrontDeskShiftAdministrator(actor)) {
    return { mode: 'ADMIN_BYPASS', shiftId: null }
  }
  if (!isShiftBoundFrontDesk(actor)) {
    throw new ForbiddenException('仅已开班前台或管理员可执行该操作')
  }
  const day = shanghaiBusinessDay(now)
  const shift = await tx.frontDeskShift.findFirst({
    where: {
      businessDate: day.start,
      venueCode: MAIN_VENUE_CODE,
      operatorId: actor.sub,
      status: FrontDeskShiftStatus.OPEN,
    },
    select: { id: true },
  })
  if (!shift) {
    throw new ConflictException('当前前台未开班或今日班次已关闭，请先开班')
  }
  return { mode: 'OPEN_SHIFT', shiftId: shift.id }
}

export async function auditAdminShiftBypass(
  tx: ShiftGateAuditClient,
  actor: AuthUser,
  authorization: FrontDeskShiftAuthorization,
  operation: string,
  objectType: string,
  objectId: string,
): Promise<void> {
  if (authorization.mode !== 'ADMIN_BYPASS') return
  await tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: actor.roles.includes(AppRole.SUPER_ADMIN)
        ? AppRole.SUPER_ADMIN
        : AppRole.ADMIN,
      action: 'FRONT_DESK_SHIFT_GATE_BYPASSED',
      objectType,
      objectId,
      reason: '管理员应急操作',
      newValue: {
        operation,
        venueCode: MAIN_VENUE_CODE,
        shiftRequired: false,
        emergencyBypass: true,
      } as never,
    },
  })
}
