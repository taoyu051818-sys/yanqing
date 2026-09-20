export {
  submitSettlement,
  confirmSettlement,
  settleSettlement,
  returnSettlement,
  voidSettlement,
} from './training-settlement-workflow.js';
import { assertTrainingSettlementRole } from './training-settlement-workflow.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma, SettlementStatus } from '../../generated/prisma/client.js';
import type {
  CreateTrainingSettlementDto,
  ListTrainingSettlementsDto,
} from '../training.dto.js';
import { readTrainingLedger } from './training-settlement-ledger.js';
import { trainingSettlementListResponse } from '../training-command-response.js';

export async function financialSummary(
  prisma: PrismaService,
  periodStart: Date,
  periodEnd: Date,
) {
  return (await readTrainingLedger(prisma, periodStart, periodEnd)).summary;
}

export async function createSettlement(
  prisma: PrismaService,
  dto: CreateTrainingSettlementDto,
  actor: AuthUser,
) {
  assertTrainingSettlementRole(actor);
  const periodStart = new Date(dto.periodStart),
    periodEnd = new Date(dto.periodEnd);
  if (
    !Number.isFinite(+periodStart) ||
    !Number.isFinite(+periodEnd) ||
    periodEnd <= periodStart
  )
    throw new BadRequestException('结算周期无效');
  const activeWhere = {
    periodStart,
    periodEnd,
    status: { not: SettlementStatus.VOID },
  };
  const replay = (
    existing: NonNullable<
      Awaited<ReturnType<typeof prisma.trainingSettlement.findFirst>>
    >,
  ) => {
    assertSettlementDraftMatches(existing, dto);
    return existing;
  };
  try {
    return await prisma.$transaction(
      async (tx) => {
        const existing = await tx.trainingSettlement.findFirst({
          where: activeWhere,
        });
        if (existing) return replay(existing);
        if (
          await tx.trainingSettlement.findFirst({
            where: {
              status: { not: SettlementStatus.VOID },
              periodStart: { lt: periodEnd },
              periodEnd: { gt: periodStart },
            },
          })
        )
          throw new ConflictException(
            '已有重叠账期的培训结算单，请核对起止时间',
          );
        const previous = await tx.trainingSettlement.aggregate({
          where: { periodStart, periodEnd },
          _max: { version: true },
        });
        const {
          summary: base,
          snapshot,
          recognitions,
        } = await readTrainingLedger(tx, periodStart, periodEnd);
        if (recognitions.some((r) => r.settlementId !== null))
          throw new ConflictException(
            '账期包含已归属其他结算单的收入，请核对来源',
          );
        const settlement = await tx.trainingSettlement.create({
          data: {
            periodStart,
            periodEnd,
            version: (previous._max.version ?? 0) + 1,
            sourceSnapshot: snapshot,
            effectiveRevenueCents: base.effectiveRevenueCents,
            contractRateBps: base.contractRateBps,
            venueContributionCents: base.venueContractContributionCents,
            venueFeeCents: 0,
            trainingPayableVenueCents: 0,
            coachCostCents: base.coachCostCents,
            assistantCostCents: base.assistantCostCents,
            materialCostCents: base.materialCostCents,
            acquisitionCostCents: dto.acquisitionCostCents,
            marketingCostCents: dto.marketingCostCents,
            occupiedCourtHours: base.occupiedCourtHours,
            cashContributionMarginCents:
              base.cashContributionMarginCents -
              dto.acquisitionCostCents -
              dto.marketingCostCents,
            status: SettlementStatus.DRAFT,
          },
        });
        const bound = await tx.trainingRevenueRecognition.updateMany({
          where: {
            id: { in: recognitions.map((r) => r.id) },
            settlementId: null,
          },
          data: { settlementId: settlement.id },
        });
        if (bound.count !== recognitions.length)
          throw new ConflictException('结算来源发生变化，请刷新后重试');
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_SETTLEMENT_CREATED',
            objectType: 'TrainingSettlement',
            objectId: settlement.id,
            oldValue: { exists: false },
            newValue: {
              status: settlement.status,
              version: settlement.version,
              effectiveRevenueCents: settlement.effectiveRevenueCents,
              venueContributionCents: settlement.venueContributionCents,
              acquisitionCostCents: settlement.acquisitionCostCents,
              marketingCostCents: settlement.marketingCostCents,
              venueFeeCents: 0,
              recognitionCount: recognitions.length,
            },
            reason: '生成培训结算单',
          },
        });
        return settlement;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const existing = await prisma.trainingSettlement.findFirst({
        where: activeWhere,
      });
      if (existing) return replay(existing);
      if (
        await prisma.trainingSettlement.findFirst({
          where: {
            status: { not: SettlementStatus.VOID },
            periodStart: { lt: periodEnd },
            periodEnd: { gt: periodStart },
          },
        })
      )
        throw new ConflictException('已有重叠账期的培训结算单，请核对起止时间');
      if (error.code === 'P2034')
        throw new ConflictException('培训结算发生并发变更，请刷新后重试');
    }
    throw error;
  }
}

export async function listSettlements(
  prisma: PrismaService,
  query: ListTrainingSettlementsDto,
  actor: AuthUser,
) {
  assertTrainingSettlementRole(actor);
  const periodStart = query.periodStart
    ? new Date(query.periodStart)
    : undefined;
  const periodEnd = query.periodEnd ? new Date(query.periodEnd) : undefined;
  if (periodStart && periodEnd && periodEnd <= periodStart) {
    throw new BadRequestException('查询结束时间必须晚于开始时间');
  }
  const settlements = await prisma.trainingSettlement.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(periodStart ? { periodStart: { gte: periodStart } } : {}),
      ...(periodEnd ? { periodEnd: { lte: periodEnd } } : {}),
    },
    orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
  });
  if (!settlements.length) return [];

  const audits = await prisma.auditLog.findMany({
    where: {
      objectType: 'TrainingSettlement',
      objectId: { in: settlements.map((settlement) => settlement.id) },
      action: { startsWith: 'TRAINING_SETTLEMENT_' },
    },
    include: { actor: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return settlements.map((settlement) => {
    const history = audits.filter((audit) => audit.objectId === settlement.id);
    const creator = history.find(
      (audit) => audit.action === 'TRAINING_SETTLEMENT_CREATED',
    );
    const workflowHistory = history.map((audit) => ({
      action: audit.action,
      actor: audit.actor?.displayName ?? null,
      reason: audit.reason,
      from:
        audit.oldValue &&
        typeof audit.oldValue === 'object' &&
        !Array.isArray(audit.oldValue) &&
        'status' in audit.oldValue
          ? String(audit.oldValue.status)
          : null,
      to:
        audit.newValue &&
        typeof audit.newValue === 'object' &&
        !Array.isArray(audit.newValue) &&
        'status' in audit.newValue
          ? String(audit.newValue.status)
          : null,
      at: audit.createdAt,
    }));
    return trainingSettlementListResponse(settlement, {
      isOwnCreator: creator?.actorId === actor.sub,
      createdByDisplayName: creator?.actor?.displayName ?? null,
      workflowHistory,
    });
  });
}

function assertSettlementDraftMatches(
  settlement: { acquisitionCostCents: number; marketingCostCents: number },
  dto: CreateTrainingSettlementDto,
): void {
  if (
    settlement.acquisitionCostCents !== dto.acquisitionCostCents ||
    settlement.marketingCostCents !== dto.marketingCostCents
  ) {
    throw new ConflictException(
      '该培训结算周期已生成，费用口径不同，不能覆盖原草稿',
    );
  }
}
