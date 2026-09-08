import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { applyInventoryDelta } from './inventory-balance.js';

type GoodsLine = { itemId: string | null; name: string; quantity: number };
type StockItem = {
  id: string;
  stock: number;
  defaultLocationId: string | null;
  batchCode: string | null;
  expiresAt: Date | null;
};
type Allocation = {
  balanceId: string;
  locationId: string;
  batchCode: string;
  quantity: number;
};

async function stockBalances(
  tx: Prisma.TransactionClient,
  item: { id: string; stock: number },
) {
  const balances = await tx.inventoryStockBalance.findMany({
    where: { itemId: item.id },
    // Consume dated batches first, then undated batches, with stable tie breaking.
    orderBy: [
      { expiresAt: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });
  if (
    balances.some((balance) => balance.quantity < 0) ||
    balances.reduce((sum, balance) => sum + balance.quantity, 0) !== item.stock
  ) {
    throw new ConflictException('库存总账与库位分账不一致，请先盘点修复');
  }
  return balances;
}

/** PROCESSING WeChat orders hold stock until cancellation or successful fulfillment. */
export async function assertGoodsStockAvailable(
  tx: Prisma.TransactionClient,
  lines: GoodsLine[],
  options: { orderId?: string; reservePayments?: boolean; lock?: boolean } = {},
) {
  const required = new Map<string, { name: string; quantity: number }>();
  for (const line of lines) {
    if (!line.itemId) throw new ConflictException('商品订单缺少可出库明细');
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      throw new ConflictException('商品订单数量异常');
    const previous = required.get(line.itemId);
    required.set(line.itemId, {
      name: line.name,
      quantity: (previous?.quantity ?? 0) + line.quantity,
    });
  }
  if (!required.size) throw new ConflictException('商品订单缺少可出库明细');
  const ids = [...required.keys()].sort();
  if (options.lock) {
    // A row write serializes competing reservations before calling WeChat.
    // Under SERIALIZABLE a stale competing transaction fails here and can retry.
    for (const id of ids)
      await tx.inventoryItem.updateMany({
        where: { id },
        data: { stock: { increment: 0 } },
      });
  }
  const inventory = await tx.inventoryItem.findMany({
    where: { id: { in: ids }, enabled: true },
  });
  const held = new Map<string, number>();
  if (options.reservePayments) {
    const reservations = await tx.orderItem.findMany({
      where: {
        itemId: { in: ids },
        order: {
          id: options.orderId ? { not: options.orderId } : undefined,
          businessType: 'GOODS',
          status: 'PENDING',
          payments: { some: { channel: 'WECHAT', status: 'PROCESSING' } },
        },
      },
      select: { itemId: true, quantity: true },
    });
    for (const line of reservations)
      if (line.itemId)
        held.set(line.itemId, (held.get(line.itemId) ?? 0) + line.quantity);
  }
  for (const [id, demand] of required) {
    const item = inventory.find((entry) => entry.id === id);
    if (!item) throw new BadRequestException(`${demand.name} 已下架，无法支付`);
    if (item.stock - (held.get(id) ?? 0) < demand.quantity)
      throw new BadRequestException(`${item.name} 库存不足，无法支付`);
    await stockBalances(tx, item);
  }
}

export async function applyGoodsSale(
  tx: Prisma.TransactionClient,
  item: StockItem,
  quantity: number,
) {
  const balances = await stockBalances(tx, item);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || item.stock < quantity)
    throw new BadRequestException('库存不足');
  let remaining = quantity;
  const allocations: Allocation[] = [];
  for (const balance of balances) {
    const take = Math.min(remaining, balance.quantity);
    if (!take) continue;
    const changed = await tx.inventoryStockBalance.updateMany({
      where: { id: balance.id, quantity: balance.quantity },
      data: { quantity: balance.quantity - take },
    });
    if (changed.count !== 1)
      throw new ConflictException('库存已被其他操作更新，请重试');
    allocations.push({
      balanceId: balance.id,
      locationId: balance.locationId,
      batchCode: balance.batchCode,
      quantity: take,
    });
    remaining -= take;
    if (!remaining) break;
  }
  const stockAfter = item.stock - quantity;
  const changed = await tx.inventoryItem.updateMany({
    where: { id: item.id, stock: item.stock },
    data: { stock: stockAfter },
  });
  if (changed.count !== 1)
    throw new ConflictException('库存已被其他操作更新，请重试');
  return { stockAfter, allocations };
}

/** Full goods refunds restore the actual batches sold; legacy sales use the old default balance. */
export async function restoreGoodsSale(
  tx: Prisma.TransactionClient,
  item: StockItem,
  quantity: number,
  orderItemId: string,
) {
  const sale = await tx.inventoryTransaction.findFirst({
    where: { orderItemId, type: 'SALE_OUT' },
    orderBy: { createdAt: 'asc' },
  });
  const metadata = sale?.metadata as { allocations?: Allocation[] } | null;
  if (!metadata?.allocations) return applyInventoryDelta(tx, item, quantity);
  const allocations = metadata.allocations;
  if (
    !Array.isArray(allocations) ||
    allocations.some(
      (entry) =>
        !entry || !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0,
    ) ||
    allocations.reduce((sum, entry) => sum + entry.quantity, 0) !== quantity
  ) {
    throw new ConflictException('销售批次记录异常，请核对出库流水');
  }
  const balances = await stockBalances(tx, item);
  for (const allocation of allocations) {
    const balance = balances.find(
      (entry) =>
        entry.id === allocation.balanceId &&
        entry.locationId === allocation.locationId &&
        entry.batchCode === allocation.batchCode,
    );
    if (!balance)
      throw new ConflictException('原销售批次不存在，请核对出库流水');
    const changed = await tx.inventoryStockBalance.updateMany({
      where: { id: balance.id, quantity: balance.quantity },
      data: { quantity: { increment: allocation.quantity } },
    });
    if (changed.count !== 1)
      throw new ConflictException('库存已被其他操作更新，请重试');
  }
  const stockAfter = item.stock + quantity;
  const changed = await tx.inventoryItem.updateMany({
    where: { id: item.id, stock: item.stock },
    data: { stock: stockAfter },
  });
  if (changed.count !== 1)
    throw new ConflictException('库存已被其他操作更新，请重试');
  return { stockAfter };
}
