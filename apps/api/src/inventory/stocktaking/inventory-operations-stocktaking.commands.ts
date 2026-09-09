import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  InventoryTxnType,
  Prisma,
  StocktakeStatus,
} from '../../generated/prisma/client.js';
import type {
  CountStocktakeLineDto,
  CreateStocktakeDto,
  PostStocktakeDto,
} from '../inventory.dto.js';
import {
  serial,
  ADMIN_ROLES,
  FRONT_ROLES,
  READ_ROLES,
  stocktakeResponse,
} from '../shared/inventory-operations-support.js';
import {
  reconciledBalance,
  batch,
  requireRole,
  audit,
} from '../shared/inventory-operations-policy.js';

export function stocktakes(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, READ_ROLES);
  return prisma.stocktake
    .findMany({
      include: { location: true, lines: { include: { item: true } } },
      orderBy: { createdAt: 'desc' },
    })
    .then((documents) => documents.map(stocktakeResponse));
}

export async function createStocktake(
  prisma: PrismaService,
  dto: CreateStocktakeDto,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  const location = await prisma.inventoryLocation.findUnique({
    where: { id: dto.locationId },
  });
  if (!location?.enabled) throw new NotFoundException('盘点库位不存在或已停用');
  const created = await prisma.stocktake.create({
    data: {
      stocktakeNo: serial('ST'),
      locationId: location.id,
      reason: dto.reason.trim(),
      createdById: actor.sub,
    },
    include: { location: true, lines: true },
  });
  return stocktakeResponse(created);
}

export function startStocktake(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  return prisma
    .$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: { location: true },
      });
      if (!stocktake) throw new NotFoundException('盘点单不存在');
      if (stocktake.location?.enabled === false)
        throw new ConflictException('盘点库位已停用');
      if (stocktake.status === StocktakeStatus.COUNTING) return stocktake;
      if (stocktake.status !== StocktakeStatus.DRAFT)
        throw new ConflictException('当前盘点单不能开始盘点');
      const items = await tx.inventoryItem.findMany({
        where: { enabled: true },
      });
      for (const item of items.filter(
        (entry) => entry.defaultLocationId === stocktake.locationId,
      )) {
        await reconciledBalance(
          tx,
          item,
          stocktake.locationId,
          batch(item.batchCode),
          item.expiresAt,
        );
      }
      let balances = await tx.inventoryStockBalance.findMany({
        where: { locationId: stocktake.locationId, item: { enabled: true } },
        include: { item: true },
      });
      const itemIdsWithBalance = new Set(
        balances.map((balance) => balance.itemId),
      );
      for (const item of items.filter(
        (entry) => !itemIdsWithBalance.has(entry.id),
      )) {
        const balance = await tx.inventoryStockBalance.create({
          data: {
            itemId: item.id,
            locationId: stocktake.locationId,
            batchCode: 'DEFAULT',
            quantity: 0,
          },
          include: { item: true },
        });
        balances.push(balance);
      }
      for (const balance of balances) {
        await tx.stocktakeLine.create({
          data: {
            stocktakeId: id,
            itemId: balance.itemId,
            batchCode: balance.batchCode,
            expiresAt: balance.expiresAt,
            bookQuantity: balance.quantity,
          },
        });
      }
      await tx.stocktake.update({
        where: { id },
        data: { status: StocktakeStatus.COUNTING, startedAt: new Date() },
      });
      await audit(
        tx,
        actor,
        'STOCKTAKE_STARTED',
        'Stocktake',
        id,
        StocktakeStatus.DRAFT,
        StocktakeStatus.COUNTING,
        stocktake.reason,
      );
      return tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: { location: true, lines: { include: { item: true } } },
      });
    })
    .then(stocktakeResponse);
}

export function countStocktakeLine(
  prisma: PrismaService,
  id: string,
  lineId: string,
  dto: CountStocktakeLineDto,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  return prisma.$transaction(async (tx) => {
    const stocktake = await tx.stocktake.findUnique({ where: { id } });
    if (!stocktake || stocktake.status !== StocktakeStatus.COUNTING) {
      throw new ConflictException('盘点单不在录数状态');
    }
    const line = await tx.stocktakeLine.findFirst({
      where: { id: lineId, stocktakeId: id },
    });
    if (!line) throw new NotFoundException('盘点明细不存在');
    const countedLine = await tx.stocktakeLine.update({
      where: { id: lineId },
      data: {
        countedQuantity: dto.countedQuantity,
        difference: dto.countedQuantity - line.bookQuantity,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'STOCKTAKE_LINE_COUNTED',
        objectType: 'StocktakeLine',
        objectId: lineId,
        oldValue: { countedQuantity: line.countedQuantity } as never,
        newValue: { countedQuantity: dto.countedQuantity } as never,
        reason: stocktake.reason,
      },
    });
    return countedLine;
  });
}

export function submitStocktake(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, FRONT_ROLES);
  return prisma
    .$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!stocktake) throw new NotFoundException('盘点单不存在');
      if (stocktake.status === StocktakeStatus.REVIEW) return stocktake;
      if (stocktake.status !== StocktakeStatus.COUNTING)
        throw new ConflictException('盘点单不在录数状态');
      if (
        !stocktake.lines.length ||
        stocktake.lines.some((line) => line.countedQuantity === null)
      ) {
        throw new ConflictException('仍有盘点明细未录入实盘数量');
      }
      await tx.stocktake.update({
        where: { id },
        data: {
          status: StocktakeStatus.REVIEW,
          submittedById: actor.sub,
          submittedAt: new Date(),
        },
      });
      await audit(
        tx,
        actor,
        'STOCKTAKE_SUBMITTED',
        'Stocktake',
        id,
        StocktakeStatus.COUNTING,
        StocktakeStatus.REVIEW,
        stocktake.reason,
      );
      return tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: { location: true, lines: { include: { item: true } } },
      });
    })
    .then(stocktakeResponse);
}

export async function postStocktake(
  prisma: PrismaService,
  id: string,
  dto: PostStocktakeDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  return prisma.$transaction(
    async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: { lines: { include: { item: true } } },
      });
      if (!stocktake) throw new NotFoundException('盘点单不存在');
      if (stocktake.status === StocktakeStatus.POSTED) {
        if (stocktake.postIdempotencyKey !== dto.idempotencyKey)
          throw new ConflictException('盘点单已使用其他幂等键过账');
        return stocktakeResponse(stocktake);
      }
      if (stocktake.status !== StocktakeStatus.REVIEW)
        throw new ConflictException('盘点单尚未提交复核');
      if (
        stocktake.submittedById === actor.sub ||
        stocktake.createdById === actor.sub
      ) {
        throw new ForbiddenException(
          '盘点制单/提交人与过账审批人不能为同一账号',
        );
      }
      const currentItemStocks = new Map<string, number>();
      for (const line of stocktake.lines) {
        if (line.countedQuantity === null)
          throw new ConflictException('盘点明细未录完');
        const stockBefore =
          currentItemStocks.get(line.itemId) ?? line.item.stock;
        const balance = await reconciledBalance(
          tx,
          { ...line.item, stock: stockBefore },
          stocktake.locationId,
          line.batchCode,
          line.expiresAt,
        );
        if (balance.quantity !== line.bookQuantity)
          throw new ConflictException('盘点期间库存已变化，请重新盘点');
        const difference = line.countedQuantity - line.bookQuantity;
        if (difference === 0) continue;
        if (stockBefore + difference < 0)
          throw new BadRequestException('盘点差异会导致总库存为负数');
        const itemChanged = await tx.inventoryItem.updateMany({
          where: { id: line.itemId, stock: stockBefore },
          data: { stock: { increment: difference } },
        });
        if (itemChanged.count !== 1)
          throw new ConflictException('库存已变化，请重新盘点');
        await tx.inventoryStockBalance.update({
          where: { id: balance.id },
          data: { quantity: line.countedQuantity },
        });
        const movement = await tx.inventoryTransaction.create({
          data: {
            itemId: line.itemId,
            type:
              difference > 0
                ? InventoryTxnType.STOCKTAKE_GAIN
                : InventoryTxnType.STOCKTAKE_LOSS,
            quantity: difference,
            stockBefore,
            stockAfter: stockBefore + difference,
            operatorId: actor.sub,
            reason: `盘点过账 ${stocktake.stocktakeNo}`,
            idempotencyKey: `STOCKTAKE:${dto.idempotencyKey}:${line.id}`,
            metadata: {
              stocktakeId: id,
              locationId: stocktake.locationId,
              batchCode: line.batchCode,
            } as never,
          },
        });
        await tx.stocktakeLine.update({
          where: { id: line.id },
          data: { difference, inventoryTransactionId: movement.id },
        });
        currentItemStocks.set(line.itemId, stockBefore + difference);
      }
      await tx.stocktake.update({
        where: { id },
        data: {
          status: StocktakeStatus.POSTED,
          reviewedById: actor.sub,
          reviewedAt: new Date(),
          postedById: actor.sub,
          postedAt: new Date(),
          postIdempotencyKey: dto.idempotencyKey,
        },
      });
      await audit(
        tx,
        actor,
        'STOCKTAKE_POSTED',
        'Stocktake',
        id,
        StocktakeStatus.REVIEW,
        StocktakeStatus.POSTED,
        stocktake.reason,
      );
      return tx.stocktake
        .findUniqueOrThrow({
          where: { id },
          include: { location: true, lines: { include: { item: true } } },
        })
        .then(stocktakeResponse);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
