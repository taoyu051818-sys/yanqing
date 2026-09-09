import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  ConsignmentSettlementAction,
  Prisma,
  SettlementStatus,
} from '../../../generated/prisma/client.js';
import {
  ConsignmentSettlementActionDto,
  SettleConsignmentSettlementDto,
} from '../../consignment-settlement.dto.js';
import { inventoryCommandHash } from '../../inventory-master-data.js';
import { isPrismaErrorCode } from '../../shared/consignment-settlement-support.js';
import { detail } from '../queries/consignment-settlement-queries.commands.js';
import {
  normalizeCommand,
  assertSettlementRole,
} from '../../shared/consignment-settlement-policy.js';

export function submitSettlement(
  prisma: PrismaService,
  id: string,
  dto: ConsignmentSettlementActionDto,
  actor: AuthUser,
) {
  return transitionSettlement(
    prisma,
    id,
    dto,
    actor,
    ConsignmentSettlementAction.SUBMITTED,
  );
}

export function confirmSettlement(
  prisma: PrismaService,
  id: string,
  dto: ConsignmentSettlementActionDto,
  actor: AuthUser,
) {
  return transitionSettlement(
    prisma,
    id,
    dto,
    actor,
    ConsignmentSettlementAction.CONFIRMED,
  );
}

export function disputeSettlement(
  prisma: PrismaService,
  id: string,
  dto: ConsignmentSettlementActionDto,
  actor: AuthUser,
) {
  return transitionSettlement(
    prisma,
    id,
    dto,
    actor,
    ConsignmentSettlementAction.DISPUTED,
  );
}

export function returnSettlement(
  prisma: PrismaService,
  id: string,
  dto: ConsignmentSettlementActionDto,
  actor: AuthUser,
) {
  return transitionSettlement(
    prisma,
    id,
    dto,
    actor,
    ConsignmentSettlementAction.RETURNED,
  );
}

export function settleSettlement(
  prisma: PrismaService,
  id: string,
  dto: SettleConsignmentSettlementDto,
  actor: AuthUser,
) {
  return transitionSettlement(
    prisma,
    id,
    dto,
    actor,
    ConsignmentSettlementAction.SETTLED,
  );
}

export function voidSettlement(
  prisma: PrismaService,
  id: string,
  dto: ConsignmentSettlementActionDto,
  actor: AuthUser,
) {
  return transitionSettlement(
    prisma,
    id,
    dto,
    actor,
    ConsignmentSettlementAction.VOIDED,
  );
}

export async function transitionSettlement(
  prisma: PrismaService,
  id: string,
  dto: ConsignmentSettlementActionDto | SettleConsignmentSettlementDto,
  actor: AuthUser,
  action: ConsignmentSettlementAction,
) {
  assertSettlementRole(actor);
  const command = normalizeCommand(dto.reason, dto.idempotencyKey);
  const paymentReference =
    action === ConsignmentSettlementAction.SETTLED
      ? (dto as SettleConsignmentSettlementDto).paymentReference?.trim()
      : undefined;
  if (
    action === ConsignmentSettlementAction.SETTLED &&
    (!paymentReference ||
      paymentReference.length < 2 ||
      paymentReference.length > 120)
  ) {
    throw new BadRequestException('结算付款凭证长度必须为2-120个字符');
  }
  const transition = transitionDefinition(action);
  const commandHash = inventoryCommandHash({
    action,
    settlementId: id,
    fromStatus: transition.from,
    toStatus: transition.to,
    reason: command.reason,
    paymentReference,
  });

  try {
    await prisma.$transaction(
      async (tx) => {
        const replay = await tx.consignmentSettlementTransition.findUnique({
          where: { idempotencyKey: command.idempotencyKey },
        });
        if (replay) {
          assertTransitionReplay(replay, id, actor, action, commandHash);
          return;
        }
        const current = await tx.consignmentSettlement.findUnique({
          where: { id },
        });
        if (!current) throw new NotFoundException('寄售结算单不存在');
        if (current.status !== transition.from)
          throw new ConflictException(
            `寄售结算单当前状态为 ${current.status}，不能执行 ${action}`,
          );
        if (
          new Set<ConsignmentSettlementAction>([
            ConsignmentSettlementAction.CONFIRMED,
            ConsignmentSettlementAction.DISPUTED,
            ConsignmentSettlementAction.RETURNED,
            ConsignmentSettlementAction.SETTLED,
          ]).has(action) &&
          current.createdById === actor.sub
        ) {
          throw new ForbiddenException(
            '制单人不能确认、争议、退回或结算自己的寄售结算单',
          );
        }
        if (
          new Set<ConsignmentSettlementAction>([
            ConsignmentSettlementAction.SUBMITTED,
            ConsignmentSettlementAction.CONFIRMED,
            ConsignmentSettlementAction.SETTLED,
          ]).has(action)
        ) {
          await assertStatementSnapshotCurrent(tx, current);
        }

        const now = new Date();
        const data = transitionData(action, actor.sub, now, paymentReference);
        const changed = await tx.consignmentSettlement.updateMany({
          where: { id, status: transition.from },
          data: { status: transition.to, ...data },
        });
        if (changed.count !== 1)
          throw new ConflictException(
            '寄售结算状态已被其他操作更新，请刷新后重试',
          );
        if (action === ConsignmentSettlementAction.VOIDED) {
          await tx.consignmentSettlementLine.updateMany({
            where: { settlementId: id, releasedAt: null },
            data: { releasedAt: now },
          });
        }
        await tx.consignmentSettlementTransition.create({
          data: {
            settlementId: id,
            action,
            fromStatus: transition.from,
            toStatus: transition.to,
            reason: command.reason,
            actorId: actor.sub,
            idempotencyKey: command.idempotencyKey,
            commandHash,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: `CONSIGNMENT_SETTLEMENT_${action}`,
            objectType: 'ConsignmentSettlement',
            objectId: id,
            reason: command.reason,
            requestId: command.idempotencyKey,
            oldValue: { status: transition.from } as never,
            newValue: {
              commandHash,
              status: transition.to,
              paymentReference,
            } as never,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return detail(prisma, id, actor);
  } catch (error) {
    if (
      isPrismaErrorCode(error, 'P2002') ||
      isPrismaErrorCode(error, 'P2034')
    ) {
      const replay = await prisma.consignmentSettlementTransition.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
      });
      if (replay) {
        assertTransitionReplay(replay, id, actor, action, commandHash);
        return detail(prisma, id, actor);
      }
      throw new ConflictException('寄售结算状态发生并发冲突，请刷新后重试');
    }
    throw error;
  }
}

export function transitionDefinition(action: ConsignmentSettlementAction) {
  const definitions: Record<
    ConsignmentSettlementAction,
    { from: SettlementStatus; to: SettlementStatus }
  > = {
    [ConsignmentSettlementAction.CREATED]: {
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.DRAFT,
    },
    [ConsignmentSettlementAction.SUBMITTED]: {
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.PENDING_CONFIRMATION,
    },
    [ConsignmentSettlementAction.CONFIRMED]: {
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.CONFIRMED,
    },
    [ConsignmentSettlementAction.DISPUTED]: {
      from: SettlementStatus.PENDING_CONFIRMATION,
      to: SettlementStatus.DRAFT,
    },
    [ConsignmentSettlementAction.RETURNED]: {
      from: SettlementStatus.CONFIRMED,
      to: SettlementStatus.DRAFT,
    },
    [ConsignmentSettlementAction.SETTLED]: {
      from: SettlementStatus.CONFIRMED,
      to: SettlementStatus.SETTLED,
    },
    [ConsignmentSettlementAction.VOIDED]: {
      from: SettlementStatus.DRAFT,
      to: SettlementStatus.VOID,
    },
  };
  return definitions[action];
}

export function transitionData(
  action: ConsignmentSettlementAction,
  actorId: string,
  now: Date,
  paymentReference?: string,
): Prisma.ConsignmentSettlementUncheckedUpdateManyInput {
  if (action === ConsignmentSettlementAction.SUBMITTED)
    return { submittedById: actorId, submittedAt: now };
  if (action === ConsignmentSettlementAction.CONFIRMED)
    return { confirmedById: actorId, confirmedAt: now };
  if (
    action === ConsignmentSettlementAction.DISPUTED ||
    action === ConsignmentSettlementAction.RETURNED
  ) {
    return {
      submittedById: null,
      submittedAt: null,
      confirmedById: null,
      confirmedAt: null,
      settledById: null,
      settledAt: null,
      paymentReference: null,
    };
  }
  if (action === ConsignmentSettlementAction.SETTLED)
    return { settledById: actorId, settledAt: now, paymentReference };
  if (action === ConsignmentSettlementAction.VOIDED)
    return { voidedById: actorId, voidedAt: now };
  return {};
}

export async function assertStatementSnapshotCurrent(
  tx: Prisma.TransactionClient,
  settlement: {
    id: string;
    supplierId: string;
    periodStart: Date;
    periodEnd: Date;
    entryCount: number;
    netQuantity: number;
    grossSaleCents: number;
    commissionCents: number;
    payableCents: number;
  },
) {
  const [activeLines, unclaimed] = await Promise.all([
    tx.consignmentSettlementLine.aggregate({
      where: { settlementId: settlement.id, releasedAt: null },
      _count: { _all: true },
      _sum: {
        quantity: true,
        grossSaleCents: true,
        commissionCents: true,
        payableCents: true,
      },
    }),
    tx.consignmentPayableEntry.count({
      where: {
        supplierId: settlement.supplierId,
        occurredAt: { gte: settlement.periodStart, lt: settlement.periodEnd },
        settlementLines: { none: { releasedAt: null } },
      },
    }),
  ]);
  if (
    activeLines._count._all !== settlement.entryCount ||
    (activeLines._sum.quantity ?? 0) !== settlement.netQuantity ||
    (activeLines._sum.grossSaleCents ?? 0) !== settlement.grossSaleCents ||
    (activeLines._sum.commissionCents ?? 0) !== settlement.commissionCents ||
    (activeLines._sum.payableCents ?? 0) !== settlement.payableCents
  ) {
    throw new ConflictException('寄售结算单明细与冻结汇总不一致，请联系管理员');
  }
  if (unclaimed > 0)
    throw new ConflictException(
      '账期新增寄售应付或退款冲正，请作废并重建结算单',
    );
}

export function assertTransitionReplay(
  replay: {
    settlementId: string;
    actorId: string;
    action: ConsignmentSettlementAction;
    commandHash: string;
  },
  settlementId: string,
  actor: AuthUser,
  action: ConsignmentSettlementAction,
  commandHash: string,
) {
  if (
    replay.settlementId !== settlementId ||
    replay.actorId !== actor.sub ||
    replay.action !== action ||
    replay.commandHash !== commandHash
  ) {
    throw new ConflictException('寄售结算动作幂等键已用于其他操作人或命令');
  }
}
