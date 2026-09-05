import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth-user.js'
import { AppRole, type Prisma } from '../../generated/prisma/client.js'

export const VENUE_CHECK_IN_WINDOW_PARAMETER =
  'operations.venue_check_in_window.v1'
export const GAME_CHECK_IN_WINDOW_PARAMETER =
  'operations.game_check_in_window.v1'
export const EVENT_CHECK_IN_WINDOW_PARAMETER =
  'operations.event_check_in_window.v1'
export const TRAINING_ATTENDANCE_WINDOW_PARAMETER =
  'training.attendance_window.v1'
export const TRAINING_COMPLETION_WINDOW_PARAMETER =
  'training.completion_window.v1'

export interface OperationWindowDefaults {
  earlyMinutes: number
  lateMinutes: number
}

export interface OperationTimeWindowSnapshot {
  parameterKey: string
  parameterVersion: 1
  parameterId: string | null
  parameterSource: 'SYSTEM_PARAMETER' | 'DEFAULT' | 'DEFAULT_INVALID_PARAMETER'
  earlyMinutes: number
  lateMinutes: number
  windowStartsAt: string
  windowEndsAt: string
  observedAt: string
  decision: 'IN_WINDOW' | 'ADMIN_HISTORICAL_OVERRIDE'
}

interface OperationTimeWindowInput {
  actor: AuthUser
  parameterKey: string
  defaults: OperationWindowDefaults
  scheduledStartsAt: Date
  scheduledEndsAt: Date
  action: string
  objectType: string
  objectId: string
  overrideReason?: string
  observedAt?: Date
}

export interface EffectiveOperationWindowConfiguration {
  parameterId: string | null
  parameterSource: 'SYSTEM_PARAMETER' | 'DEFAULT' | 'DEFAULT_INVALID_PARAMETER'
  earlyMinutes: number
  lateMinutes: number
}

const configuredMinutes = (
  value: unknown,
  field: 'earlyMinutes' | 'lateMinutes',
): number | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = (value as Record<string, unknown>)[field]
  return Number.isInteger(candidate) && Number(candidate) >= 0 && Number(candidate) <= 240
    ? Number(candidate)
    : null
}

export async function resolveOperationWindowConfiguration(
  store: unknown,
  parameterKey: string,
  defaults: OperationWindowDefaults,
  observedAt = new Date(),
): Promise<EffectiveOperationWindowConfiguration> {
  const parameterDelegate = (
    store as {
      systemParameter?: {
        findFirst?: (query: Record<string, unknown>) => PromiseLike<{
          id: string
          value: unknown
        } | null>
      }
    }
  ).systemParameter
  const parameter = parameterDelegate?.findFirst
    ? await parameterDelegate.findFirst({
        where: {
          key: parameterKey,
          effectiveFrom: { lte: observedAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: observedAt } }],
        },
        orderBy: { effectiveFrom: 'desc' },
        select: { id: true, value: true },
      })
    : null
  const configuredEarly = configuredMinutes(parameter?.value, 'earlyMinutes')
  const configuredLate = configuredMinutes(parameter?.value, 'lateMinutes')
  const configuredVersion =
    parameter?.value &&
    typeof parameter.value === 'object' &&
    !Array.isArray(parameter.value)
      ? (parameter.value as Record<string, unknown>).version
      : null
  const configurationValid =
    configuredVersion === 1 &&
    configuredEarly !== null &&
    configuredLate !== null
  return {
    parameterId: parameter?.id ?? null,
    parameterSource: parameter
      ? configurationValid
        ? 'SYSTEM_PARAMETER'
        : 'DEFAULT_INVALID_PARAMETER'
      : 'DEFAULT',
    earlyMinutes: configurationValid
      ? configuredEarly
      : defaults.earlyMinutes,
    lateMinutes: configurationValid ? configuredLate : defaults.lateMinutes,
  }
}

/**
 * Enforces an effective, versioned operating window.
 *
 * Nobody may silently operate before the opening boundary. After the closing
 * boundary only ADMIN/SUPER_ADMIN may create a historical record, and that
 * bypass requires an explicit reason and receives its own immutable audit.
 * Parameter values are hard-capped at four hours so configuration cannot
 * silently turn a check-in window into an all-day (or all-year) bypass.
 */
export async function assertOperationTimeWindow(
  tx: Prisma.TransactionClient,
  input: OperationTimeWindowInput,
): Promise<OperationTimeWindowSnapshot> {
  const observedAt = input.observedAt ?? new Date()
  if (
    Number.isNaN(input.scheduledStartsAt.getTime()) ||
    Number.isNaN(input.scheduledEndsAt.getTime()) ||
    input.scheduledEndsAt < input.scheduledStartsAt
  ) {
    throw new ConflictException('业务时段配置无效，暂不能执行操作')
  }

  const configuration = await resolveOperationWindowConfiguration(
    tx,
    input.parameterKey,
    input.defaults,
    observedAt,
  )
  const { earlyMinutes, lateMinutes } = configuration
  const windowStartsAt = new Date(
    input.scheduledStartsAt.getTime() - earlyMinutes * 60_000,
  )
  const windowEndsAt = new Date(
    input.scheduledEndsAt.getTime() + lateMinutes * 60_000,
  )
  const baseSnapshot = {
    parameterKey: input.parameterKey,
    parameterVersion: 1 as const,
    parameterId: configuration.parameterId,
    parameterSource: configuration.parameterSource,
    earlyMinutes,
    lateMinutes,
    windowStartsAt: windowStartsAt.toISOString(),
    windowEndsAt: windowEndsAt.toISOString(),
    observedAt: observedAt.toISOString(),
  }

  if (observedAt < windowStartsAt) {
    throw new ConflictException(
      `未到允许操作时间，最早可在 ${windowStartsAt.toISOString()} 执行`,
    )
  }
  if (observedAt <= windowEndsAt) {
    return { ...baseSnapshot, decision: 'IN_WINDOW' }
  }

  const elevated = input.actor.roles.some((role) =>
    [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
  )
  if (!elevated) {
    throw new ConflictException('已超出允许操作时间，请由管理员执行历史补录')
  }
  const overrideReason = input.overrideReason?.trim() ?? ''
  if (overrideReason.length < 2 || overrideReason.length > 300) {
    throw new BadRequestException('管理员历史补录必须填写2-300个字符的原因')
  }

  const snapshot: OperationTimeWindowSnapshot = {
    ...baseSnapshot,
    decision: 'ADMIN_HISTORICAL_OVERRIDE',
  }
  await tx.auditLog.create({
    data: {
      actorId: input.actor.sub,
      actorRole: input.actor.roles[0],
      action: `${input.action}_HISTORICAL_OVERRIDE`,
      objectType: input.objectType,
      objectId: input.objectId,
      reason: overrideReason,
      newValue: snapshot as never,
    },
  })
  return snapshot
}
