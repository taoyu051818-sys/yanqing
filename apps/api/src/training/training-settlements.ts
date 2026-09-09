import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  SettlementStatus,
} from '../generated/prisma/client.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import type {
  CreateTrainingSettlementDto,
  ListTrainingSettlementsDto,
  TrainingSettlementActionDto,
} from './training.dto.js';
import {
  readTrainingLedger,
  assertTrainingSettlementSources,
  trainingTransaction,
} from './training-settlement-ledger.js';
import { trainingSettlementListResponse } from './training-command-response.js';

const TRAINING_SETTLEMENT_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

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

export function submitSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
) {
  return transitionTrainingSettlement(prisma, {
    id,
    dto,
    actor,
    from: SettlementStatus.DRAFT,
    to: SettlementStatus.PENDING_CONFIRMATION,
    action: 'TRAINING_SETTLEMENT_SUBMITTED',
  });
}

export function confirmSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
) {
  return transitionTrainingSettlement(prisma, {
    id,
    dto,
    actor,
    from: SettlementStatus.PENDING_CONFIRMATION,
    to: SettlementStatus.CONFIRMED,
    action: 'TRAINING_SETTLEMENT_CONFIRMED',
    forbidCreator: true,
    data: { confirmedById: actor.sub, confirmedAt: new Date() },
  });
}

export function settleSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
) {
  return transitionTrainingSettlement(prisma, {
    id,
    dto,
    actor,
    from: SettlementStatus.CONFIRMED,
    to: SettlementStatus.SETTLED,
    action: 'TRAINING_SETTLEMENT_SETTLED',
    forbidCreator: true,
  });
}

export function returnSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
) {
  return transitionTrainingSettlement(prisma, {
    id,
    dto,
    actor,
    from: SettlementStatus.PENDING_CONFIRMATION,
    to: SettlementStatus.DRAFT,
    action: 'TRAINING_SETTLEMENT_RETURNED',
    forbidCreator: true,
    requireReason: true,
    data: { confirmedById: null, confirmedAt: null },
  });
}

export function voidSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
) {
  return transitionTrainingSettlement(prisma, {
    id,
    dto,
    actor,
    from: SettlementStatus.DRAFT,
    to: SettlementStatus.VOID,
    action: 'TRAINING_SETTLEMENT_VOIDED',
    requireReason: true,
  });
}

async function transitionTrainingSettlement(
  prisma: PrismaService,
  input: {
    id: string;
    dto: TrainingSettlementActionDto;
    actor: AuthUser;
    from: SettlementStatus;
    to: SettlementStatus;
    action: string;
    forbidCreator?: boolean;
    requireReason?: boolean;
    data?: Record<string, unknown>;
  },
) {
  assertTrainingSettlementRole(input.actor);
  const submittedReason = input.dto.reason?.trim();
  if (input.requireReason && (!submittedReason || submittedReason.length < 2)) {
    throw new BadRequestException('退回或作废结算单必须填写原因');
  }
  const reason =
    submittedReason || trainingSettlementActionReason(input.action);
  const requestId = input.dto.idempotencyKey?.trim() || undefined;
  const commandHash = orderCreationCommandHash({
    kind: input.action,
    settlementId: input.id,
    from: input.from,
    to: input.to,
    reason,
  });

  return trainingTransaction(prisma, async (tx) => {
    const current = await tx.trainingSettlement.findUnique({
      where: { id: input.id },
    });
    if (!current) throw new NotFoundException('培训结算单不存在');

    const creator = await tx.auditLog.findFirst({
      where: {
        objectType: 'TrainingSettlement',
        objectId: input.id,
        action: 'TRAINING_SETTLEMENT_CREATED',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (input.forbidCreator && creator?.actorId === input.actor.sub) {
      throw new ForbiddenException(
        '制单人不能确认、结算或退回自己的培训结算单',
      );
    }

    if (requestId) {
      const replay = await tx.auditLog.findFirst({
        where: {
          objectType: 'TrainingSettlement',
          objectId: input.id,
          requestId,
        },
      });
      if (replay) {
        const replayValue =
          replay.newValue !== null &&
          typeof replay.newValue === 'object' &&
          !Array.isArray(replay.newValue)
            ? (replay.newValue as Record<string, unknown>)
            : null;
        if (
          replay.action !== input.action ||
          replay.actorId !== input.actor.sub ||
          replay.reason !== reason ||
          replayValue?.commandHash !== commandHash
        ) {
          throw new ConflictException('培训结算幂等键已用于其他操作人或命令');
        }
        return current;
      }
    }

    if (current.status === input.to) return current;
    if (current.status !== input.from) {
      throw new ConflictException(
        `培训结算单当前状态为 ${current.status}，不能执行该操作`,
      );
    }
    if (
      [
        SettlementStatus.PENDING_CONFIRMATION,
        SettlementStatus.CONFIRMED,
        SettlementStatus.SETTLED,
      ].includes(input.to as never)
    )
      await assertTrainingSettlementSources(tx, current);
    if (input.to === SettlementStatus.VOID) {
      await tx.trainingRevenueRecognition.updateMany({
        where: { settlementId: current.id },
        data: { settlementId: null },
      });
    }
    const changed = await tx.trainingSettlement.updateMany({
      where: { id: input.id, status: input.from },
      data: {
        status: input.to,
        ...input.data,
        ...(input.to === SettlementStatus.SETTLED
          ? { settledAt: new Date() }
          : {}),
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.trainingSettlement.findUnique({
        where: { id: input.id },
      });
      if (latest?.status === input.to) return latest;
      throw new ConflictException('培训结算单已被其他操作更新，请刷新后重试');
    }
    const updated = await tx.trainingSettlement.findUniqueOrThrow({
      where: { id: input.id },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actor.sub,
        actorRole: input.actor.roles[0],
        action: input.action,
        objectType: 'TrainingSettlement',
        objectId: input.id,
        oldValue: {
          status: input.from,
          confirmedById: current.confirmedById,
          confirmedAt: current.confirmedAt,
        } as never,
        newValue: {
          commandHash,
          status: input.to,
          confirmedById: updated.confirmedById,
          confirmedAt: updated.confirmedAt,
          settledAt: updated.settledAt,
        } as never,
        reason,
        requestId,
      },
    });
    return updated;
  });
}

function assertTrainingSettlementRole(actor: AuthUser): void {
  if (!actor.roles.some((role) => TRAINING_SETTLEMENT_ROLES.includes(role))) {
    throw new ForbiddenException('仅财务或管理员可操作培训结算');
  }
}

function trainingSettlementActionReason(action: string): string {
  const labels: Record<string, string> = {
    TRAINING_SETTLEMENT_SUBMITTED: '提交培训结算复核',
    TRAINING_SETTLEMENT_CONFIRMED: '确认培训结算',
    TRAINING_SETTLEMENT_SETTLED: '完成培训结算付款',
    TRAINING_SETTLEMENT_RETURNED: '退回培训结算修改',
    TRAINING_SETTLEMENT_VOIDED: '作废培训结算',
  };
  return labels[action] ?? '执行培训结算状态动作';
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
