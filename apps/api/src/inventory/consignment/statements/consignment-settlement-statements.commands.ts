import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  ConsignmentSettlementAction,
  Prisma,
  SettlementStatus,
  SupplierType,
} from '../../../generated/prisma/client.js';
import { CreateConsignmentSettlementDto } from '../../consignment-settlement.dto.js';
import { inventoryCommandHash } from '../../inventory-master-data.js';
import {
  statementNo,
  isPrismaErrorCode,
  asRecord,
} from '../../shared/consignment-settlement-support.js';
import { detail } from '../queries/consignment-settlement-queries.commands.js';
import {
  normalizeCommand,
  requiredPeriod,
  assertSettlementRole,
} from '../../shared/consignment-settlement-policy.js';

export async function createSettlement(
  prisma: PrismaService,
  dto: CreateConsignmentSettlementDto,
  actor: AuthUser,
) {
  assertSettlementRole(actor);
  const period = requiredPeriod(dto.periodStart, dto.periodEnd);
  const command = normalizeCommand(dto.reason, dto.idempotencyKey);
  const commandHash = inventoryCommandHash({
    action: ConsignmentSettlementAction.CREATED,
    supplierId: dto.supplierId,
    periodStart: period.periodStart.toISOString(),
    periodEnd: period.periodEnd.toISOString(),
    reason: command.reason,
  });
  const replay = await prisma.consignmentSettlement.findUnique({
    where: { creationIdempotencyKey: command.idempotencyKey },
  });
  if (replay) {
    assertCreationReplay(replay, actor, commandHash);
    return detail(prisma, replay.id, actor);
  }

  try {
    const id = await prisma.$transaction(
      async (tx) => {
        const supplier = await tx.supplier.findUnique({
          where: { id: dto.supplierId },
        });
        if (!supplier) throw new NotFoundException('寄售供应商不存在');
        if (supplier.type !== SupplierType.CONSIGNMENT)
          throw new ConflictException('自营采购供应商不能生成寄售结算单');
        const rule = requireConsignmentRule(supplier.settlementRule);
        const active = await tx.consignmentSettlement.findFirst({
          where: {
            supplierId: supplier.id,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            status: { not: SettlementStatus.VOID },
          },
        });
        if (active) throw new ConflictException('该供应商账期已有未作废结算单');

        const entries = await tx.consignmentPayableEntry.findMany({
          where: {
            supplierId: supplier.id,
            occurredAt: { gte: period.periodStart, lt: period.periodEnd },
            settlementLines: { none: { releasedAt: null } },
          },
          orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
          take: 10_001,
        });
        if (!entries.length)
          throw new BadRequestException('该供应商账期没有待结寄售应付明细');
        if (entries.length > 10_000)
          throw new BadRequestException(
            '单张结算单最多包含10000条明细，请拆分账期',
          );

        const latest = await tx.consignmentSettlement.findFirst({
          where: {
            supplierId: supplier.id,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const totals = entryTotals(entries);
        const settlement = await tx.consignmentSettlement.create({
          data: {
            statementNo: statementNo(),
            supplierId: supplier.id,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            version: (latest?.version ?? 0) + 1,
            status: SettlementStatus.DRAFT,
            ...totals,
            ruleSnapshot: {
              supplierCode: supplier.code,
              supplierName: supplier.name,
              settlementCycle: rule.settlementCycle,
              commissionRateBps: rule.commissionRateBps,
              commissionMeaning: 'VENUE_COMMISSION',
            },
            creationReason: command.reason,
            creationIdempotencyKey: command.idempotencyKey,
            creationCommandHash: commandHash,
            createdById: actor.sub,
            lines: {
              create: entries.map((entry) => ({
                payableEntryId: entry.id,
                quantity: entry.quantity,
                grossSaleCents: entry.grossSaleCents,
                commissionCents: entry.commissionCents,
                payableCents: entry.payableCents,
              })),
            },
            transitions: {
              create: {
                action: ConsignmentSettlementAction.CREATED,
                fromStatus: null,
                toStatus: SettlementStatus.DRAFT,
                reason: command.reason,
                actorId: actor.sub,
                idempotencyKey: command.idempotencyKey,
                commandHash,
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'CONSIGNMENT_SETTLEMENT_CREATED',
            objectType: 'ConsignmentSettlement',
            objectId: settlement.id,
            reason: command.reason,
            requestId: command.idempotencyKey,
            newValue: {
              commandHash,
              supplierId: supplier.id,
              periodStart: period.periodStart.toISOString(),
              periodEnd: period.periodEnd.toISOString(),
              version: settlement.version,
              ...totals,
            } as never,
          },
        });
        return settlement.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return detail(prisma, id, actor);
  } catch (error) {
    if (
      isPrismaErrorCode(error, 'P2002') ||
      isPrismaErrorCode(error, 'P2034')
    ) {
      const duplicate = await prisma.consignmentSettlement.findUnique({
        where: { creationIdempotencyKey: command.idempotencyKey },
      });
      if (duplicate) {
        assertCreationReplay(duplicate, actor, commandHash);
        return detail(prisma, duplicate.id, actor);
      }
      throw new ConflictException('寄售结算单被其他操作并发生成，请刷新后重试');
    }
    throw error;
  }
}

export function entryTotals(
  entries: Array<{
    quantity: number;
    grossSaleCents: number;
    commissionCents: number;
    payableCents: number;
  }>,
) {
  return entries.reduce(
    (totals, entry) => ({
      entryCount: totals.entryCount + 1,
      netQuantity: totals.netQuantity + entry.quantity,
      grossSaleCents: totals.grossSaleCents + entry.grossSaleCents,
      commissionCents: totals.commissionCents + entry.commissionCents,
      payableCents: totals.payableCents + entry.payableCents,
    }),
    {
      entryCount: 0,
      netQuantity: 0,
      grossSaleCents: 0,
      commissionCents: 0,
      payableCents: 0,
    },
  );
}

export function requireConsignmentRule(value: Prisma.JsonValue | null) {
  const rule = asRecord(value);
  const settlementCycle = String(rule.settlementCycle ?? '');
  const commissionRateBps = Number(rule.commissionRateBps);
  if (!['PER_ORDER', 'WEEKLY', 'MONTHLY'].includes(settlementCycle))
    throw new ConflictException('寄售供应商未配置有效结算周期');
  if (
    !Number.isInteger(commissionRateBps) ||
    commissionRateBps < 0 ||
    commissionRateBps > 10_000
  ) {
    throw new ConflictException('寄售供应商未配置有效场馆佣金基点');
  }
  return { settlementCycle, commissionRateBps };
}

export function assertCreationReplay(
  settlement: {
    createdById: string;
    creationCommandHash: string;
  },
  actor: AuthUser,
  commandHash: string,
) {
  if (
    settlement.createdById !== actor.sub ||
    settlement.creationCommandHash !== commandHash
  ) {
    throw new ConflictException('寄售结算创建幂等键已用于其他操作人或命令');
  }
}
