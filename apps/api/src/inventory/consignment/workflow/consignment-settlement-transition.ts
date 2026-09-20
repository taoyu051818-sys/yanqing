import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { canExecuteDirectly } from '../../../common/auth/admin-execution.js';
import type { AuthUser } from '../../../common/auth/auth-user.js';
import {
  ConsignmentSettlementAction,
  Prisma,
} from '../../../generated/prisma/client.js';
import type {
  ConsignmentSettlementActionDto,
  SettleConsignmentSettlementDto,
} from '../../consignment-settlement.dto.js';
import { inventoryCommandHash } from '../../inventory-master-data.js';
import {
  normalizeCommand,
  assertSettlementRole,
} from '../../shared/consignment-settlement-policy.js';
import {
  transitionDefinition,
  transitionData,
  assertStatementSnapshotCurrent,
  assertTransitionReplay,
} from './consignment-settlement-transition-policy.js';

export function prepareTransition(
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

  return { command, transition, commandHash, paymentReference, action };
}

export async function applyTransition(
  tx: Prisma.TransactionClient,
  id: string,
  prepared: ReturnType<typeof prepareTransition>,
  actor: AuthUser,
) {
  const { command, transition, commandHash, paymentReference, action } =
    prepared;
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
    current.createdById === actor.sub &&
    !canExecuteDirectly(actor)
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
    throw new ConflictException('寄售结算状态已被其他操作更新，请刷新后重试');
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
}
