import { BadRequestException, ConflictException } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';

type StockItem = {
  id: string;
  stock: number;
  defaultLocationId: string | null;
  batchCode: string | null;
  expiresAt: Date | null;
};

/** Apply aggregate stock and its default-location balance atomically. */
export async function applyInventoryDelta(
  tx: Prisma.TransactionClient,
  item: StockItem,
  quantity: number,
) {
  if (!item.defaultLocationId)
    throw new ConflictException('库存商品未配置默认库位');
  const batchCode = item.batchCode?.trim() || 'DEFAULT';
  const key = {
    itemId_locationId_batchCode: {
      itemId: item.id,
      locationId: item.defaultLocationId,
      batchCode,
    },
  };
  const [balance, allBalances] = await Promise.all([
    tx.inventoryStockBalance.findUnique({ where: key }),
    tx.inventoryStockBalance.findMany({
      where: { itemId: item.id },
      select: { quantity: true },
    }),
  ]);
  if (!balance) throw new ConflictException('库存商品默认库位余额未初始化');
  if (
    allBalances.reduce((sum, entry) => sum + entry.quantity, 0) !== item.stock
  ) {
    throw new ConflictException('库存总账与库位分账不一致，请先盘点修复');
  }
  const stockAfter = item.stock + quantity;
  const balanceAfter = balance.quantity + quantity;
  if (stockAfter < 0 || balanceAfter < 0)
    throw new BadRequestException('库存不足');
  const [itemChanged, balanceChanged] = await Promise.all([
    tx.inventoryItem.updateMany({
      where: { id: item.id, stock: item.stock },
      data: { stock: stockAfter },
    }),
    tx.inventoryStockBalance.updateMany({
      where: { id: balance.id, quantity: balance.quantity },
      data: { quantity: balanceAfter },
    }),
  ]);
  if (itemChanged.count !== 1 || balanceChanged.count !== 1) {
    throw new ConflictException('库存已被其他操作更新，请重试');
  }
  return { stockBefore: item.stock, stockAfter };
}
