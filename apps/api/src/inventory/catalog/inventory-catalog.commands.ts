import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  CreateInventoryItemDto,
  SetMasterDataStatusDto,
  UpdateInventoryItemDto,
} from '../inventory.dto.js';
import {
  assertMasterDataVersion,
  inventoryCommandHash,
  normalizeMasterCommand,
  requireTrimmedField,
} from '../inventory-master-data.js';
import {
  ADMIN_ROLES,
  ITEM_UPDATE_ACTION,
  ITEM_STATUS_ACTION,
} from '../shared/inventory-support.js';
import {
  itemReplay,
  assertModeMatchesSupplier,
  assertItemCanDisable,
  itemSnapshot,
  requireRole,
} from './inventory-catalog.policy.js';

export async function create(
  prisma: PrismaService,
  dto: CreateInventoryItemDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  const { reason, requestId } = normalizeMasterCommand(
    dto.reason,
    dto.idempotencyKey,
  );
  const sku = requireTrimmedField(dto.sku, 'SKU 编码', 1, 60).toUpperCase();
  const name = requireTrimmedField(dto.name, '商品名称', 1, 120);
  const category = requireTrimmedField(dto.category, '商品分类', 1, 80);
  const supplierId = requireTrimmedField(dto.supplierId, '供应商', 1, 100);
  const defaultLocationId = requireTrimmedField(
    dto.defaultLocationId,
    '默认库位',
    1,
    100,
  );
  const hash = inventoryCommandHash({
    action: 'create',
    sku,
    name,
    category,
    mode: dto.mode,
    supplierId,
    defaultLocationId,
    purchasePriceCents: dto.purchasePriceCents,
    salePriceCents: dto.salePriceCents,
    safeStock: dto.safeStock,
    batchCode: dto.batchCode?.trim() || 'DEFAULT',
    expiresAt: dto.expiresAt ?? null,
    reason,
  });
  const replay = await itemReplay(
    prisma,
    'INVENTORY_ITEM_CREATED',
    requestId,
    hash,
    actor,
  );
  if (replay) return replay;
  const execute = () =>
    prisma.$transaction(
      async (tx) => {
        const duplicate = await itemReplay(
          prisma,
          'INVENTORY_ITEM_CREATED',
          requestId,
          hash,
          actor,
          tx,
        );
        if (duplicate) return duplicate;
        const [supplier, location] = await Promise.all([
          tx.supplier.findUnique({ where: { id: supplierId } }),
          tx.inventoryLocation.findUnique({
            where: { id: defaultLocationId },
          }),
        ]);
        if (!supplier?.enabled)
          throw new ConflictException('供应商不存在或已停用');
        if (!location?.enabled)
          throw new ConflictException('默认库位不存在或已停用');
        assertModeMatchesSupplier(dto.mode, supplier.type);
        const batchCode = dto.batchCode?.trim() || 'DEFAULT';
        const item = await tx.inventoryItem.create({
          data: {
            sku,
            name,
            category,
            mode: dto.mode,
            supplier: supplier.name,
            supplierId: supplier.id,
            defaultLocationId: location.id,
            purchasePriceCents: dto.purchasePriceCents,
            salePriceCents: dto.salePriceCents,
            safeStock: dto.safeStock,
            batchCode,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          },
        });
        await tx.inventoryStockBalance.create({
          data: {
            itemId: item.id,
            locationId: location.id,
            batchCode,
            expiresAt: item.expiresAt,
            quantity: 0,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'INVENTORY_ITEM_CREATED',
            objectType: 'InventoryItem',
            objectId: item.id,
            oldValue: Prisma.JsonNull,
            newValue: {
              ...itemSnapshot(item),
              commandHash: hash,
            } as never,
            reason,
            requestId,
          },
        });
        return item;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
        const duplicate = await itemReplay(
          prisma,
          'INVENTORY_ITEM_CREATED',
          requestId,
          hash,
          actor,
        );
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }
  throw new ConflictException('商品创建并发冲突，请重试');
}

export async function update(
  prisma: PrismaService,
  id: string,
  dto: UpdateInventoryItemDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  const { reason, requestId } = normalizeMasterCommand(
    dto.reason,
    dto.idempotencyKey,
  );
  const mutable = {
    sku:
      dto.sku === undefined
        ? undefined
        : requireTrimmedField(dto.sku, 'SKU 编码', 1, 60).toUpperCase(),
    name:
      dto.name === undefined
        ? undefined
        : requireTrimmedField(dto.name, '商品名称', 1, 120),
    category:
      dto.category === undefined
        ? undefined
        : requireTrimmedField(dto.category, '商品分类', 1, 80),
    mode: dto.mode,
    supplierId:
      dto.supplierId === undefined
        ? undefined
        : requireTrimmedField(dto.supplierId, '供应商', 1, 100),
    defaultLocationId:
      dto.defaultLocationId === undefined
        ? undefined
        : requireTrimmedField(dto.defaultLocationId, '默认库位', 1, 100),
    purchasePriceCents: dto.purchasePriceCents,
    salePriceCents: dto.salePriceCents,
    safeStock: dto.safeStock,
    batchCode:
      dto.batchCode === undefined
        ? undefined
        : dto.batchCode.trim() || 'DEFAULT',
    expiresAt:
      dto.expiresAt === undefined
        ? undefined
        : dto.expiresAt
          ? new Date(dto.expiresAt)
          : null,
  };
  if (Object.values(mutable).every((value) => value === undefined)) {
    throw new BadRequestException('至少填写一个需要修改的商品字段');
  }
  const hash = inventoryCommandHash({
    action: 'update',
    id,
    expectedUpdatedAt: dto.expectedUpdatedAt,
    reason,
    mutable,
  });
  const replay = await itemReplay(
    prisma,
    ITEM_UPDATE_ACTION,
    requestId,
    hash,
    actor,
  );
  if (replay) return replay;
  return prisma.$transaction(
    async (tx) => {
      const duplicate = await itemReplay(
        prisma,
        ITEM_UPDATE_ACTION,
        requestId,
        hash,
        actor,
        tx,
      );
      if (duplicate) return duplicate;
      const current = await tx.inventoryItem.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('库存商品不存在');
      assertMasterDataVersion(current.updatedAt, dto.expectedUpdatedAt);
      if (
        current.stock !== 0 &&
        ((mutable.defaultLocationId !== undefined &&
          mutable.defaultLocationId !== current.defaultLocationId) ||
          (mutable.batchCode !== undefined &&
            mutable.batchCode !== (current.batchCode || 'DEFAULT')) ||
          (mutable.expiresAt !== undefined &&
            (mutable.expiresAt?.getTime() ?? null) !==
              (current.expiresAt?.getTime() ?? null)))
      ) {
        throw new ConflictException(
          '有库存时不能变更默认库位、批次或效期，请先清零',
        );
      }
      const nextSupplierId = mutable.supplierId ?? current.supplierId;
      const nextLocationId =
        mutable.defaultLocationId ?? current.defaultLocationId;
      if (!nextSupplierId || !nextLocationId)
        throw new ConflictException('商品必须配置供应商和默认库位');
      const [supplier, location] = await Promise.all([
        tx.supplier.findUnique({ where: { id: nextSupplierId } }),
        tx.inventoryLocation.findUnique({ where: { id: nextLocationId } }),
      ]);
      if (!supplier?.enabled)
        throw new ConflictException('供应商不存在或已停用');
      if (!location?.enabled)
        throw new ConflictException('默认库位不存在或已停用');
      assertModeMatchesSupplier(mutable.mode ?? current.mode, supplier.type);
      const data = {
        ...(mutable.sku !== undefined ? { sku: mutable.sku } : {}),
        ...(mutable.name !== undefined ? { name: mutable.name } : {}),
        ...(mutable.category !== undefined
          ? { category: mutable.category }
          : {}),
        ...(mutable.mode !== undefined ? { mode: mutable.mode } : {}),
        ...(mutable.supplierId !== undefined
          ? { supplierId: supplier.id, supplier: supplier.name }
          : current.supplier !== supplier.name
            ? { supplier: supplier.name }
            : {}),
        ...(mutable.defaultLocationId !== undefined
          ? { defaultLocationId: location.id }
          : {}),
        ...(mutable.purchasePriceCents !== undefined
          ? { purchasePriceCents: mutable.purchasePriceCents }
          : {}),
        ...(mutable.salePriceCents !== undefined
          ? { salePriceCents: mutable.salePriceCents }
          : {}),
        ...(mutable.safeStock !== undefined
          ? { safeStock: mutable.safeStock }
          : {}),
        ...(mutable.batchCode !== undefined
          ? { batchCode: mutable.batchCode }
          : {}),
        ...(mutable.expiresAt !== undefined
          ? { expiresAt: mutable.expiresAt }
          : {}),
      };
      const changed = await tx.inventoryItem.updateMany({
        where: { id, updatedAt: new Date(dto.expectedUpdatedAt) },
        data,
      });
      if (changed.count !== 1)
        throw new ConflictException('商品资料已被其他账号修改，请刷新后重试');
      if (
        current.stock === 0 &&
        (mutable.defaultLocationId !== undefined ||
          mutable.batchCode !== undefined ||
          mutable.expiresAt !== undefined)
      ) {
        // Zero balances remain the original destination of historical sale
        // allocations. Never delete or repurpose them when changing defaults.
        const batchCode = mutable.batchCode ?? current.batchCode ?? 'DEFAULT';
        const expiresAt =
          mutable.expiresAt === undefined
            ? current.expiresAt
            : mutable.expiresAt;
        const balance = await tx.inventoryStockBalance.findUnique({
          where: {
            itemId_locationId_batchCode: {
              itemId: id,
              locationId: nextLocationId,
              batchCode,
            },
          },
        });
        if (
          balance &&
          (balance.expiresAt?.getTime() ?? null) !==
            (expiresAt?.getTime() ?? null)
        ) {
          throw new ConflictException(
            '历史批次效期不能变更，请使用新的批次编码',
          );
        }
        if (!balance) {
          await tx.inventoryStockBalance.create({
            data: {
              itemId: id,
              locationId: nextLocationId,
              batchCode,
              expiresAt,
              quantity: 0,
            },
          });
        }
      }
      const updated = await tx.inventoryItem.findUniqueOrThrow({
        where: { id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: ITEM_UPDATE_ACTION,
          objectType: 'InventoryItem',
          objectId: id,
          oldValue: itemSnapshot(current) as never,
          newValue: {
            ...itemSnapshot(updated),
            commandHash: hash,
          } as never,
          reason,
          requestId,
        },
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function setStatus(
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
  const replay = await itemReplay(
    prisma,
    ITEM_STATUS_ACTION,
    requestId,
    hash,
    actor,
  );
  if (replay) return replay;
  return prisma.$transaction(
    async (tx) => {
      const duplicate = await itemReplay(
        prisma,
        ITEM_STATUS_ACTION,
        requestId,
        hash,
        actor,
        tx,
      );
      if (duplicate) return duplicate;
      const current = await tx.inventoryItem.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('库存商品不存在');
      assertMasterDataVersion(current.updatedAt, dto.expectedUpdatedAt);
      if (current.enabled === dto.enabled)
        throw new ConflictException(
          dto.enabled ? '商品已经启用' : '商品已经停用',
        );
      if (dto.enabled) {
        if (!current.supplierId || !current.defaultLocationId)
          throw new ConflictException('启用前必须配置供应商和默认库位');
        const [supplier, location] = await Promise.all([
          tx.supplier.findUnique({ where: { id: current.supplierId } }),
          tx.inventoryLocation.findUnique({
            where: { id: current.defaultLocationId },
          }),
        ]);
        if (!supplier?.enabled || !location?.enabled)
          throw new ConflictException('供应商或默认库位已停用，不能启用商品');
        assertModeMatchesSupplier(current.mode, supplier.type);
      } else {
        await assertItemCanDisable(tx, current);
      }
      const changed = await tx.inventoryItem.updateMany({
        where: {
          id,
          enabled: current.enabled,
          updatedAt: new Date(dto.expectedUpdatedAt),
        },
        data: { enabled: dto.enabled },
      });
      if (changed.count !== 1)
        throw new ConflictException('商品状态已变化，请刷新后重试');
      const updated = await tx.inventoryItem.findUniqueOrThrow({
        where: { id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: ITEM_STATUS_ACTION,
          objectType: 'InventoryItem',
          objectId: id,
          oldValue: itemSnapshot(current) as never,
          newValue: {
            ...itemSnapshot(updated),
            commandHash: hash,
          } as never,
          reason,
          requestId,
        },
      });
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
