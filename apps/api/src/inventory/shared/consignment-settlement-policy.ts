import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { Prisma } from '../../generated/prisma/client.js';
import { SETTLEMENT_ROLES } from './consignment-settlement-support.js';

export function normalizeCommand(reasonValue: string, keyValue: string) {
  const reason = reasonValue?.trim();
  const idempotencyKey = keyValue?.trim();
  if (!reason || reason.length < 2 || reason.length > 300)
    throw new BadRequestException('操作原因长度必须为2-300个字符');
  if (
    !idempotencyKey ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 100
  )
    throw new BadRequestException('幂等键长度必须为8-100个字符');
  return { reason, idempotencyKey };
}

export function requiredPeriod(startValue: string, endValue: string) {
  const periodStart = new Date(startValue);
  const periodEnd = new Date(endValue);
  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodEnd <= periodStart
  ) {
    throw new BadRequestException('寄售结算周期无效');
  }
  if (periodEnd.getTime() - periodStart.getTime() > 366 * 86_400_000)
    throw new BadRequestException('单张寄售结算单周期不能超过366天');
  return { periodStart, periodEnd };
}

export function assertSettlementRole(actor: AuthUser) {
  if (!actor.roles.some((role) => SETTLEMENT_ROLES.includes(role)))
    throw new ForbiddenException('仅财务或管理员可操作寄售应付与结算');
}

export async function loadSettlementDetail(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const settlement = await tx.consignmentSettlement.findUnique({
    where: { id },
    include: {
      supplier: {
        select: {
          id: true,
          code: true,
          name: true,
          contactName: true,
          contactPhone: true,
        },
      },
      createdBy: { select: { id: true, displayName: true } },
      submittedBy: { select: { id: true, displayName: true } },
      confirmedBy: { select: { id: true, displayName: true } },
      settledBy: { select: { id: true, displayName: true } },
      voidedBy: { select: { id: true, displayName: true } },
      lines: {
        include: {
          payableEntry: {
            include: {
              item: { select: { id: true, sku: true, name: true } },
              order: {
                select: { id: true, orderNo: true, completedAt: true },
              },
              refund: {
                select: { id: true, refundNo: true, completedAt: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      transitions: {
        include: { actor: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!settlement) throw new NotFoundException('寄售结算单不存在');
  return settlement;
}
