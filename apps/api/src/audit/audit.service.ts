import { Injectable } from '@nestjs/common'

import type { AppRole, AuditResult } from '../generated/prisma/enums.js'
import { PrismaService } from '../database/prisma.service.js'

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

  list(input: { page: number; pageSize: number; objectType?: string }) {
    const where = input.objectType ? { objectType: input.objectType } : {}
    return this.prisma.$transaction(async (tx) => {
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          include: { actor: { select: { id: true, displayName: true } } },
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
