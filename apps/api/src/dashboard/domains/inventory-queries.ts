import { PrismaService } from '../../database/prisma.service.js';
import {
  BusinessType,
  InventoryTxnType,
} from '../../generated/prisma/enums.js';

export function loadInventoryItems(prisma: PrismaService) {
  return prisma.inventoryItem.findMany({
    where: { enabled: true },
    select: {
      stock: true,
      safeStock: true,
      purchasePriceCents: true,
    },
  });
}

export function loadGoodsCostTransactions(
  prisma: PrismaService,
  start: Date,
  end: Date,
) {
  return prisma.inventoryTransaction.findMany({
    where: {
      OR: [
        {
          type: InventoryTxnType.SALE_OUT,
          orderItem: {
            order: {
              businessType: BusinessType.GOODS,
              completedAt: { gte: start, lt: end },
            },
          },
        },
        {
          type: InventoryTxnType.ADJUSTMENT,
          quantity: { gt: 0 },
          createdAt: { gte: start, lt: end },
          idempotencyKey: { startsWith: 'GOODS-REFUND:' },
          orderItem: { order: { businessType: BusinessType.GOODS } },
        },
      ],
    },
    select: { type: true, quantity: true, unitCostCents: true },
  });
}
