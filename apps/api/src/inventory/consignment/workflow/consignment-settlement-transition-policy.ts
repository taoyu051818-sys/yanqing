import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import {
  ConsignmentSettlementAction,
  Prisma,
  SettlementStatus,
} from '../../../generated/prisma/client.js';
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
