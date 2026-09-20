import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import {
  canExecuteDirectly,
  directExecutionKey,
} from '../../../common/auth/admin-execution.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import {
  ConsignmentSettlementAction,
  Prisma,
} from '../../../generated/prisma/client.js';
import type {
  ConsignmentSettlementActionDto,
  SettleConsignmentSettlementDto,
} from '../../consignment-settlement.dto.js';
import { isPrismaErrorCode } from '../../shared/consignment-settlement-support.js';
import { detail } from '../queries/consignment-settlement-queries.commands.js';
import {
  prepareTransition,
  applyTransition,
} from './consignment-settlement-transition.js';
import { assertTransitionReplay } from './consignment-settlement-transition-policy.js';

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
  // Validate the complete command before the first write, including payment evidence.
  const prepared = prepareTransition(id, dto, actor, action);
  const { command, commandHash } = prepared;
  try {
    await prisma.$transaction(
      async (tx) => {
        if (
          action === ConsignmentSettlementAction.SETTLED &&
          canExecuteDirectly(actor)
        ) {
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
          if (current?.status === 'DRAFT')
            await applyTransition(
              tx,
              id,
              prepareTransition(
                id,
                {
                  reason: command.reason,
                  idempotencyKey: directExecutionKey(
                    'consignment-submit',
                    command.idempotencyKey,
                  ),
                },
                actor,
                ConsignmentSettlementAction.SUBMITTED,
              ),
              actor,
            );
          if (
            current &&
            ['DRAFT', 'PENDING_CONFIRMATION'].includes(current.status)
          )
            await applyTransition(
              tx,
              id,
              prepareTransition(
                id,
                {
                  reason: command.reason,
                  idempotencyKey: directExecutionKey(
                    'consignment-confirm',
                    command.idempotencyKey,
                  ),
                },
                actor,
                ConsignmentSettlementAction.CONFIRMED,
              ),
              actor,
            );
        }
        await applyTransition(tx, id, prepared, actor);
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
