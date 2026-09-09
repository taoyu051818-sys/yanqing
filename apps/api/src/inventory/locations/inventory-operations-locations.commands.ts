import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  InventoryOperationStatus,
  Prisma,
  PurchaseOrderStatus,
  StocktakeStatus,
} from '../../generated/prisma/client.js';
import type {
  CreateInventoryLocationDto,
  SetMasterDataStatusDto,
  UpdateInventoryLocationDto,
} from '../inventory.dto.js';
import {
  assertMasterDataVersion,
  inventoryCommandHash,
  normalizeMasterCommand,
  requireTrimmedField,
} from '../inventory-master-data.js';
import {
  ADMIN_ROLES,
  READ_ROLES,
  LOCATION_CREATE_ACTION,
  LOCATION_UPDATE_ACTION,
  LOCATION_STATUS_ACTION,
  inventoryLocationResponse,
} from '../shared/inventory-operations-support.js';

import {
  executeMasterCreate,
  masterReplay,
  masterAudit,
  requireRole,
} from '../shared/inventory-operations-policy.js';

export function locations(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, READ_ROLES);
  return prisma.inventoryLocation.findMany({
    include: {
      _count: {
        select: {
          defaultItems: true,
          stockBalances: true,
          purchaseOrderLines: true,
          stocktakes: true,
        },
      },
      stockBalances: {
        include: { item: true },
        orderBy: { item: { name: 'asc' } },
      },
    },
    orderBy: [{ enabled: 'desc' }, { code: 'asc' }],
  });
}

export async function locationDetail(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, READ_ROLES);
  const location = await prisma.inventoryLocation.findUnique({
    where: { id },
    include: {
      defaultItems: { orderBy: [{ enabled: 'desc' }, { name: 'asc' }] },
      stockBalances: {
        include: { item: true },
        orderBy: [{ item: { name: 'asc' } }, { batchCode: 'asc' }],
      },
      stocktakes: { orderBy: { createdAt: 'desc' }, take: 10 },
      sourceOperations: {
        include: { item: true, targetLocation: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      targetOperations: {
        include: { item: true, sourceLocation: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: {
        select: {
          defaultItems: true,
          stockBalances: true,
          purchaseOrderLines: true,
          stocktakes: true,
        },
      },
    },
  });
  if (!location) throw new NotFoundException('库位不存在');
  return inventoryLocationResponse(location);
}

export async function createLocation(
  prisma: PrismaService,
  dto: CreateInventoryLocationDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  const { reason, requestId } = normalizeMasterCommand(
    dto.reason,
    dto.idempotencyKey,
  );
  const code = requireTrimmedField(dto.code, '库位编码', 2, 40).toUpperCase();
  const name = requireTrimmedField(dto.name, '库位名称', 2, 80);
  const hash = inventoryCommandHash({ action: 'create', code, name, reason });
  const replayId = await masterReplay(
    prisma,
    LOCATION_CREATE_ACTION,
    requestId,
    hash,
    'InventoryLocation',
    actor,
  );
  if (replayId)
    return prisma.inventoryLocation.findUniqueOrThrow({
      where: { id: replayId },
    });
  return executeMasterCreate(
    () =>
      prisma.$transaction(
        async (tx) => {
          const duplicateId = await masterReplay(
            prisma,
            LOCATION_CREATE_ACTION,
            requestId,
            hash,
            'InventoryLocation',
            actor,
            tx,
          );
          if (duplicateId)
            return tx.inventoryLocation.findUniqueOrThrow({
              where: { id: duplicateId },
            });
          const location = await tx.inventoryLocation.create({
            data: { code, name },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: LOCATION_CREATE_ACTION,
              objectType: 'InventoryLocation',
              objectId: location.id,
              oldValue: Prisma.JsonNull,
              newValue: {
                ...locationSnapshot(location),
                commandHash: hash,
              } as never,
              reason,
              requestId,
            },
          });
          return location;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    async () => {
      const duplicateId = await masterReplay(
        prisma,
        LOCATION_CREATE_ACTION,
        requestId,
        hash,
        'InventoryLocation',
        actor,
      );
      return duplicateId
        ? prisma.inventoryLocation.findUniqueOrThrow({
            where: { id: duplicateId },
          })
        : null;
    },
  );
}

export async function updateLocation(
  prisma: PrismaService,
  id: string,
  dto: UpdateInventoryLocationDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  const { reason, requestId } = normalizeMasterCommand(
    dto.reason,
    dto.idempotencyKey,
  );
  const mutable = {
    code:
      dto.code === undefined
        ? undefined
        : requireTrimmedField(dto.code, '库位编码', 2, 40).toUpperCase(),
    name:
      dto.name === undefined
        ? undefined
        : requireTrimmedField(dto.name, '库位名称', 2, 80),
  };
  if (Object.values(mutable).every((value) => value === undefined))
    throw new BadRequestException('至少填写一个需要修改的库位字段');
  const hash = inventoryCommandHash({
    action: 'update',
    id,
    expectedUpdatedAt: dto.expectedUpdatedAt,
    reason,
    mutable,
  });
  const replayId = await masterReplay(
    prisma,
    LOCATION_UPDATE_ACTION,
    requestId,
    hash,
    'InventoryLocation',
    actor,
  );
  if (replayId)
    return prisma.inventoryLocation.findUniqueOrThrow({
      where: { id: replayId },
    });
  return prisma.$transaction(
    async (tx) => {
      const duplicateId = await masterReplay(
        prisma,
        LOCATION_UPDATE_ACTION,
        requestId,
        hash,
        'InventoryLocation',
        actor,
        tx,
      );
      if (duplicateId)
        return tx.inventoryLocation.findUniqueOrThrow({
          where: { id: duplicateId },
        });
      const current = await tx.inventoryLocation.findUnique({
        where: { id },
      });
      if (!current) throw new NotFoundException('库位不存在');
      assertMasterDataVersion(current.updatedAt, dto.expectedUpdatedAt);
      const changed = await tx.inventoryLocation.updateMany({
        where: { id, updatedAt: new Date(dto.expectedUpdatedAt) },
        data: {
          ...(mutable.code !== undefined ? { code: mutable.code } : {}),
          ...(mutable.name !== undefined ? { name: mutable.name } : {}),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('库位资料已变化，请刷新后重试');
      const updated = await tx.inventoryLocation.findUniqueOrThrow({
        where: { id },
      });
      await masterAudit(
        tx,
        actor,
        LOCATION_UPDATE_ACTION,
        'InventoryLocation',
        id,
        locationSnapshot(current),
        { ...locationSnapshot(updated), commandHash: hash },
        reason,
        requestId,
      );
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function setLocationStatus(
  prisma: PrismaService,
  id: string,
  dto: SetMasterDataStatusDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  const { reason, requestId } = normalizeMasterCommand(
    dto.reason,
    dto.idempotencyKey,
  );
  const hash = inventoryCommandHash({
    action: 'status',
    id,
    enabled: dto.enabled,
    expectedUpdatedAt: dto.expectedUpdatedAt,
    reason,
  });
  const replayId = await masterReplay(
    prisma,
    LOCATION_STATUS_ACTION,
    requestId,
    hash,
    'InventoryLocation',
    actor,
  );
  if (replayId)
    return prisma.inventoryLocation.findUniqueOrThrow({
      where: { id: replayId },
    });
  return prisma.$transaction(
    async (tx) => {
      const duplicateId = await masterReplay(
        prisma,
        LOCATION_STATUS_ACTION,
        requestId,
        hash,
        'InventoryLocation',
        actor,
        tx,
      );
      if (duplicateId)
        return tx.inventoryLocation.findUniqueOrThrow({
          where: { id: duplicateId },
        });
      const current = await tx.inventoryLocation.findUnique({
        where: { id },
      });
      if (!current) throw new NotFoundException('库位不存在');
      assertMasterDataVersion(current.updatedAt, dto.expectedUpdatedAt);
      if (current.enabled === dto.enabled)
        throw new ConflictException(
          dto.enabled ? '库位已经启用' : '库位已经停用',
        );
      if (!dto.enabled) await assertLocationCanDisable(tx, id);
      const changed = await tx.inventoryLocation.updateMany({
        where: {
          id,
          enabled: current.enabled,
          updatedAt: new Date(dto.expectedUpdatedAt),
        },
        data: { enabled: dto.enabled },
      });
      if (changed.count !== 1)
        throw new ConflictException('库位状态已变化，请刷新后重试');
      const updated = await tx.inventoryLocation.findUniqueOrThrow({
        where: { id },
      });
      await masterAudit(
        tx,
        actor,
        LOCATION_STATUS_ACTION,
        'InventoryLocation',
        id,
        locationSnapshot(current),
        { ...locationSnapshot(updated), commandHash: hash },
        reason,
        requestId,
      );
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function assertLocationCanDisable(
  tx: Prisma.TransactionClient,
  locationId: string,
) {
  const [balance, defaultItems, purchaseLines, stocktakes, operations] =
    await Promise.all([
      tx.inventoryStockBalance.aggregate({
        where: { locationId },
        _sum: { quantity: true },
      }),
      tx.inventoryItem.count({
        where: { defaultLocationId: locationId, enabled: true },
      }),
      tx.purchaseOrderLine.count({
        where: {
          locationId,
          purchaseOrder: {
            status: {
              in: [
                PurchaseOrderStatus.DRAFT,
                PurchaseOrderStatus.SUBMITTED,
                PurchaseOrderStatus.APPROVED,
                PurchaseOrderStatus.PARTIAL_RECEIVED,
              ],
            },
          },
        },
      }),
      tx.stocktake.count({
        where: {
          locationId,
          status: {
            in: [
              StocktakeStatus.DRAFT,
              StocktakeStatus.COUNTING,
              StocktakeStatus.REVIEW,
            ],
          },
        },
      }),
      tx.inventoryOperation.count({
        where: {
          OR: [
            { sourceLocationId: locationId },
            { targetLocationId: locationId },
          ],
          status: {
            in: [
              InventoryOperationStatus.DRAFT,
              InventoryOperationStatus.SUBMITTED,
              InventoryOperationStatus.APPROVED,
            ],
          },
        },
      }),
    ]);
  const blockers = [
    Number(balance._sum.quantity || 0)
      ? `现存数量 ${Number(balance._sum.quantity || 0)}`
      : '',
    defaultItems ? `启用商品默认库位 ${defaultItems}` : '',
    purchaseLines ? `未完采购明细 ${purchaseLines}` : '',
    stocktakes ? `未完盘点单 ${stocktakes}` : '',
    operations ? `未过账库存单 ${operations}` : '',
  ].filter(Boolean);
  if (blockers.length)
    throw new ConflictException(`库位暂不能停用：${blockers.join('、')}`);
}

export function locationSnapshot(location: {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  updatedAt: Date;
}) {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    enabled: location.enabled,
    updatedAt: location.updatedAt.toISOString(),
  };
}
