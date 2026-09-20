import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  canExecuteDirectly,
  directExecutionKey,
} from '../../common/auth/admin-execution.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  SettlementStatus,
} from '../../generated/prisma/client.js';
import type { TrainingSettlementActionDto } from '../training.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import {
  assertTrainingSettlementSources,
  trainingTransaction,
} from './training-settlement-ledger.js';
const TRAINING_SETTLEMENT_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];
export function submitSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
  tx?: Prisma.TransactionClient,
) {
  return transitionTrainingSettlement(
    prisma,
    {
      id,
      dto,
      actor,
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.PENDING_CONFIRMATION,
      action: 'TRAINING_SETTLEMENT_SUBMITTED',
    },
    tx,
  );
}

export function confirmSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
  tx?: Prisma.TransactionClient,
) {
  return transitionTrainingSettlement(
    prisma,
    {
      id,
      dto,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.CONFIRMED,
      action: 'TRAINING_SETTLEMENT_CONFIRMED',
      forbidCreator: true,
      data: { confirmedById: actor.sub, confirmedAt: new Date() },
    },
    tx,
  );
}

export function settleSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
) {
  const settle = (tx?: Prisma.TransactionClient) =>
    transitionTrainingSettlement(
      prisma,
      {
        id,
        dto,
        actor,
        from: SettlementStatus.CONFIRMED,
        to: SettlementStatus.SETTLED,
        action: 'TRAINING_SETTLEMENT_SETTLED',
        forbidCreator: true,
      },
      tx,
    );
  if (canExecuteDirectly(actor)) {
    assertTrainingSettlementRole(actor);
    return trainingTransaction(prisma, async (client) => {
      const current = await client.trainingSettlement.findUnique({
        where: { id },
      });
      const key =
        dto.idempotencyKey?.trim() ||
        `${id}:${actor.sub}:${dto.reason?.trim() || ''}`;
      if (current?.status === 'DRAFT')
        await submitSettlement(
          prisma,
          id,
          {
            ...dto,
            idempotencyKey: directExecutionKey('training-submit', key),
          },
          actor,
          client,
        );
      if (current && ['DRAFT', 'PENDING_CONFIRMATION'].includes(current.status))
        await confirmSettlement(
          prisma,
          id,
          {
            ...dto,
            idempotencyKey: directExecutionKey('training-confirm', key),
          },
          actor,
          client,
        );
      return settle(client);
    });
  }
  return settle();
}

export function returnSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
  tx?: Prisma.TransactionClient,
) {
  return transitionTrainingSettlement(
    prisma,
    {
      id,
      dto,
      actor,
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.DRAFT,
      action: 'TRAINING_SETTLEMENT_RETURNED',
      forbidCreator: true,
      requireReason: true,
      data: { confirmedById: null, confirmedAt: null },
    },
    tx,
  );
}

export function voidSettlement(
  prisma: PrismaService,
  id: string,
  dto: TrainingSettlementActionDto,
  actor: AuthUser,
  tx?: Prisma.TransactionClient,
) {
  return transitionTrainingSettlement(
    prisma,
    {
      id,
      dto,
      actor,
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.VOID,
      action: 'TRAINING_SETTLEMENT_VOIDED',
      requireReason: true,
    },
    tx,
  );
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
  client?: Prisma.TransactionClient,
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

  const apply = async (tx: Prisma.TransactionClient) => {
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
    if (
      input.forbidCreator &&
      creator?.actorId === input.actor.sub &&
      !canExecuteDirectly(input.actor)
    ) {
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
  };
  return client ? apply(client) : trainingTransaction(prisma, apply);
}

export function assertTrainingSettlementRole(actor: AuthUser): void {
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
