import type { Prisma } from '../../generated/prisma/client.js';
import { NotFoundException } from '@nestjs/common';
import {
  BusinessType,
  InventoryTxnType,
} from '../../generated/prisma/client.js';
import { applyGoodsSale } from '../goods-stock.js';
import type { PaidOrderContext } from '../../orders/paid-order-context.js';

type GoodsPaymentContext = Pick<PaidOrderContext, 'paymentActorId'> & {
  readonly tx: {
    inventoryItem: Pick<
      Prisma.TransactionClient['inventoryItem'],
      'findUnique' | 'updateMany'
    >;
    inventoryTransaction: Pick<
      Prisma.TransactionClient['inventoryTransaction'],
      'findUnique' | 'create'
    >;
    inventoryStockBalance: Pick<
      Prisma.TransactionClient['inventoryStockBalance'],
      'findMany' | 'updateMany'
    >;
  };
  readonly order: Pick<
    PaidOrderContext['order'],
    'businessType' | 'orderNo'
  > & {
    items: Pick<
      PaidOrderContext['order']['items'][number],
      'id' | 'itemId' | 'name' | 'quantity'
    >[];
  };
  readonly payment: Pick<PaidOrderContext['payment'], 'id'>;
};

export async function issuePaidGoods({
  tx,
  order,
  payment,
  paymentActorId,
}: GoodsPaymentContext): Promise<void> {
  if (order.businessType === BusinessType.GOODS) {
    for (const item of order.items) {
      if (!item.itemId) continue;
      const inventory = await tx.inventoryItem.findUnique({
        where: { id: item.itemId },
      });
      if (!inventory) throw new NotFoundException(`商品 ${item.name} 不存在`);
      const idempotencyKey = `GOODS:${payment.id}:${item.id}`;
      const existing = await tx.inventoryTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) continue;
      const { stockAfter, allocations } = await applyGoodsSale(
        tx,
        inventory,
        item.quantity,
      );
      await tx.inventoryTransaction.create({
        data: {
          itemId: inventory.id,
          type: InventoryTxnType.SALE_OUT,
          quantity: -item.quantity,
          stockBefore: inventory.stock,
          stockAfter,
          unitCostCents: inventory.purchasePriceCents,
          orderItemId: item.id,
          operatorId: paymentActorId,
          reason: `订单 ${order.orderNo} 销售出库`,
          idempotencyKey,
          metadata: { allocations },
        },
      });
    }
  }
}
