import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  InventoryMode,
  Prisma,
  PurchaseOrderStatus,
  SupplierType,
} from '../../generated/prisma/client.js';
import type {
  CreateSupplierDto,
  SetMasterDataStatusDto,
  UpdateSupplierDto,
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
  SUPPLIER_CREATE_ACTION,
  SUPPLIER_UPDATE_ACTION,
  SUPPLIER_STATUS_ACTION,
} from '../shared/inventory-operations-support.js';

import {
  executeMasterCreate,
  masterReplay,
  masterAudit,
  requireRole,
} from '../shared/inventory-operations-policy.js';

export function suppliers(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, READ_ROLES);
  return prisma.supplier.findMany({
    include: {
      _count: { select: { items: true, purchaseOrders: true } },
    },
    orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
  });
}

export async function supplierDetail(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, READ_ROLES);
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      items: {
        include: { defaultLocation: true },
        orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
      },
      purchaseOrders: {
        include: { lines: { include: { item: true, location: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: { select: { items: true, purchaseOrders: true } },
    },
  });
  if (!supplier) throw new NotFoundException('供应商不存在');
  return supplier;
}

export async function createSupplier(
  prisma: PrismaService,
  dto: CreateSupplierDto,
  actor: AuthUser,
) {
  requireRole(actor, ADMIN_ROLES);
  const { reason, requestId } = normalizeMasterCommand(
    dto.reason,
    dto.idempotencyKey,
  );
  const code = requireTrimmedField(dto.code, '供应商编码', 2, 40).toUpperCase();
  const name = requireTrimmedField(dto.name, '供应商名称', 2, 120);
  validateSettlementRule(dto.type, dto.settlementRule);
  const hash = inventoryCommandHash({
    action: 'create',
    code,
    name,
    type: dto.type,
    contactName: dto.contactName?.trim() || null,
    contactPhone: dto.contactPhone?.trim() || null,
    settlementRule: dto.settlementRule,
    reason,
  });
  const replayId = await masterReplay(
    prisma,
    SUPPLIER_CREATE_ACTION,
    requestId,
    hash,
    'Supplier',
    actor,
  );
  if (replayId)
    return prisma.supplier.findUniqueOrThrow({
      where: { id: replayId },
    });
  return executeMasterCreate(
    () =>
      prisma.$transaction(
        async (tx) => {
          const duplicateId = await masterReplay(
            prisma,
            SUPPLIER_CREATE_ACTION,
            requestId,
            hash,
            'Supplier',
            actor,
            tx,
          );
          if (duplicateId)
            return tx.supplier.findUniqueOrThrow({
              where: { id: duplicateId },
            });
          const supplier = await tx.supplier.create({
            data: {
              code,
              name,
              type: dto.type,
              contactName: dto.contactName?.trim() || null,
              contactPhone: dto.contactPhone?.trim() || null,
              settlementRule: dto.settlementRule as never,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: SUPPLIER_CREATE_ACTION,
              objectType: 'Supplier',
              objectId: supplier.id,
              oldValue: Prisma.JsonNull,
              newValue: {
                ...supplierSnapshot(supplier),
                commandHash: hash,
              } as never,
              reason,
              requestId,
            },
          });
          return supplier;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    async () => {
      const duplicateId = await masterReplay(
        prisma,
        SUPPLIER_CREATE_ACTION,
        requestId,
        hash,
        'Supplier',
        actor,
      );
      return duplicateId
        ? prisma.supplier.findUniqueOrThrow({
            where: { id: duplicateId },
          })
        : null;
    },
  );
}

export async function updateSupplier(
  prisma: PrismaService,
  id: string,
  dto: UpdateSupplierDto,
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
        : requireTrimmedField(dto.code, '供应商编码', 2, 40).toUpperCase(),
    name:
      dto.name === undefined
        ? undefined
        : requireTrimmedField(dto.name, '供应商名称', 2, 120),
    type: dto.type,
    contactName:
      dto.contactName === undefined
        ? undefined
        : dto.contactName.trim() || null,
    contactPhone:
      dto.contactPhone === undefined
        ? undefined
        : dto.contactPhone.trim() || null,
    settlementRule: dto.settlementRule,
  };
  if (Object.values(mutable).every((value) => value === undefined))
    throw new BadRequestException('至少填写一个需要修改的供应商字段');
  const hash = inventoryCommandHash({
    action: 'update',
    id,
    expectedUpdatedAt: dto.expectedUpdatedAt,
    reason,
    mutable,
  });
  const replayId = await masterReplay(
    prisma,
    SUPPLIER_UPDATE_ACTION,
    requestId,
    hash,
    'Supplier',
    actor,
  );
  if (replayId)
    return prisma.supplier.findUniqueOrThrow({
      where: { id: replayId },
    });
  return prisma.$transaction(
    async (tx) => {
      const duplicateId = await masterReplay(
        prisma,
        SUPPLIER_UPDATE_ACTION,
        requestId,
        hash,
        'Supplier',
        actor,
        tx,
      );
      if (duplicateId)
        return tx.supplier.findUniqueOrThrow({ where: { id: duplicateId } });
      const current = await tx.supplier.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('供应商不存在');
      assertMasterDataVersion(current.updatedAt, dto.expectedUpdatedAt);
      const nextType = mutable.type ?? current.type;
      const currentRule =
        current.settlementRule && typeof current.settlementRule === 'object'
          ? (current.settlementRule as Record<string, unknown>)
          : {};
      const nextRule = mutable.settlementRule ?? currentRule;
      validateSettlementRule(nextType, nextRule);
      if (nextType !== current.type) {
        const expectedMode =
          nextType === SupplierType.CONSIGNMENT
            ? InventoryMode.CONSIGNMENT
            : InventoryMode.PURCHASE;
        const incompatibleItems = await tx.inventoryItem.count({
          where: { supplierId: id, mode: { not: expectedMode } },
        });
        if (incompatibleItems)
          throw new ConflictException(
            `仍有 ${incompatibleItems} 个 SKU 与新供应商类型不一致，请先调整 SKU`,
          );
      }
      const changed = await tx.supplier.updateMany({
        where: { id, updatedAt: new Date(dto.expectedUpdatedAt) },
        data: {
          ...(mutable.code !== undefined ? { code: mutable.code } : {}),
          ...(mutable.name !== undefined ? { name: mutable.name } : {}),
          ...(mutable.type !== undefined ? { type: mutable.type } : {}),
          ...(mutable.contactName !== undefined
            ? { contactName: mutable.contactName }
            : {}),
          ...(mutable.contactPhone !== undefined
            ? { contactPhone: mutable.contactPhone }
            : {}),
          ...(mutable.settlementRule !== undefined
            ? { settlementRule: mutable.settlementRule as never }
            : {}),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('供应商资料已变化，请刷新后重试');
      const updated = await tx.supplier.findUniqueOrThrow({ where: { id } });
      if (mutable.name !== undefined && mutable.name !== current.name) {
        await tx.inventoryItem.updateMany({
          where: { supplierId: id },
          data: { supplier: updated.name },
        });
      }
      await masterAudit(
        tx,
        actor,
        SUPPLIER_UPDATE_ACTION,
        'Supplier',
        id,
        supplierSnapshot(current),
        { ...supplierSnapshot(updated), commandHash: hash },
        reason,
        requestId,
      );
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function setSupplierStatus(
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
    SUPPLIER_STATUS_ACTION,
    requestId,
    hash,
    'Supplier',
    actor,
  );
  if (replayId)
    return prisma.supplier.findUniqueOrThrow({
      where: { id: replayId },
    });
  return prisma.$transaction(
    async (tx) => {
      const duplicateId = await masterReplay(
        prisma,
        SUPPLIER_STATUS_ACTION,
        requestId,
        hash,
        'Supplier',
        actor,
        tx,
      );
      if (duplicateId)
        return tx.supplier.findUniqueOrThrow({ where: { id: duplicateId } });
      const current = await tx.supplier.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('供应商不存在');
      assertMasterDataVersion(current.updatedAt, dto.expectedUpdatedAt);
      if (current.enabled === dto.enabled)
        throw new ConflictException(
          dto.enabled ? '供应商已经启用' : '供应商已经停用',
        );
      if (!dto.enabled) {
        const [openOrders, enabledItems] = await Promise.all([
          tx.purchaseOrder.count({
            where: {
              supplierId: id,
              status: {
                in: [
                  PurchaseOrderStatus.DRAFT,
                  PurchaseOrderStatus.SUBMITTED,
                  PurchaseOrderStatus.APPROVED,
                  PurchaseOrderStatus.PARTIAL_RECEIVED,
                ],
              },
            },
          }),
          tx.inventoryItem.count({
            where: { supplierId: id, enabled: true },
          }),
        ]);
        const blockers = [
          enabledItems ? `仍启用 SKU ${enabledItems}` : '',
          openOrders ? `未完采购单 ${openOrders}` : '',
        ].filter(Boolean);
        if (blockers.length)
          throw new ConflictException(
            `供应商暂不能停用：${blockers.join('、')}`,
          );
      }
      const changed = await tx.supplier.updateMany({
        where: {
          id,
          enabled: current.enabled,
          updatedAt: new Date(dto.expectedUpdatedAt),
        },
        data: { enabled: dto.enabled },
      });
      if (changed.count !== 1)
        throw new ConflictException('供应商状态已变化，请刷新后重试');
      const updated = await tx.supplier.findUniqueOrThrow({ where: { id } });
      await masterAudit(
        tx,
        actor,
        SUPPLIER_STATUS_ACTION,
        'Supplier',
        id,
        supplierSnapshot(current),
        { ...supplierSnapshot(updated), commandHash: hash },
        reason,
        requestId,
      );
      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function validateSettlementRule(
  type: SupplierType,
  value: Record<string, unknown>,
) {
  const cycle = value.settlementCycle;
  if (!['PER_ORDER', 'WEEKLY', 'MONTHLY'].includes(String(cycle ?? ''))) {
    throw new BadRequestException('结算周期必须为逐单、周结或月结');
  }
  if (type === SupplierType.CONSIGNMENT) {
    const commissionRateBps = Number(value.commissionRateBps);
    if (
      !Number.isInteger(commissionRateBps) ||
      commissionRateBps < 0 ||
      commissionRateBps > 10_000
    ) {
      throw new BadRequestException('寄售供应商必须配置 0-10000 的分成基点');
    }
    return;
  }
  const paymentTermsDays = Number(value.paymentTermsDays);
  if (
    !Number.isInteger(paymentTermsDays) ||
    paymentTermsDays < 0 ||
    paymentTermsDays > 365
  ) {
    throw new BadRequestException('自营采购供应商必须配置 0-365 天账期');
  }
}

export function supplierSnapshot(supplier: {
  id: string;
  code: string;
  name: string;
  type: SupplierType;
  contactName: string | null;
  contactPhone: string | null;
  settlementRule: Prisma.JsonValue | null;
  enabled: boolean;
  updatedAt: Date;
}) {
  return {
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    type: supplier.type,
    contactName: supplier.contactName,
    contactPhone: supplier.contactPhone,
    settlementRule: supplier.settlementRule,
    enabled: supplier.enabled,
    updatedAt: supplier.updatedAt.toISOString(),
  };
}
