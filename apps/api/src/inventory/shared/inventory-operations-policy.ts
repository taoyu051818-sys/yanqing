import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, Prisma } from '../../generated/prisma/client.js';

export async function documentTransaction<T>(
  prisma: PrismaService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
): Promise<T> {
  try {
    return await prisma.$transaction(work, options);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2034', 'P2025'].includes(error.code)
    )
      throw new ConflictException(
        '库存单据或库存已被其他操作更新，请刷新后重试',
      );
    throw error;
  }
}

export async function reconciledBalance(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    stock: number;
    defaultLocationId: string | null;
    batchCode?: string | null;
  },
  locationId: string,
  batchCode: string,
  expiresAt: Date | null,
) {
  const key = {
    itemId_locationId_batchCode: { itemId: item.id, locationId, batchCode },
  };
  let balance = await tx.inventoryStockBalance.findUnique({ where: key });
  if (
    balance &&
    (balance.expiresAt?.getTime() ?? null) !== (expiresAt?.getTime() ?? null)
  ) {
    throw new ConflictException('同一商品、库位和批次只能对应一个效期');
  }
  if (!balance) {
    balance = await tx.inventoryStockBalance.create({
      data: {
        itemId: item.id,
        locationId,
        batchCode,
        expiresAt,
        quantity: 0,
      },
    });
  }
  if (
    item.defaultLocationId === locationId &&
    batchCode === batch(item.batchCode)
  ) {
    const others = await tx.inventoryStockBalance.findMany({
      where: { itemId: item.id, NOT: { id: balance.id } },
      select: { quantity: true },
    });
    const derived =
      item.stock - others.reduce((sum, entry) => sum + entry.quantity, 0);
    if (derived < 0)
      throw new ConflictException('库位库存合计超过总库存，请先盘点修复');
    if (balance.quantity !== derived) {
      throw new ConflictException('库存总账与库位分账不一致，请先盘点修复');
    }
  }
  return balance;
}

export async function executeMasterCreate<T>(
  execute: () => Promise<T>,
  replay: () => Promise<T | null>,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt === 0
      ) {
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        const duplicate = await replay();
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }
  throw new ConflictException('库存主数据创建并发冲突，请重试');
}

export async function masterReplay(
  prisma: PrismaService,
  action: string,
  requestId: string,
  hash: string,
  objectType: string,
  actor: AuthUser,
  transaction?: Prisma.TransactionClient,
) {
  const client = transaction ?? prisma;
  const audit = await client.auditLog.findFirst({
    where: { action, requestId, objectType },
    orderBy: { createdAt: 'desc' },
  });
  if (!audit) return null;
  if (audit.actorId !== actor.sub)
    throw new ConflictException('库存主数据幂等键已由其他操作人使用');
  const value =
    audit.newValue && typeof audit.newValue === 'object'
      ? (audit.newValue as Record<string, unknown>)
      : null;
  if (value?.commandHash !== hash)
    throw new ConflictException('幂等键已用于其他库存主数据指令');
  if (!audit.objectId)
    throw new ConflictException('库存主数据幂等记录不完整，请联系管理员');
  return audit.objectId;
}

export function masterAudit(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  action: string,
  objectType: string,
  objectId: string,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  reason: string,
  requestId: string,
) {
  return tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: actor.roles[0],
      action,
      objectType,
      objectId,
      oldValue: oldValue as never,
      newValue: newValue as never,
      reason,
      requestId,
    },
  });
}

export function batch(value: string | null | undefined) {
  return value?.trim() || 'DEFAULT';
}

export function requireRole(actor: AuthUser, allowed: readonly AppRole[]) {
  if (!actor.roles.some((role) => allowed.includes(role))) {
    throw new ForbiddenException('当前角色无权执行该库存业务动作');
  }
}

export function audit(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  action: string,
  objectType: string,
  objectId: string,
  oldStatus: string,
  newStatus: string,
  reason?: string,
) {
  return tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: actor.roles[0],
      action,
      objectType,
      objectId,
      oldValue: { status: oldStatus } as never,
      newValue: { status: newStatus } as never,
      reason,
    },
  });
}
