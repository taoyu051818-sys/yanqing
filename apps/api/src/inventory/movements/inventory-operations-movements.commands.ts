import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  InventoryOperationStatus,
  InventoryOperationType,
  InventoryTxnType,
  Prisma,
} from '../../generated/prisma/client.js';
import type {
  CancelDocumentDto,
  CreateInventoryOperationDto,
  PostInventoryOperationDto,
} from '../inventory.dto.js';
import {
  serial,
  ADMIN_ROLES,
  FRONT_ROLES,
  READ_ROLES,
  inventoryOperationResponse,
} from '../shared/inventory-operations-support.js';
import {
  documentTransaction,
  reconciledBalance,
  batch,
  requireRole,
  audit,
} from '../shared/inventory-operations-policy.js';

export function operations(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, READ_ROLES);
  return prisma.inventoryOperation
    .findMany({
      include: { item: true, sourceLocation: true, targetLocation: true },
      orderBy: { createdAt: 'desc' },
    })
    .then((documents) => documents.map(inventoryOperationResponse));
}

export async function createOperation(
  prisma: PrismaService,
  dto: CreateInventoryOperationDto,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  if (dto.type === InventoryOperationType.TRANSFER) {
    if (
      !dto.targetLocationId ||
      dto.targetLocationId === dto.sourceLocationId
    ) {
      throw new BadRequestException('调拨必须选择不同的目标库位');
    }
  } else if (dto.targetLocationId) {
    throw new BadRequestException('报损不能设置目标库位');
  }
  const [item, source, target] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: dto.itemId } }),
    prisma.inventoryLocation.findUnique({
      where: { id: dto.sourceLocationId },
    }),
    dto.targetLocationId
      ? prisma.inventoryLocation.findUnique({
          where: { id: dto.targetLocationId },
        })
      : Promise.resolve(null),
  ]);
  if (
    !item?.enabled ||
    !source?.enabled ||
    (dto.targetLocationId && !target?.enabled)
  ) {
    throw new NotFoundException('库存商品或库位不存在');
  }
  const created = await prisma.inventoryOperation.create({
    data: {
      documentNo: serial(
        dto.type === InventoryOperationType.TRANSFER ? 'TR' : 'LS',
      ),
      type: dto.type,
      itemId: item.id,
      quantity: dto.quantity,
      batchCode: batch(dto.batchCode),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      sourceLocationId: source.id,
      targetLocationId: target?.id ?? null,
      reason: dto.reason.trim(),
      referenceType: dto.referenceType?.trim() || null,
      referenceId: dto.referenceId?.trim() || null,
      createdById: actor.sub,
    },
    include: { item: true, sourceLocation: true, targetLocation: true },
  });
  return inventoryOperationResponse(created);
}

export function submitOperation(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  return moveOperation(
    prisma,
    id,
    InventoryOperationStatus.DRAFT,
    InventoryOperationStatus.SUBMITTED,
    actor,
  ).then(inventoryOperationResponse);
}

export function approveOperation(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  return documentTransaction(prisma, async (tx) => {
    const operation = await tx.inventoryOperation.findUnique({
      where: { id },
    });
    if (!operation) throw new NotFoundException('库存业务单不存在');
    if (operation.status === InventoryOperationStatus.APPROVED)
      return operation;
    if (operation.status !== InventoryOperationStatus.SUBMITTED)
      throw new ConflictException('库存业务单尚未提交');
    if (operation.createdById === actor.sub)
      throw new ForbiddenException('库存业务制单人与审批人不能为同一账号');
    await tx.inventoryOperation.update({
      where: { id, status: operation.status },
      data: {
        status: InventoryOperationStatus.APPROVED,
        approvedById: actor.sub,
        approvedAt: new Date(),
      },
    });
    await audit(
      tx,
      actor,
      'INVENTORY_OPERATION_APPROVED',
      'InventoryOperation',
      id,
      operation.status,
      InventoryOperationStatus.APPROVED,
      operation.reason,
    );
    return tx.inventoryOperation.findUniqueOrThrow({
      where: { id },
      include: { item: true, sourceLocation: true, targetLocation: true },
    });
  }).then(inventoryOperationResponse);
}

export async function postOperation(
  prisma: PrismaService,
  id: string,
  dto: PostInventoryOperationDto,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  return documentTransaction(
    prisma,
    async (tx) => {
      const operation = await tx.inventoryOperation.findUnique({
        where: { id },
        include: {
          item: true,
          sourceLocation: true,
          targetLocation: true,
        },
      });
      if (!operation) throw new NotFoundException('库存业务单不存在');
      if (operation.status === InventoryOperationStatus.POSTED) {
        if (operation.postIdempotencyKey !== dto.idempotencyKey)
          throw new ConflictException('库存业务单已使用其他幂等键过账');
        return inventoryOperationResponse(operation);
      }
      if (operation.status !== InventoryOperationStatus.APPROVED)
        throw new ConflictException('库存业务单尚未审批');
      if (
        operation.item.enabled === false ||
        operation.sourceLocation.enabled === false ||
        operation.targetLocation?.enabled === false
      ) {
        throw new ConflictException('商品或库位已停用，不能过账');
      }
      const source = await reconciledBalance(
        tx,
        operation.item,
        operation.sourceLocationId,
        operation.batchCode,
        operation.expiresAt,
      );
      if (source.quantity < operation.quantity)
        throw new BadRequestException('来源库位库存不足');
      // Validate both locations against the complete opening ledger before
      // either balance changes. A half-posted transfer is not a discrepancy.
      if (
        operation.type === InventoryOperationType.TRANSFER &&
        !operation.targetLocationId
      )
        throw new ConflictException('调拨单缺少目标库位');
      const target =
        operation.type === InventoryOperationType.TRANSFER
          ? await reconciledBalance(
              tx,
              operation.item,
              operation.targetLocationId!,
              operation.batchCode,
              operation.expiresAt,
            )
          : null;
      await tx.inventoryStockBalance.update({
        where: { id: source.id },
        data: { quantity: { decrement: operation.quantity } },
      });
      let sourceTransactionId: string;
      let targetTransactionId: string | null = null;
      if (operation.type === InventoryOperationType.TRANSFER) {
        if (!target) throw new ConflictException('调拨单缺少目标库位');
        await tx.inventoryStockBalance.update({
          where: { id: target.id },
          data: {
            quantity: { increment: operation.quantity },
            expiresAt: operation.expiresAt,
          },
        });
        const out = await tx.inventoryTransaction.create({
          data: {
            itemId: operation.itemId,
            type: InventoryTxnType.TRANSFER_OUT,
            quantity: -operation.quantity,
            stockBefore: operation.item.stock,
            stockAfter: operation.item.stock,
            operatorId: actor.sub,
            reason: operation.reason,
            idempotencyKey: `TRANSFER_OUT:${dto.idempotencyKey}`,
            metadata: {
              operationId: id,
              locationId: operation.sourceLocationId,
              batchCode: operation.batchCode,
            } as never,
          },
        });
        const incoming = await tx.inventoryTransaction.create({
          data: {
            itemId: operation.itemId,
            type: InventoryTxnType.TRANSFER_IN,
            quantity: operation.quantity,
            stockBefore: operation.item.stock,
            stockAfter: operation.item.stock,
            operatorId: actor.sub,
            reason: operation.reason,
            idempotencyKey: `TRANSFER_IN:${dto.idempotencyKey}`,
            metadata: {
              operationId: id,
              locationId: operation.targetLocationId,
              batchCode: operation.batchCode,
            } as never,
          },
        });
        sourceTransactionId = out.id;
        targetTransactionId = incoming.id;
      } else {
        const changed = await tx.inventoryItem.updateMany({
          where: { id: operation.itemId, stock: operation.item.stock },
          data: { stock: { decrement: operation.quantity } },
        });
        if (changed.count !== 1)
          throw new ConflictException('库存已变化，请重试');
        const loss = await tx.inventoryTransaction.create({
          data: {
            itemId: operation.itemId,
            type: InventoryTxnType.LOSS_OUT,
            quantity: -operation.quantity,
            stockBefore: operation.item.stock,
            stockAfter: operation.item.stock - operation.quantity,
            operatorId: actor.sub,
            reason: operation.reason,
            idempotencyKey: `LOSS:${dto.idempotencyKey}`,
            metadata: {
              operationId: id,
              locationId: operation.sourceLocationId,
              batchCode: operation.batchCode,
              referenceType: operation.referenceType,
              referenceId: operation.referenceId,
            } as never,
          },
        });
        sourceTransactionId = loss.id;
      }
      await tx.inventoryOperation.update({
        where: { id, status: operation.status },
        data: {
          status: InventoryOperationStatus.POSTED,
          postedById: actor.sub,
          postedAt: new Date(),
          postIdempotencyKey: dto.idempotencyKey,
          sourceTransactionId,
          targetTransactionId,
        },
      });
      await audit(
        tx,
        actor,
        'INVENTORY_OPERATION_POSTED',
        'InventoryOperation',
        id,
        InventoryOperationStatus.APPROVED,
        InventoryOperationStatus.POSTED,
        operation.reason,
      );
      return tx.inventoryOperation
        .findUniqueOrThrow({
          where: { id },
          include: { item: true, sourceLocation: true, targetLocation: true },
        })
        .then(inventoryOperationResponse);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function cancelOperation(
  prisma: PrismaService,
  id: string,
  dto: CancelDocumentDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  return documentTransaction(prisma, async (tx) => {
    const operation = await tx.inventoryOperation.findUnique({
      where: { id },
    });
    if (!operation) throw new NotFoundException('库存业务单不存在');
    if (operation.status === InventoryOperationStatus.CANCELLED)
      return operation;
    if (
      operation.status !== InventoryOperationStatus.DRAFT &&
      operation.status !== InventoryOperationStatus.SUBMITTED &&
      operation.status !== InventoryOperationStatus.APPROVED
    ) {
      throw new ConflictException('已过账库存业务单不能取消');
    }
    const cancelled = await tx.inventoryOperation.update({
      where: { id, status: operation.status },
      data: {
        status: InventoryOperationStatus.CANCELLED,
        cancelledAt: new Date(),
        reason: `${operation.reason}；取消：${dto.reason.trim()}`,
      },
    });
    await audit(
      tx,
      actor,
      'INVENTORY_OPERATION_CANCELLED',
      'InventoryOperation',
      id,
      operation.status,
      InventoryOperationStatus.CANCELLED,
      dto.reason.trim(),
    );
    return cancelled;
  }).then(inventoryOperationResponse);
}

export function moveOperation(
  prisma: PrismaService,
  id: string,
  from: InventoryOperationStatus,
  to: InventoryOperationStatus,
  actor: AuthUser,
) {
  return documentTransaction(prisma, async (tx) => {
    const operation = await tx.inventoryOperation.findUnique({
      where: { id },
    });
    if (!operation) throw new NotFoundException('库存业务单不存在');
    if (operation.status === to) return operation;
    if (operation.status !== from)
      throw new ConflictException('库存业务单状态不允许该操作');
    const moved = await tx.inventoryOperation.update({
      where: { id, status: operation.status },
      data: { status: to, submittedAt: new Date() },
    });
    await audit(
      tx,
      actor,
      'INVENTORY_OPERATION_SUBMITTED',
      'InventoryOperation',
      id,
      from,
      to,
      operation.reason,
    );
    return moved;
  });
}
