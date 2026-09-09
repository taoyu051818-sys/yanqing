import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AppRole,
  BusinessType,
  ConsignmentPayableEntryType,
  InventoryTxnType,
  Prisma,
  RefundStatus,
} from '../../../generated/prisma/client.js';
import {
  ConsignmentOrderSnapshotError,
  readConsignmentOrderSnapshot,
} from '../../consignment-order-snapshot.js';
import { asRecord } from '../../shared/consignment-settlement-support.js';

export async function recordCompletedGoodsSale(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string,
  actorRole: AppRole,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          inventoryTransactions: {
            where: { type: InventoryTxnType.SALE_OUT },
          },
        },
      },
    },
  });
  if (!order) throw new NotFoundException('商品订单不存在');
  if (order.businessType !== BusinessType.GOODS)
    throw new ConflictException('仅商品订单可生成寄售应付');
  if (!order.completedAt)
    throw new ConflictException('商品订单尚未完成履约，不能生成寄售应付');

  const created = [];

  for (const orderItem of order.items) {
    if (!orderItem.itemId) continue;
    let orderSnapshot: ReturnType<typeof readConsignmentOrderSnapshot>;
    try {
      orderSnapshot = readConsignmentOrderSnapshot(orderItem.metadata);
    } catch (error) {
      if (error instanceof ConsignmentOrderSnapshotError)
        throw new ConflictException(error.message);
      throw error;
    }
    if (!orderSnapshot) continue;
    if (
      !orderItem.inventoryTransactions.some(
        (entry) => entry.quantity === -orderItem.quantity,
      )
    ) {
      throw new ConflictException(`商品 ${orderItem.name} 尚未完成销售出库`);
    }
    const grossSaleCents = orderItem.unitPriceCents * orderItem.quantity;
    if (grossSaleCents !== orderItem.amountCents)
      throw new ConflictException(
        `商品 ${orderItem.name} 的成交金额快照不一致`,
      );
    if (grossSaleCents <= 0) continue;
    const commissionCents = Math.round(
      (grossSaleCents * orderSnapshot.commissionRateBps) / 10_000,
    );
    const payableCents = grossSaleCents - commissionCents;
    const idempotencyKey = `CONSIGNMENT-SALE:${orderItem.id}`;
    const existing = await tx.consignmentPayableEntry.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (
        existing.orderId !== order.id ||
        existing.orderItemId !== orderItem.id ||
        existing.supplierId !== orderSnapshot.supplierId ||
        existing.payableCents !== payableCents
      ) {
        throw new ConflictException('寄售销售应付幂等记录与当前订单不一致');
      }
      created.push(existing);
      continue;
    }
    const payable = await tx.consignmentPayableEntry.create({
      data: {
        type: ConsignmentPayableEntryType.SALE,
        supplierId: orderSnapshot.supplierId,
        itemId: orderItem.itemId,
        orderId: order.id,
        orderItemId: orderItem.id,
        quantity: orderItem.quantity,
        unitSalePriceCents: orderItem.unitPriceCents,
        grossSaleCents,
        commissionRateBps: orderSnapshot.commissionRateBps,
        commissionCents,
        payableCents,
        ruleSnapshot: {
          supplierCode: orderSnapshot.supplierCode,
          supplierName: orderSnapshot.supplierName,
          sku: orderSnapshot.sku,
          itemName: orderItem.name,
          settlementCycle: orderSnapshot.settlementCycle,
          commissionRateBps: orderSnapshot.commissionRateBps,
          commissionMeaning: 'VENUE_COMMISSION',
        },
        occurredAt: order.completedAt,
        idempotencyKey,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action: 'CONSIGNMENT_PAYABLE_SALE_RECORDED',
        objectType: 'ConsignmentPayableEntry',
        objectId: payable.id,
        reason: `商品订单 ${order.orderNo} 完成履约`,
        newValue: {
          supplierId: orderSnapshot.supplierId,
          itemId: orderItem.itemId,
          orderId: order.id,
          orderItemId: orderItem.id,
          quantity: orderItem.quantity,
          grossSaleCents,
          commissionCents,
          payableCents,
        } as never,
        requestId: idempotencyKey,
      },
    });
    created.push(payable);
  }
  return created;
}

export async function recordSucceededGoodsRefund(
  tx: Prisma.TransactionClient,
  refundId: string,
  actorId: string,
  actorRole: AppRole,
) {
  const refund = await tx.refund.findUnique({
    where: { id: refundId },
    include: { order: true },
  });
  if (!refund) throw new NotFoundException('商品退款不存在');
  if (
    refund.status !== RefundStatus.SUCCEEDED ||
    !refund.completedAt ||
    refund.order.businessType !== BusinessType.GOODS
  ) {
    throw new ConflictException('仅成功的商品退款可反冲寄售应付');
  }
  if (refund.order.refundedCents < refund.order.paidCents)
    throw new ConflictException('商品订单尚未整单退款，不能反冲寄售应付');

  const sales = await tx.consignmentPayableEntry.findMany({
    where: {
      orderId: refund.orderId,
      type: ConsignmentPayableEntryType.SALE,
    },
    include: { reversedBy: true },
    orderBy: { createdAt: 'asc' },
  });
  const reversals = [];
  for (const sale of sales) {
    if (sale.reversedBy) {
      if (sale.reversedBy.refundId !== refund.id)
        throw new ConflictException('寄售应付已由其他退款记录反冲');
      reversals.push(sale.reversedBy);
      continue;
    }
    const idempotencyKey = `CONSIGNMENT-REFUND:${refund.id}:${sale.id}`;
    const reversal = await tx.consignmentPayableEntry.create({
      data: {
        type: ConsignmentPayableEntryType.REFUND_REVERSAL,
        supplierId: sale.supplierId,
        itemId: sale.itemId,
        orderId: sale.orderId,
        orderItemId: sale.orderItemId,
        refundId: refund.id,
        reversalOfId: sale.id,
        quantity: -sale.quantity,
        unitSalePriceCents: sale.unitSalePriceCents,
        grossSaleCents: -sale.grossSaleCents,
        commissionRateBps: sale.commissionRateBps,
        commissionCents: -sale.commissionCents,
        payableCents: -sale.payableCents,
        ruleSnapshot: {
          ...asRecord(sale.ruleSnapshot),
          reversalOfEntryId: sale.id,
          refundNo: refund.refundNo,
        },
        occurredAt: refund.completedAt,
        idempotencyKey,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action: 'CONSIGNMENT_PAYABLE_REFUND_REVERSED',
        objectType: 'ConsignmentPayableEntry',
        objectId: reversal.id,
        reason: refund.reason,
        oldValue: {
          saleEntryId: sale.id,
          payableCents: sale.payableCents,
        } as never,
        newValue: {
          refundId: refund.id,
          reversalOfId: sale.id,
          payableCents: -sale.payableCents,
        } as never,
        requestId: idempotencyKey,
      },
    });
    reversals.push(reversal);
  }
  return reversals;
}
