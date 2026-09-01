import { ForbiddenException, Injectable } from '@nestjs/common'

import { AppRole, type AuditResult } from '../generated/prisma/enums.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { PrismaService } from '../database/prisma.service.js'

const FINANCE_AUDIT_OBJECT_TYPES = [
  'AccountAdjustmentRequest',
  'AllianceSettlement',
  'ConsignmentPayableEntry',
  'ConsignmentSettlement',
  'Export',
  'HostReward',
  'Order',
  'Payment',
  'ReconciliationPeriod',
  'ReferralReward',
  'Refund',
  'TrainingSettlement',
] as const

export interface AuditInput {
  actorId?: string
  actorRole?: AppRole
  action: string
  objectType: string
  objectId?: string
  oldValue?: unknown
  newValue?: unknown
  reason?: string
  result?: AuditResult
  requestId?: string
  ip?: string
  deviceInfo?: string
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId,
        oldValue: input.oldValue as never,
        newValue: input.newValue as never,
        reason: input.reason,
        result: input.result,
        requestId: input.requestId,
        ip: input.ip,
        deviceInfo: input.deviceInfo,
      },
    })
  }

  list(
    input: { page: number; pageSize: number; objectType?: string },
    actor: AuthUser,
  ) {
    const canViewFullAudit = actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
    const isFinance = actor.roles.includes(AppRole.FINANCE)
    if (!canViewFullAudit && !isFinance) {
      throw new ForbiddenException('当前角色无权读取审计日志')
    }
    if (
      !canViewFullAudit &&
      input.objectType &&
      !FINANCE_AUDIT_OBJECT_TYPES.includes(input.objectType as never)
    ) {
      throw new ForbiddenException('财务仅可查询财务职责范围内的审计记录')
    }
    const where = input.objectType
      ? { objectType: input.objectType }
      : canViewFullAudit
        ? {}
        : { objectType: { in: [...FINANCE_AUDIT_OBJECT_TYPES] } }
    return this.prisma.$transaction(async (tx) => {
      const [items, total] = await Promise.all([
        canViewFullAudit
          ? tx.auditLog.findMany({
              where,
              include: { actor: { select: { id: true, displayName: true } } },
              orderBy: { createdAt: 'desc' },
              skip: (input.page - 1) * input.pageSize,
              take: input.pageSize,
            })
          : tx.auditLog.findMany({
              where,
              select: {
                id: true,
                actorRole: true,
                action: true,
                objectType: true,
                objectId: true,
                reason: true,
                result: true,
                createdAt: true,
                actor: { select: { displayName: true } },
              },
              orderBy: { createdAt: 'desc' },
              skip: (input.page - 1) * input.pageSize,
              take: input.pageSize,
            }),
        tx.auditLog.count({ where }),
      ])
      return { items, total, page: input.page, pageSize: input.pageSize }
    })
  }
}
