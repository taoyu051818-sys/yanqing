import { BadRequestException } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma, SupplierType } from '../../../generated/prisma/client.js';
import {
  ConsignmentPayableQueryDto,
  ConsignmentSettlementQueryDto,
} from '../../consignment-settlement.dto.js';
import {
  asRecord,
  payableResponse,
  settlementResponse,
} from '../../shared/consignment-settlement-support.js';
import {
  requiredPeriod,
  assertSettlementRole,
  loadSettlementDetail,
} from '../../shared/consignment-settlement-policy.js';

export async function supplierOptions(prisma: PrismaService, actor: AuthUser) {
  assertSettlementRole(actor);
  const suppliers = await prisma.supplier.findMany({
    where: { type: SupplierType.CONSIGNMENT, enabled: true },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      enabled: true,
      settlementRule: true,
    },
    orderBy: { name: 'asc' },
  });
  return suppliers.map((supplier) => {
    const rule = asRecord(supplier.settlementRule);
    return {
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      type: supplier.type,
      enabled: supplier.enabled,
      settlementCycle: String(rule.settlementCycle || ''),
      commissionRateBps: Number(rule.commissionRateBps || 0),
    };
  });
}

export async function listPayables(
  prisma: PrismaService,
  query: ConsignmentPayableQueryDto,
  actor: AuthUser,
) {
  assertSettlementRole(actor);
  const period = optionalPeriod(query.periodStart, query.periodEnd);
  const where: Prisma.ConsignmentPayableEntryWhereInput = {
    supplierId: query.supplierId,
    type: query.type,
    ...(period
      ? { occurredAt: { gte: period.periodStart, lt: period.periodEnd } }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.consignmentPayableEntry.findMany({
      where,
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        item: { select: { id: true, sku: true, name: true } },
        order: { select: { id: true, orderNo: true, completedAt: true } },
        refund: { select: { id: true, refundNo: true, completedAt: true } },
        settlementLines: {
          include: {
            settlement: {
              select: { id: true, statementNo: true, status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.consignmentPayableEntry.count({ where }),
  ]);
  return {
    items: items.map(payableResponse),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function listSettlements(
  prisma: PrismaService,
  query: ConsignmentSettlementQueryDto,
  actor: AuthUser,
) {
  assertSettlementRole(actor);
  const period = optionalPeriod(query.periodStart, query.periodEnd);
  const where: Prisma.ConsignmentSettlementWhereInput = {
    supplierId: query.supplierId,
    status: query.status,
    ...(period
      ? {
          periodStart: { gte: period.periodStart },
          periodEnd: { lte: period.periodEnd },
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.consignmentSettlement.findMany({
      where,
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, displayName: true } },
        confirmedBy: { select: { id: true, displayName: true } },
        settledBy: { select: { id: true, displayName: true } },
        transitions: {
          include: { actor: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ periodEnd: 'desc' }, { version: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.consignmentSettlement.count({ where }),
  ]);
  return {
    items: items.map((item) => settlementResponse(item, actor.sub)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function detail(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  assertSettlementRole(actor);
  const settlement = await prisma.$transaction((tx) =>
    loadSettlementDetail(tx, id),
  );
  return settlementResponse(settlement, actor.sub);
}

export function optionalPeriod(startValue?: string, endValue?: string) {
  if (!startValue && !endValue) return null;
  if (!startValue || !endValue)
    throw new BadRequestException('查询周期开始和结束时间必须同时填写');
  return requiredPeriod(startValue, endValue);
}
