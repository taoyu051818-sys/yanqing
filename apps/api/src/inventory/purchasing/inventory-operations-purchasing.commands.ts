import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  InventoryMode,
  InventoryTxnType,
  Prisma,
  PurchaseOrderStatus,
  SupplierType,
} from '../../generated/prisma/client.js';
import type {
  CancelDocumentDto,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from '../inventory.dto.js';
import {
  serial,
  ADMIN_ROLES,
  FRONT_ROLES,
  READ_ROLES,
  purchaseReceiptResponse,
  purchaseOrderResponse,
} from '../shared/inventory-operations-support.js';

import {
  documentTransaction,
  reconciledBalance,
  batch,
  requireRole,
  audit,
} from '../shared/inventory-operations-policy.js';

export function purchaseOrders(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, READ_ROLES);
  return prisma.purchaseOrder
    .findMany({
      include: {
        supplier: true,
        lines: { include: { item: true, location: true } },
        receipts: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    .then((orders) => orders.map(purchaseOrderResponse));
}

export async function createPurchaseOrder(
  prisma: PrismaService,
  dto: CreatePurchaseOrderDto,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  const keys = dto.lines.map((line) =>
    [line.itemId, line.locationId, batch(line.batchCode)].join(':'),
  );
  if (new Set(keys).size !== keys.length)
    throw new BadRequestException('采购明细不能重复');
  return documentTransaction(prisma, async (tx) => {
    const supplier = await tx.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier?.enabled) throw new NotFoundException('供应商不存在或已停用');
    const itemIds = [...new Set(dto.lines.map((line) => line.itemId))];
    const locationIds = [...new Set(dto.lines.map((line) => line.locationId))];
    const [items, locations] = await Promise.all([
      tx.inventoryItem.findMany({
        where: { id: { in: itemIds }, enabled: true },
      }),
      tx.inventoryLocation.findMany({
        where: { id: { in: locationIds }, enabled: true },
      }),
    ]);
    if (
      items.length !== itemIds.length ||
      locations.length !== locationIds.length
    ) {
      throw new NotFoundException('采购商品或收货库位不存在');
    }
    const expectedMode =
      supplier.type === SupplierType.CONSIGNMENT
        ? InventoryMode.CONSIGNMENT
        : InventoryMode.PURCHASE;
    if (
      items.some(
        (item) => item.supplierId !== supplier.id || item.mode !== expectedMode,
      )
    ) {
      throw new BadRequestException('采购商品必须属于所选供应商且经营模式一致');
    }
    return tx.purchaseOrder.create({
      data: {
        orderNo: serial('PO'),
        supplierId: supplier.id,
        createdById: actor.sub,
        remark: dto.remark?.trim() || null,
        lines: {
          create: dto.lines.map((line) => ({
            itemId: line.itemId,
            locationId: line.locationId,
            orderedQuantity: line.orderedQuantity,
            unitCostCents: line.unitCostCents,
            batchCode: batch(line.batchCode),
            expiresAt: line.expiresAt ? new Date(line.expiresAt) : null,
          })),
        },
      },
      include: { supplier: true, lines: true },
    });
  });
}

export function submitPurchaseOrder(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  return documentTransaction(prisma, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status === PurchaseOrderStatus.SUBMITTED) return order;
    if (order.status !== PurchaseOrderStatus.DRAFT)
      throw new ConflictException('当前采购单不能提交');
    if (!order.lines.length) throw new ConflictException('采购单没有明细');
    const submittedAt = new Date();
    await tx.purchaseOrder.update({
      where: { id, status: order.status },
      data: {
        status: PurchaseOrderStatus.SUBMITTED,
        submittedById: actor.sub,
        submittedAt,
      },
    });
    await audit(
      tx,
      actor,
      'PURCHASE_ORDER_SUBMITTED',
      'PurchaseOrder',
      id,
      order.status,
      PurchaseOrderStatus.SUBMITTED,
      order.remark ?? '采购单提交审批',
    );
    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { supplier: true, lines: true },
    });
  });
}

export function approvePurchaseOrder(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  return documentTransaction(prisma, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status === PurchaseOrderStatus.APPROVED) return order;
    if (order.status !== PurchaseOrderStatus.SUBMITTED)
      throw new ConflictException('只有已提交采购单可以审批');
    if (order.submittedById === actor.sub || order.createdById === actor.sub) {
      throw new ForbiddenException('采购制单/提交人与审批人不能为同一账号');
    }
    await tx.purchaseOrder.update({
      where: { id, status: order.status },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedById: actor.sub,
        approvedAt: new Date(),
      },
    });
    await audit(
      tx,
      actor,
      'PURCHASE_ORDER_APPROVED',
      'PurchaseOrder',
      id,
      order.status,
      PurchaseOrderStatus.APPROVED,
      order.remark ?? '采购单审批通过',
    );
    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: { supplier: true, lines: true },
    });
  });
}

export async function receivePurchaseOrder(
  prisma: PrismaService,
  id: string,
  dto: ReceivePurchaseOrderDto,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  const existing = await prisma.purchaseReceipt.findUnique({
    where: { idempotencyKey: dto.idempotencyKey },
    include: { lines: true },
  });
  if (existing) {
    if (existing.purchaseOrderId !== id)
      throw new ConflictException('收货幂等键已用于其他采购单');
    return purchaseReceiptResponse(existing);
  }
  return documentTransaction(
    prisma,
    async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: true,
          lines: { include: { item: true, location: true } },
        },
      });
      if (!order) throw new NotFoundException('采购单不存在');
      if (order.supplier.enabled === false)
        throw new ConflictException('供应商已停用，不能继续收货');
      if (
        order.status !== PurchaseOrderStatus.APPROVED &&
        order.status !== PurchaseOrderStatus.PARTIAL_RECEIVED
      ) {
        throw new ConflictException('采购单未审批或已完成，不能收货');
      }
      if (
        new Set(dto.lines.map((line) => line.lineId)).size !== dto.lines.length
      ) {
        throw new BadRequestException('同一采购明细不能在一张收货单重复');
      }
      const receipt = await tx.purchaseReceipt.create({
        data: {
          receiptNo: serial('PR'),
          purchaseOrderId: id,
          operatorId: actor.sub,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      const receivedByLine = new Map(
        dto.lines.map((line) => [line.lineId, line.quantity]),
      );
      const currentItemStocks = new Map<string, number>();
      for (const [lineId, quantity] of receivedByLine) {
        const line = order.lines.find((entry) => entry.id === lineId);
        if (!line) throw new NotFoundException('采购收货明细不存在');
        if (line.item.enabled === false || line.location?.enabled === false)
          throw new ConflictException('采购商品或收货库位已停用');
        if (quantity > line.orderedQuantity - line.receivedQuantity) {
          throw new BadRequestException('收货数量超过采购未收数量');
        }
        const stockBefore =
          currentItemStocks.get(line.itemId) ?? line.item.stock;
        const balance = await reconciledBalance(
          tx,
          { ...line.item, stock: stockBefore },
          line.locationId,
          line.batchCode,
          line.expiresAt,
        );
        const itemChanged = await tx.inventoryItem.updateMany({
          where: { id: line.itemId, stock: stockBefore },
          data: { stock: { increment: quantity } },
        });
        if (itemChanged.count !== 1)
          throw new ConflictException('库存已被其他操作更新，请重试');
        await tx.inventoryStockBalance.update({
          where: { id: balance.id },
          data: {
            quantity: { increment: quantity },
            expiresAt: line.expiresAt,
          },
        });
        const movement = await tx.inventoryTransaction.create({
          data: {
            itemId: line.itemId,
            type:
              order.supplier.type === SupplierType.CONSIGNMENT
                ? InventoryTxnType.CONSIGNMENT_IN
                : InventoryTxnType.PURCHASE_IN,
            quantity,
            stockBefore,
            stockAfter: stockBefore + quantity,
            unitCostCents: line.unitCostCents,
            operatorId: actor.sub,
            reason: `采购收货 ${order.orderNo}`,
            idempotencyKey: `PURCHASE_RECEIPT:${dto.idempotencyKey}:${line.id}`,
            metadata: {
              purchaseOrderId: id,
              receiptId: receipt.id,
              locationId: line.locationId,
              batchCode: line.batchCode,
            } as never,
          },
        });
        await tx.purchaseReceiptLine.create({
          data: {
            receiptId: receipt.id,
            purchaseOrderLineId: line.id,
            locationId: line.locationId,
            quantity,
            batchCode: line.batchCode,
            expiresAt: line.expiresAt,
            inventoryTransactionId: movement.id,
          },
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: { increment: quantity } },
        });
        line.receivedQuantity += quantity;
        currentItemStocks.set(line.itemId, stockBefore + quantity);
      }
      const complete = order.lines.every(
        (line) => line.receivedQuantity >= line.orderedQuantity,
      );
      const status = complete
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIAL_RECEIVED;
      await tx.purchaseOrder.update({
        where: { id, status: order.status },
        data: { status },
      });
      await audit(
        tx,
        actor,
        'PURCHASE_RECEIVED',
        'PurchaseReceipt',
        receipt.id,
        order.status,
        status,
        order.remark ?? '采购分批收货',
      );
      return tx.purchaseReceipt
        .findUniqueOrThrow({
          where: { id: receipt.id },
          include: { lines: true },
        })
        .then(purchaseReceiptResponse);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function cancelPurchaseOrder(
  prisma: PrismaService,
  id: string,
  dto: CancelDocumentDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  return documentTransaction(prisma, async (tx) => {
    const order = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status === PurchaseOrderStatus.CANCELLED) return order;
    if (
      order.status !== PurchaseOrderStatus.DRAFT &&
      order.status !== PurchaseOrderStatus.SUBMITTED &&
      order.status !== PurchaseOrderStatus.APPROVED
    ) {
      throw new ConflictException('已收货采购单不能取消');
    }
    const cancelled = await tx.purchaseOrder.update({
      where: { id, status: order.status },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: dto.reason.trim(),
      },
    });
    await audit(
      tx,
      actor,
      'PURCHASE_ORDER_CANCELLED',
      'PurchaseOrder',
      id,
      order.status,
      PurchaseOrderStatus.CANCELLED,
      dto.reason.trim(),
    );
    return cancelled;
  });
}
