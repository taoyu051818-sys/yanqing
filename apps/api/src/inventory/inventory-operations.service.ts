import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AppRole,
  InventoryMode,
  InventoryOperationStatus,
  InventoryOperationType,
  InventoryTxnType,
  Prisma,
  PurchaseOrderStatus,
  StocktakeStatus,
  SupplierType,
} from '../generated/prisma/client.js';
import type {
  CancelDocumentDto,
  CountStocktakeLineDto,
  CreateInventoryLocationDto,
  CreateInventoryOperationDto,
  CreatePurchaseOrderDto,
  CreateStocktakeDto,
  CreateSupplierDto,
  PostInventoryOperationDto,
  PostStocktakeDto,
  ReceivePurchaseOrderDto,
  SetMasterDataStatusDto,
  UpdateInventoryLocationDto,
  UpdateSupplierDto,
} from './inventory.dto.js';
import {
  assertMasterDataVersion,
  inventoryCommandHash,
  normalizeMasterCommand,
  requireTrimmedField,
} from './inventory-master-data.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

const ADMIN_ROLES: readonly AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN];
const FRONT_ROLES: readonly AppRole[] = ADMIN_ROLES;
const READ_ROLES: readonly AppRole[] = [...ADMIN_ROLES];

const SUPPLIER_CREATE_ACTION = 'SUPPLIER_CREATED';
const SUPPLIER_UPDATE_ACTION = 'SUPPLIER_UPDATED';
const SUPPLIER_STATUS_ACTION = 'SUPPLIER_STATUS_CHANGED';
const LOCATION_CREATE_ACTION = 'INVENTORY_LOCATION_CREATED';
const LOCATION_UPDATE_ACTION = 'INVENTORY_LOCATION_UPDATED';
const LOCATION_STATUS_ACTION = 'INVENTORY_LOCATION_STATUS_CHANGED';

const purchaseReceiptResponse = (receipt: Record<string, any>) => {
  const {
    idempotencyKey: _idempotencyKey,
    operatorId: _operatorId,
    ...response
  } = receipt;
  return response;
};

const purchaseOrderResponse = (order: Record<string, any>) => ({
  ...order,
  ...(Array.isArray(order.receipts)
    ? { receipts: order.receipts.map(purchaseReceiptResponse) }
    : {}),
});

const stocktakeResponse = (stocktake: Record<string, any>) => {
  const { postIdempotencyKey: _postIdempotencyKey, ...response } = stocktake;
  return response;
};

const inventoryOperationResponse = (operation: Record<string, any>) => {
  const {
    postIdempotencyKey: _postIdempotencyKey,
    sourceTransactionId: _sourceTransactionId,
    targetTransactionId: _targetTransactionId,
    ...response
  } = operation;
  return response;
};

const inventoryLocationResponse = (location: Record<string, any>) => ({
  ...location,
  ...(Array.isArray(location.stocktakes)
    ? { stocktakes: location.stocktakes.map(stocktakeResponse) }
    : {}),
  ...(Array.isArray(location.sourceOperations)
    ? {
        sourceOperations: location.sourceOperations.map(
          inventoryOperationResponse,
        ),
      }
    : {}),
  ...(Array.isArray(location.targetOperations)
    ? {
        targetOperations: location.targetOperations.map(
          inventoryOperationResponse,
        ),
      }
    : {}),
});

@Injectable()
export class InventoryOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  suppliers(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.supplier.findMany({
      include: {
        _count: { select: { items: true, purchaseOrders: true } },
      },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    });
  }

  async supplierDetail(id: string, actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    const supplier = await this.prisma.supplier.findUnique({
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

  locations(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.inventoryLocation.findMany({
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

  async locationDetail(id: string, actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    const location = await this.prisma.inventoryLocation.findUnique({
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

  purchaseOrders(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.purchaseOrder
      .findMany({
        include: {
          supplier: true,
          lines: { include: { item: true, location: true } },
          receipts: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((orders) => orders.map(purchaseOrderResponse));
  }

  stocktakes(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.stocktake
      .findMany({
        include: { location: true, lines: { include: { item: true } } },
        orderBy: { createdAt: 'desc' },
      })
      .then((documents) => documents.map(stocktakeResponse));
  }

  operations(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.inventoryOperation
      .findMany({
        include: { item: true, sourceLocation: true, targetLocation: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((documents) => documents.map(inventoryOperationResponse));
  }

  async createSupplier(dto: CreateSupplierDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    const { reason, requestId } = normalizeMasterCommand(
      dto.reason,
      dto.idempotencyKey,
    );
    const code = requireTrimmedField(
      dto.code,
      '供应商编码',
      2,
      40,
    ).toUpperCase();
    const name = requireTrimmedField(dto.name, '供应商名称', 2, 120);
    this.validateSettlementRule(dto.type, dto.settlementRule);
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
    const replayId = await this.masterReplay(
      SUPPLIER_CREATE_ACTION,
      requestId,
      hash,
      'Supplier',
      actor,
    );
    if (replayId)
      return this.prisma.supplier.findUniqueOrThrow({
        where: { id: replayId },
      });
    return this.executeMasterCreate(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const duplicateId = await this.masterReplay(
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
                  ...this.supplierSnapshot(supplier),
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
        const duplicateId = await this.masterReplay(
          SUPPLIER_CREATE_ACTION,
          requestId,
          hash,
          'Supplier',
          actor,
        );
        return duplicateId
          ? this.prisma.supplier.findUniqueOrThrow({
              where: { id: duplicateId },
            })
          : null;
      },
    );
  }

  async createLocation(dto: CreateInventoryLocationDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    const { reason, requestId } = normalizeMasterCommand(
      dto.reason,
      dto.idempotencyKey,
    );
    const code = requireTrimmedField(dto.code, '库位编码', 2, 40).toUpperCase();
    const name = requireTrimmedField(dto.name, '库位名称', 2, 80);
    const hash = inventoryCommandHash({ action: 'create', code, name, reason });
    const replayId = await this.masterReplay(
      LOCATION_CREATE_ACTION,
      requestId,
      hash,
      'InventoryLocation',
      actor,
    );
    if (replayId)
      return this.prisma.inventoryLocation.findUniqueOrThrow({
        where: { id: replayId },
      });
    return this.executeMasterCreate(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const duplicateId = await this.masterReplay(
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
                  ...this.locationSnapshot(location),
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
        const duplicateId = await this.masterReplay(
          LOCATION_CREATE_ACTION,
          requestId,
          hash,
          'InventoryLocation',
          actor,
        );
        return duplicateId
          ? this.prisma.inventoryLocation.findUniqueOrThrow({
              where: { id: duplicateId },
            })
          : null;
      },
    );
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
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
    const replayId = await this.masterReplay(
      SUPPLIER_UPDATE_ACTION,
      requestId,
      hash,
      'Supplier',
      actor,
    );
    if (replayId)
      return this.prisma.supplier.findUniqueOrThrow({
        where: { id: replayId },
      });
    return this.prisma.$transaction(
      async (tx) => {
        const duplicateId = await this.masterReplay(
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
        this.validateSettlementRule(nextType, nextRule);
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
        await this.masterAudit(
          tx,
          actor,
          SUPPLIER_UPDATE_ACTION,
          'Supplier',
          id,
          this.supplierSnapshot(current),
          { ...this.supplierSnapshot(updated), commandHash: hash },
          reason,
          requestId,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async setSupplierStatus(
    id: string,
    dto: SetMasterDataStatusDto,
    actor: AuthUser,
  ) {
    this.requireRole(actor, ADMIN_ROLES);
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
    const replayId = await this.masterReplay(
      SUPPLIER_STATUS_ACTION,
      requestId,
      hash,
      'Supplier',
      actor,
    );
    if (replayId)
      return this.prisma.supplier.findUniqueOrThrow({
        where: { id: replayId },
      });
    return this.prisma.$transaction(
      async (tx) => {
        const duplicateId = await this.masterReplay(
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
        await this.masterAudit(
          tx,
          actor,
          SUPPLIER_STATUS_ACTION,
          'Supplier',
          id,
          this.supplierSnapshot(current),
          { ...this.supplierSnapshot(updated), commandHash: hash },
          reason,
          requestId,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async updateLocation(
    id: string,
    dto: UpdateInventoryLocationDto,
    actor: AuthUser,
  ) {
    this.requireRole(actor, ADMIN_ROLES);
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
    const replayId = await this.masterReplay(
      LOCATION_UPDATE_ACTION,
      requestId,
      hash,
      'InventoryLocation',
      actor,
    );
    if (replayId)
      return this.prisma.inventoryLocation.findUniqueOrThrow({
        where: { id: replayId },
      });
    return this.prisma.$transaction(
      async (tx) => {
        const duplicateId = await this.masterReplay(
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
        await this.masterAudit(
          tx,
          actor,
          LOCATION_UPDATE_ACTION,
          'InventoryLocation',
          id,
          this.locationSnapshot(current),
          { ...this.locationSnapshot(updated), commandHash: hash },
          reason,
          requestId,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async setLocationStatus(
    id: string,
    dto: SetMasterDataStatusDto,
    actor: AuthUser,
  ) {
    this.requireRole(actor, ADMIN_ROLES);
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
    const replayId = await this.masterReplay(
      LOCATION_STATUS_ACTION,
      requestId,
      hash,
      'InventoryLocation',
      actor,
    );
    if (replayId)
      return this.prisma.inventoryLocation.findUniqueOrThrow({
        where: { id: replayId },
      });
    return this.prisma.$transaction(
      async (tx) => {
        const duplicateId = await this.masterReplay(
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
        if (!dto.enabled) await this.assertLocationCanDisable(tx, id);
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
        await this.masterAudit(
          tx,
          actor,
          LOCATION_STATUS_ACTION,
          'InventoryLocation',
          id,
          this.locationSnapshot(current),
          { ...this.locationSnapshot(updated), commandHash: hash },
          reason,
          requestId,
        );
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    const keys = dto.lines.map((line) =>
      [line.itemId, line.locationId, this.batch(line.batchCode)].join(':'),
    );
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('采购明细不能重复');
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.supplierId },
      });
      if (!supplier?.enabled)
        throw new NotFoundException('供应商不存在或已停用');
      const itemIds = [...new Set(dto.lines.map((line) => line.itemId))];
      const locationIds = [
        ...new Set(dto.lines.map((line) => line.locationId)),
      ];
      const [items, locations] = await Promise.all([
        tx.inventoryItem.findMany({
          where: { id: { in: itemIds }, enabled: true },
        }),
        tx.inventoryLocation.findMany({
          where: { id: { in: locationIds }, enabled: true },
        }),
      ]);
      if (
        items.length !== itemIds.length ||
        locations.length !== locationIds.length
      ) {
        throw new NotFoundException('采购商品或收货库位不存在');
      }
      const expectedMode =
        supplier.type === SupplierType.CONSIGNMENT
          ? InventoryMode.CONSIGNMENT
          : InventoryMode.PURCHASE;
      if (
        items.some(
          (item) =>
            item.supplierId !== supplier.id || item.mode !== expectedMode,
        )
      ) {
        throw new BadRequestException(
          '采购商品必须属于所选供应商且经营模式一致',
        );
      }
      return tx.purchaseOrder.create({
        data: {
          orderNo: serial('PO'),
          supplierId: supplier.id,
          createdById: actor.sub,
          remark: dto.remark?.trim() || null,
          lines: {
            create: dto.lines.map((line) => ({
              itemId: line.itemId,
              locationId: line.locationId,
              orderedQuantity: line.orderedQuantity,
              unitCostCents: line.unitCostCents,
              batchCode: this.batch(line.batchCode),
              expiresAt: line.expiresAt ? new Date(line.expiresAt) : null,
            })),
          },
        },
        include: { supplier: true, lines: true },
      });
    });
  }

  submitPurchaseOrder(id: string, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!order) throw new NotFoundException('采购单不存在');
      if (order.status === PurchaseOrderStatus.SUBMITTED) return order;
      if (order.status !== PurchaseOrderStatus.DRAFT)
        throw new ConflictException('当前采购单不能提交');
      if (!order.lines.length) throw new ConflictException('采购单没有明细');
      const submittedAt = new Date();
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.SUBMITTED,
          submittedById: actor.sub,
          submittedAt,
        },
      });
      await this.audit(
        tx,
        actor,
        'PURCHASE_ORDER_SUBMITTED',
        'PurchaseOrder',
        id,
        order.status,
        PurchaseOrderStatus.SUBMITTED,
        order.remark ?? '采购单提交审批',
      );
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { supplier: true, lines: true },
      });
    });
  }

  approvePurchaseOrder(id: string, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('采购单不存在');
      if (order.status === PurchaseOrderStatus.APPROVED) return order;
      if (order.status !== PurchaseOrderStatus.SUBMITTED)
        throw new ConflictException('只有已提交采购单可以审批');
      if (
        order.submittedById === actor.sub ||
        order.createdById === actor.sub
      ) {
        throw new ForbiddenException('采购制单/提交人与审批人不能为同一账号');
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.APPROVED,
          approvedById: actor.sub,
          approvedAt: new Date(),
        },
      });
      await this.audit(
        tx,
        actor,
        'PURCHASE_ORDER_APPROVED',
        'PurchaseOrder',
        id,
        order.status,
        PurchaseOrderStatus.APPROVED,
        order.remark ?? '采购单审批通过',
      );
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: { supplier: true, lines: true },
      });
    });
  }

  async receivePurchaseOrder(
    id: string,
    dto: ReceivePurchaseOrderDto,
    actor: AuthUser,
  ) {
    this.requireRole(actor, FRONT_ROLES);
    const existing = await this.prisma.purchaseReceipt.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { lines: true },
    });
    if (existing) {
      if (existing.purchaseOrderId !== id)
        throw new ConflictException('收货幂等键已用于其他采购单');
      return purchaseReceiptResponse(existing);
    }
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: {
            supplier: true,
            lines: { include: { item: true, location: true } },
          },
        });
        if (!order) throw new NotFoundException('采购单不存在');
        if (order.supplier.enabled === false)
          throw new ConflictException('供应商已停用，不能继续收货');
        if (
          order.status !== PurchaseOrderStatus.APPROVED &&
          order.status !== PurchaseOrderStatus.PARTIAL_RECEIVED
        ) {
          throw new ConflictException('采购单未审批或已完成，不能收货');
        }
        if (
          new Set(dto.lines.map((line) => line.lineId)).size !==
          dto.lines.length
        ) {
          throw new BadRequestException('同一采购明细不能在一张收货单重复');
        }
        const receipt = await tx.purchaseReceipt.create({
          data: {
            receiptNo: serial('PR'),
            purchaseOrderId: id,
            operatorId: actor.sub,
            idempotencyKey: dto.idempotencyKey,
          },
        });
        const receivedByLine = new Map(
          dto.lines.map((line) => [line.lineId, line.quantity]),
        );
        const currentItemStocks = new Map<string, number>();
        for (const [lineId, quantity] of receivedByLine) {
          const line = order.lines.find((entry) => entry.id === lineId);
          if (!line) throw new NotFoundException('采购收货明细不存在');
          if (line.item.enabled === false || line.location?.enabled === false)
            throw new ConflictException('采购商品或收货库位已停用');
          if (quantity > line.orderedQuantity - line.receivedQuantity) {
            throw new BadRequestException('收货数量超过采购未收数量');
          }
          const balance = await this.reconciledBalance(
            tx,
            line.item,
            line.locationId,
            line.batchCode,
            line.expiresAt,
          );
          const stockBefore =
            currentItemStocks.get(line.itemId) ?? line.item.stock;
          const itemChanged = await tx.inventoryItem.updateMany({
            where: { id: line.itemId, stock: stockBefore },
            data: { stock: { increment: quantity } },
          });
          if (itemChanged.count !== 1)
            throw new ConflictException('库存已被其他操作更新，请重试');
          await tx.inventoryStockBalance.update({
            where: { id: balance.id },
            data: {
              quantity: { increment: quantity },
              expiresAt: line.expiresAt,
            },
          });
          const movement = await tx.inventoryTransaction.create({
            data: {
              itemId: line.itemId,
              type:
                order.supplier.type === SupplierType.CONSIGNMENT
                  ? InventoryTxnType.CONSIGNMENT_IN
                  : InventoryTxnType.PURCHASE_IN,
              quantity,
              stockBefore,
              stockAfter: stockBefore + quantity,
              unitCostCents: line.unitCostCents,
              operatorId: actor.sub,
              reason: `采购收货 ${order.orderNo}`,
              idempotencyKey: `PURCHASE_RECEIPT:${dto.idempotencyKey}:${line.id}`,
              metadata: {
                purchaseOrderId: id,
                receiptId: receipt.id,
                locationId: line.locationId,
                batchCode: line.batchCode,
              } as never,
            },
          });
          await tx.purchaseReceiptLine.create({
            data: {
              receiptId: receipt.id,
              purchaseOrderLineId: line.id,
              locationId: line.locationId,
              quantity,
              batchCode: line.batchCode,
              expiresAt: line.expiresAt,
              inventoryTransactionId: movement.id,
            },
          });
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: { receivedQuantity: { increment: quantity } },
          });
          line.receivedQuantity += quantity;
          currentItemStocks.set(line.itemId, stockBefore + quantity);
        }
        const complete = order.lines.every(
          (line) => line.receivedQuantity >= line.orderedQuantity,
        );
        const status = complete
          ? PurchaseOrderStatus.RECEIVED
          : PurchaseOrderStatus.PARTIAL_RECEIVED;
        await tx.purchaseOrder.update({ where: { id }, data: { status } });
        await this.audit(
          tx,
          actor,
          'PURCHASE_RECEIVED',
          'PurchaseReceipt',
          receipt.id,
          order.status,
          status,
          order.remark ?? '采购分批收货',
        );
        return tx.purchaseReceipt
          .findUniqueOrThrow({
            where: { id: receipt.id },
            include: { lines: true },
          })
          .then(purchaseReceiptResponse);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelPurchaseOrder(id: string, dto: CancelDocumentDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('采购单不存在');
      if (order.status === PurchaseOrderStatus.CANCELLED) return order;
      if (
        order.status !== PurchaseOrderStatus.DRAFT &&
        order.status !== PurchaseOrderStatus.SUBMITTED &&
        order.status !== PurchaseOrderStatus.APPROVED
      ) {
        throw new ConflictException('已收货采购单不能取消');
      }
      const cancelled = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: dto.reason.trim(),
        },
      });
      await this.audit(
        tx,
        actor,
        'PURCHASE_ORDER_CANCELLED',
        'PurchaseOrder',
        id,
        order.status,
        PurchaseOrderStatus.CANCELLED,
        dto.reason.trim(),
      );
      return cancelled;
    });
  }

  async createStocktake(dto: CreateStocktakeDto, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    const location = await this.prisma.inventoryLocation.findUnique({
      where: { id: dto.locationId },
    });
    if (!location?.enabled)
      throw new NotFoundException('盘点库位不存在或已停用');
    const created = await this.prisma.stocktake.create({
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

  startStocktake(id: string, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    return this.prisma
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
          await this.reconciledBalance(
            tx,
            item,
            stocktake.locationId,
            this.batch(item.batchCode),
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
        await this.audit(
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

  countStocktakeLine(
    id: string,
    lineId: string,
    dto: CountStocktakeLineDto,
    actor: AuthUser,
  ) {
    this.requireRole(actor, FRONT_ROLES);
    return this.prisma.$transaction(async (tx) => {
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

  submitStocktake(id: string, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    return this.prisma
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
        await this.audit(
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

  async postStocktake(id: string, dto: PostStocktakeDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(
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
          const balance = await this.reconciledBalance(
            tx,
            line.item,
            stocktake.locationId,
            line.batchCode,
            line.expiresAt,
          );
          if (balance.quantity !== line.bookQuantity)
            throw new ConflictException('盘点期间库存已变化，请重新盘点');
          const difference = line.countedQuantity - line.bookQuantity;
          if (difference === 0) continue;
          const stockBefore =
            currentItemStocks.get(line.itemId) ?? line.item.stock;
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
        await this.audit(
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

  async createOperation(dto: CreateInventoryOperationDto, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    if (dto.type === InventoryOperationType.TRANSFER) {
      if (
        !dto.targetLocationId ||
        dto.targetLocationId === dto.sourceLocationId
      ) {
        throw new BadRequestException('调拨必须选择不同的目标库位');
      }
    } else if (dto.targetLocationId) {
      throw new BadRequestException('报损不能设置目标库位');
    }
    const [item, source, target] = await Promise.all([
      this.prisma.inventoryItem.findUnique({ where: { id: dto.itemId } }),
      this.prisma.inventoryLocation.findUnique({
        where: { id: dto.sourceLocationId },
      }),
      dto.targetLocationId
        ? this.prisma.inventoryLocation.findUnique({
            where: { id: dto.targetLocationId },
          })
        : Promise.resolve(null),
    ]);
    if (
      !item?.enabled ||
      !source?.enabled ||
      (dto.targetLocationId && !target?.enabled)
    ) {
      throw new NotFoundException('库存商品或库位不存在');
    }
    const created = await this.prisma.inventoryOperation.create({
      data: {
        documentNo: serial(
          dto.type === InventoryOperationType.TRANSFER ? 'TR' : 'LS',
        ),
        type: dto.type,
        itemId: item.id,
        quantity: dto.quantity,
        batchCode: this.batch(dto.batchCode),
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        sourceLocationId: source.id,
        targetLocationId: target?.id ?? null,
        reason: dto.reason.trim(),
        referenceType: dto.referenceType?.trim() || null,
        referenceId: dto.referenceId?.trim() || null,
        createdById: actor.sub,
      },
      include: { item: true, sourceLocation: true, targetLocation: true },
    });
    return inventoryOperationResponse(created);
  }

  submitOperation(id: string, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    return this.moveOperation(
      id,
      InventoryOperationStatus.DRAFT,
      InventoryOperationStatus.SUBMITTED,
      actor,
    ).then(inventoryOperationResponse);
  }

  approveOperation(id: string, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma
      .$transaction(async (tx) => {
        const operation = await tx.inventoryOperation.findUnique({
          where: { id },
        });
        if (!operation) throw new NotFoundException('库存业务单不存在');
        if (operation.status === InventoryOperationStatus.APPROVED)
          return operation;
        if (operation.status !== InventoryOperationStatus.SUBMITTED)
          throw new ConflictException('库存业务单尚未提交');
        if (operation.createdById === actor.sub)
          throw new ForbiddenException('库存业务制单人与审批人不能为同一账号');
        await tx.inventoryOperation.update({
          where: { id },
          data: {
            status: InventoryOperationStatus.APPROVED,
            approvedById: actor.sub,
            approvedAt: new Date(),
          },
        });
        await this.audit(
          tx,
          actor,
          'INVENTORY_OPERATION_APPROVED',
          'InventoryOperation',
          id,
          operation.status,
          InventoryOperationStatus.APPROVED,
          operation.reason,
        );
        return tx.inventoryOperation.findUniqueOrThrow({
          where: { id },
          include: { item: true, sourceLocation: true, targetLocation: true },
        });
      })
      .then(inventoryOperationResponse);
  }

  async postOperation(
    id: string,
    dto: PostInventoryOperationDto,
    actor: AuthUser,
  ) {
    this.requireRole(actor, FRONT_ROLES);
    return this.prisma.$transaction(
      async (tx) => {
        const operation = await tx.inventoryOperation.findUnique({
          where: { id },
          include: {
            item: true,
            sourceLocation: true,
            targetLocation: true,
          },
        });
        if (!operation) throw new NotFoundException('库存业务单不存在');
        if (operation.status === InventoryOperationStatus.POSTED) {
          if (operation.postIdempotencyKey !== dto.idempotencyKey)
            throw new ConflictException('库存业务单已使用其他幂等键过账');
          return inventoryOperationResponse(operation);
        }
        if (operation.status !== InventoryOperationStatus.APPROVED)
          throw new ConflictException('库存业务单尚未审批');
        if (
          operation.item.enabled === false ||
          operation.sourceLocation.enabled === false ||
          operation.targetLocation?.enabled === false
        ) {
          throw new ConflictException('商品或库位已停用，不能过账');
        }
        const source = await this.reconciledBalance(
          tx,
          operation.item,
          operation.sourceLocationId,
          operation.batchCode,
          operation.expiresAt,
        );
        if (source.quantity < operation.quantity)
          throw new BadRequestException('来源库位库存不足');
        await tx.inventoryStockBalance.update({
          where: { id: source.id },
          data: { quantity: { decrement: operation.quantity } },
        });
        let sourceTransactionId: string;
        let targetTransactionId: string | null = null;
        if (operation.type === InventoryOperationType.TRANSFER) {
          if (!operation.targetLocationId)
            throw new ConflictException('调拨单缺少目标库位');
          const target = await this.reconciledBalance(
            tx,
            operation.item,
            operation.targetLocationId,
            operation.batchCode,
            operation.expiresAt,
          );
          await tx.inventoryStockBalance.update({
            where: { id: target.id },
            data: {
              quantity: { increment: operation.quantity },
              expiresAt: operation.expiresAt,
            },
          });
          const out = await tx.inventoryTransaction.create({
            data: {
              itemId: operation.itemId,
              type: InventoryTxnType.TRANSFER_OUT,
              quantity: -operation.quantity,
              stockBefore: operation.item.stock,
              stockAfter: operation.item.stock,
              operatorId: actor.sub,
              reason: operation.reason,
              idempotencyKey: `TRANSFER_OUT:${dto.idempotencyKey}`,
              metadata: {
                operationId: id,
                locationId: operation.sourceLocationId,
                batchCode: operation.batchCode,
              } as never,
            },
          });
          const incoming = await tx.inventoryTransaction.create({
            data: {
              itemId: operation.itemId,
              type: InventoryTxnType.TRANSFER_IN,
              quantity: operation.quantity,
              stockBefore: operation.item.stock,
              stockAfter: operation.item.stock,
              operatorId: actor.sub,
              reason: operation.reason,
              idempotencyKey: `TRANSFER_IN:${dto.idempotencyKey}`,
              metadata: {
                operationId: id,
                locationId: operation.targetLocationId,
                batchCode: operation.batchCode,
              } as never,
            },
          });
          sourceTransactionId = out.id;
          targetTransactionId = incoming.id;
        } else {
          const changed = await tx.inventoryItem.updateMany({
            where: { id: operation.itemId, stock: operation.item.stock },
            data: { stock: { decrement: operation.quantity } },
          });
          if (changed.count !== 1)
            throw new ConflictException('库存已变化，请重试');
          const loss = await tx.inventoryTransaction.create({
            data: {
              itemId: operation.itemId,
              type: InventoryTxnType.LOSS_OUT,
              quantity: -operation.quantity,
              stockBefore: operation.item.stock,
              stockAfter: operation.item.stock - operation.quantity,
              operatorId: actor.sub,
              reason: operation.reason,
              idempotencyKey: `LOSS:${dto.idempotencyKey}`,
              metadata: {
                operationId: id,
                locationId: operation.sourceLocationId,
                batchCode: operation.batchCode,
                referenceType: operation.referenceType,
                referenceId: operation.referenceId,
              } as never,
            },
          });
          sourceTransactionId = loss.id;
        }
        await tx.inventoryOperation.update({
          where: { id },
          data: {
            status: InventoryOperationStatus.POSTED,
            postedById: actor.sub,
            postedAt: new Date(),
            postIdempotencyKey: dto.idempotencyKey,
            sourceTransactionId,
            targetTransactionId,
          },
        });
        await this.audit(
          tx,
          actor,
          'INVENTORY_OPERATION_POSTED',
          'InventoryOperation',
          id,
          InventoryOperationStatus.APPROVED,
          InventoryOperationStatus.POSTED,
          operation.reason,
        );
        return tx.inventoryOperation
          .findUniqueOrThrow({
            where: { id },
            include: { item: true, sourceLocation: true, targetLocation: true },
          })
          .then(inventoryOperationResponse);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelOperation(id: string, dto: CancelDocumentDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma
      .$transaction(async (tx) => {
        const operation = await tx.inventoryOperation.findUnique({
          where: { id },
        });
        if (!operation) throw new NotFoundException('库存业务单不存在');
        if (operation.status === InventoryOperationStatus.CANCELLED)
          return operation;
        if (
          operation.status !== InventoryOperationStatus.DRAFT &&
          operation.status !== InventoryOperationStatus.SUBMITTED &&
          operation.status !== InventoryOperationStatus.APPROVED
        ) {
          throw new ConflictException('已过账库存业务单不能取消');
        }
        const cancelled = await tx.inventoryOperation.update({
          where: { id },
          data: {
            status: InventoryOperationStatus.CANCELLED,
            cancelledAt: new Date(),
            reason: `${operation.reason}；取消：${dto.reason.trim()}`,
          },
        });
        await this.audit(
          tx,
          actor,
          'INVENTORY_OPERATION_CANCELLED',
          'InventoryOperation',
          id,
          operation.status,
          InventoryOperationStatus.CANCELLED,
          dto.reason.trim(),
        );
        return cancelled;
      })
      .then(inventoryOperationResponse);
  }

  private moveOperation(
    id: string,
    from: InventoryOperationStatus,
    to: InventoryOperationStatus,
    actor: AuthUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const operation = await tx.inventoryOperation.findUnique({
        where: { id },
      });
      if (!operation) throw new NotFoundException('库存业务单不存在');
      if (operation.status === to) return operation;
      if (operation.status !== from)
        throw new ConflictException('库存业务单状态不允许该操作');
      const moved = await tx.inventoryOperation.update({
        where: { id },
        data: { status: to, submittedAt: new Date() },
      });
      await this.audit(
        tx,
        actor,
        'INVENTORY_OPERATION_SUBMITTED',
        'InventoryOperation',
        id,
        from,
        to,
        operation.reason,
      );
      return moved;
    });
  }

  private async reconciledBalance(
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
      batchCode === this.batch(item.batchCode)
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

  private async executeMasterCreate<T>(
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

  private async masterReplay(
    action: string,
    requestId: string,
    hash: string,
    objectType: string,
    actor: AuthUser,
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma;
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

  private masterAudit(
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

  private validateSettlementRule(
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

  private async assertLocationCanDisable(
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

  private supplierSnapshot(supplier: {
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

  private locationSnapshot(location: {
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

  private batch(value: string | null | undefined) {
    return value?.trim() || 'DEFAULT';
  }

  private requireRole(actor: AuthUser, allowed: readonly AppRole[]) {
    if (!actor.roles.some((role) => allowed.includes(role))) {
      throw new ForbiddenException('当前角色无权执行该库存业务动作');
    }
  }

  private audit(
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
}
