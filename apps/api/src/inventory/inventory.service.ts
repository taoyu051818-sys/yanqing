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
  BusinessType,
  InventoryMode,
  InventoryOperationStatus,
  InventoryTxnType,
  OrderStatus,
  Prisma,
  PurchaseOrderStatus,
  StocktakeStatus,
  SupplierType,
} from '../generated/prisma/client.js';
import type {
  CreateInventoryItemDto,
  InventoryTransactionDto,
  SetMasterDataStatusDto,
  UpdateInventoryItemDto,
} from './inventory.dto.js';
import { applyInventoryDelta } from './inventory-balance.js';
import {
  assertMasterDataVersion,
  inventoryCommandHash,
  normalizeMasterCommand,
  requireTrimmedField,
} from './inventory-master-data.js';

const IN_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.PURCHASE_IN,
  InventoryTxnType.CONSIGNMENT_IN,
]);
const OUT_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.SALE_OUT,
  InventoryTxnType.TRAINING_USAGE,
  InventoryTxnType.EVENT_USAGE,
  InventoryTxnType.RETURN_OUT,
]);
const DOCUMENT_CONTROLLED_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.PURCHASE_IN,
  InventoryTxnType.CONSIGNMENT_IN,
  InventoryTxnType.TRANSFER_OUT,
  InventoryTxnType.TRANSFER_IN,
  InventoryTxnType.LOSS_OUT,
  InventoryTxnType.STOCKTAKE_GAIN,
  InventoryTxnType.STOCKTAKE_LOSS,
  InventoryTxnType.ADJUSTMENT,
  InventoryTxnType.RETURN_OUT,
  InventoryTxnType.STOCKTAKE,
]);

const ADMIN_ROLES: readonly AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN];
const READ_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.COACH,
  AppRole.EVENT_MANAGER,
  AppRole.FINANCE,
  ...ADMIN_ROLES,
];

const ITEM_UPDATE_ACTION = 'INVENTORY_ITEM_UPDATED';
const ITEM_STATUS_ACTION = 'INVENTORY_ITEM_STATUS_CHANGED';

const hasRole = (actor: AuthUser, roles: readonly AppRole[]) =>
  actor.roles.some((role) => roles.includes(role));

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.inventoryItem.findMany({
      include: {
        supplierRecord: true,
        defaultLocation: true,
        stockBalances: { include: { location: true } },
        transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
      orderBy: [{ enabled: 'desc' }, { stock: 'asc' }],
    });
  }

  async detail(id: string, actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        supplierRecord: true,
        defaultLocation: true,
        stockBalances: {
          include: { location: true },
          orderBy: [{ location: { code: 'asc' } }, { batchCode: 'asc' }],
        },
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
        purchaseOrderLines: {
          include: {
            purchaseOrder: { include: { supplier: true } },
            location: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        inventoryDocuments: {
          include: { sourceLocation: true, targetLocation: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!item) throw new NotFoundException('库存商品不存在');
    return item;
  }

  lowStock(actor: AuthUser) {
    this.requireRole(actor, READ_ROLES);
    return this.prisma.$queryRaw<
      {
        id: string;
        sku: string;
        name: string;
        stock: number;
        safeStock: number;
      }[]
    >`SELECT id, sku, name, stock, "safeStock" FROM "InventoryItem" WHERE enabled = true AND stock <= "safeStock" ORDER BY stock ASC`;
  }

  async create(dto: CreateInventoryItemDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
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
    const replay = await this.itemReplay(
      'INVENTORY_ITEM_CREATED',
      requestId,
      hash,
      actor,
    );
    if (replay) return replay;
    const execute = () =>
      this.prisma.$transaction(
        async (tx) => {
          const duplicate = await this.itemReplay(
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
          this.assertModeMatchesSupplier(dto.mode, supplier.type);
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
                ...this.itemSnapshot(item),
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
          const duplicate = await this.itemReplay(
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

  async update(id: string, dto: UpdateInventoryItemDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
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
    const replay = await this.itemReplay(
      ITEM_UPDATE_ACTION,
      requestId,
      hash,
      actor,
    );
    if (replay) return replay;
    return this.prisma.$transaction(
      async (tx) => {
        const duplicate = await this.itemReplay(
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
            mutable.expiresAt !== undefined)
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
        this.assertModeMatchesSupplier(
          mutable.mode ?? current.mode,
          supplier.type,
        );
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
          await tx.inventoryStockBalance.deleteMany({
            where: { itemId: id, quantity: 0 },
          });
          await tx.inventoryStockBalance.create({
            data: {
              itemId: id,
              locationId: nextLocationId,
              batchCode: mutable.batchCode ?? current.batchCode ?? 'DEFAULT',
              expiresAt:
                mutable.expiresAt === undefined
                  ? current.expiresAt
                  : mutable.expiresAt,
              quantity: 0,
            },
          });
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
            oldValue: this.itemSnapshot(current) as never,
            newValue: {
              ...this.itemSnapshot(updated),
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

  async setStatus(id: string, dto: SetMasterDataStatusDto, actor: AuthUser) {
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
    const replay = await this.itemReplay(
      ITEM_STATUS_ACTION,
      requestId,
      hash,
      actor,
    );
    if (replay) return replay;
    return this.prisma.$transaction(
      async (tx) => {
        const duplicate = await this.itemReplay(
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
          this.assertModeMatchesSupplier(current.mode, supplier.type);
        } else {
          await this.assertItemCanDisable(tx, current);
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
            oldValue: this.itemSnapshot(current) as never,
            newValue: {
              ...this.itemSnapshot(updated),
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

  async transact(
    itemId: string,
    dto: InventoryTransactionDto,
    actor: AuthUser,
  ) {
    const allowedRoles: readonly AppRole[] =
      dto.type === InventoryTxnType.TRAINING_USAGE
        ? [AppRole.COACH, ...ADMIN_ROLES]
        : dto.type === InventoryTxnType.EVENT_USAGE
          ? [AppRole.EVENT_MANAGER, ...ADMIN_ROLES]
          : dto.type === InventoryTxnType.SALE_OUT
            ? [AppRole.FRONT_DESK, ...ADMIN_ROLES]
            : [AppRole.FRONT_DESK, ...ADMIN_ROLES];
    if (!hasRole(actor, allowedRoles)) {
      throw new ForbiddenException('当前角色无权执行该库存动作');
    }
    if (dto.quantity === 0)
      throw new BadRequestException('库存变动数量不能为 0');
    if (IN_TYPES.has(dto.type) && dto.quantity < 0)
      throw new BadRequestException('入库数量必须为正数');
    if (OUT_TYPES.has(dto.type) && dto.quantity > 0)
      throw new BadRequestException('出库数量必须为负数');
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('库存变动原因不能为空');
    if (
      (dto.type === InventoryTxnType.TRAINING_USAGE ||
        dto.type === InventoryTxnType.EVENT_USAGE) &&
      (!dto.referenceId || !dto.referenceType)
    ) {
      throw new BadRequestException('培训或赛事领用必须关联业务单据');
    }
    const existing = await this.prisma.inventoryTransaction.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      this.assertIdempotentReplay(existing, itemId, dto, actor);
      return existing;
    }
    // Legacy committed rows remain replayable, but new controlled movements
    // must originate from their business document workflow.
    if (DOCUMENT_CONTROLLED_TYPES.has(dto.type)) {
      throw new ConflictException(
        '该库存动作必须通过采购、盘点、调拨或报损单据执行',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Re-check inside the transaction so a retry that raced the
          // preflight lookup returns the original immutable ledger row.
          const duplicateInTransaction =
            await tx.inventoryTransaction.findUnique({
              where: { idempotencyKey: dto.idempotencyKey },
            });
          if (duplicateInTransaction) {
            this.assertIdempotentReplay(
              duplicateInTransaction,
              itemId,
              dto,
              actor,
            );
            return duplicateInTransaction;
          }
          const item = await tx.inventoryItem.findUnique({
            where: { id: itemId },
            include: { defaultLocation: true },
          });
          if (!item) throw new NotFoundException('库存商品不存在');
          if (item.enabled === false)
            throw new ConflictException('库存商品已停用，不能发生新库存动作');
          if (item.defaultLocation?.enabled === false)
            throw new ConflictException('默认库位已停用，不能发生新库存动作');
          const { stockAfter } = await applyInventoryDelta(
            tx,
            item,
            dto.quantity,
          );
          const transaction = await tx.inventoryTransaction.create({
            data: {
              itemId,
              type: dto.type,
              quantity: dto.quantity,
              stockBefore: item.stock,
              stockAfter,
              unitCostCents: dto.unitCostCents,
              orderItemId: dto.orderItemId,
              operatorId: actor.sub,
              reason,
              metadata: {
                ...dto.metadata,
                ...(dto.referenceId ? { referenceId: dto.referenceId } : {}),
                ...(dto.referenceType
                  ? { referenceType: dto.referenceType }
                  : {}),
              },
              idempotencyKey: dto.idempotencyKey,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'INVENTORY_CHANGED',
              objectType: 'InventoryItem',
              objectId: itemId,
              oldValue: { stock: item.stock } as never,
              newValue: {
                stock: stockAfter,
                type: dto.type,
                quantity: dto.quantity,
              } as never,
              reason,
            },
          });
          return transaction;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // Two identical requests can both pass the outer preflight before one
      // commits its unique idempotency row.  Resolve that unique-key race to
      // the committed row instead of leaking a 500/P2002 to the mini-app.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.inventoryTransaction.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (duplicate) {
          this.assertIdempotentReplay(duplicate, itemId, dto, actor);
          return duplicate;
        }
      }
      throw error;
    }
  }

  private async itemReplay(
    action: string,
    requestId: string,
    hash: string,
    actor: AuthUser,
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma;
    const audit = await client.auditLog.findFirst({
      where: { action, requestId, objectType: 'InventoryItem' },
      orderBy: { createdAt: 'desc' },
    });
    if (!audit) return null;
    if (audit.actorId !== actor.sub)
      throw new ConflictException('商品资料幂等键已由其他操作人使用');
    const value =
      audit.newValue && typeof audit.newValue === 'object'
        ? (audit.newValue as Record<string, unknown>)
        : null;
    if (value?.commandHash !== hash)
      throw new ConflictException('幂等键已用于其他商品资料指令');
    if (!audit.objectId)
      throw new ConflictException('商品资料幂等记录不完整，请联系管理员');
    const item = await client.inventoryItem.findUnique({
      where: { id: audit.objectId },
    });
    if (!item) throw new NotFoundException('幂等指令对应的商品不存在');
    return item;
  }

  private assertModeMatchesSupplier(
    mode: InventoryMode,
    supplierType: SupplierType,
  ) {
    const expected =
      mode === InventoryMode.CONSIGNMENT
        ? SupplierType.CONSIGNMENT
        : SupplierType.OWNED;
    if (supplierType !== expected) {
      throw new BadRequestException(
        mode === InventoryMode.CONSIGNMENT
          ? '代销 SKU 必须绑定寄售供应商'
          : '自营 SKU 必须绑定自营采购供应商',
      );
    }
  }

  private async assertItemCanDisable(
    tx: Prisma.TransactionClient,
    item: { id: string; stock: number },
  ) {
    const [
      openPurchaseLines,
      openStocktakeLines,
      openOperations,
      pendingOrders,
    ] = await Promise.all([
      tx.purchaseOrderLine.count({
        where: {
          itemId: item.id,
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
      tx.stocktakeLine.count({
        where: {
          itemId: item.id,
          stocktake: {
            status: {
              in: [
                StocktakeStatus.DRAFT,
                StocktakeStatus.COUNTING,
                StocktakeStatus.REVIEW,
              ],
            },
          },
        },
      }),
      tx.inventoryOperation.count({
        where: {
          itemId: item.id,
          status: {
            in: [
              InventoryOperationStatus.DRAFT,
              InventoryOperationStatus.SUBMITTED,
              InventoryOperationStatus.APPROVED,
            ],
          },
        },
      }),
      tx.orderItem.count({
        where: {
          itemId: item.id,
          order: {
            businessType: BusinessType.GOODS,
            status: OrderStatus.PENDING,
          },
        },
      }),
    ]);
    const blockers = [
      item.stock !== 0 ? `现存库存 ${item.stock}` : '',
      openPurchaseLines ? `未完采购明细 ${openPurchaseLines}` : '',
      openStocktakeLines ? `未完盘点明细 ${openStocktakeLines}` : '',
      openOperations ? `未过账库存单 ${openOperations}` : '',
      pendingOrders ? `待支付商品订单 ${pendingOrders}` : '',
    ].filter(Boolean);
    if (blockers.length) {
      throw new ConflictException(`商品暂不能停用：${blockers.join('、')}`);
    }
  }

  private itemSnapshot(item: {
    id: string;
    sku: string;
    name: string;
    category: string;
    mode: InventoryMode;
    supplier: string;
    supplierId: string | null;
    defaultLocationId: string | null;
    purchasePriceCents: number;
    salePriceCents: number;
    stock: number;
    safeStock: number;
    batchCode: string | null;
    expiresAt: Date | null;
    enabled: boolean;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      mode: item.mode,
      supplier: item.supplier,
      supplierId: item.supplierId,
      defaultLocationId: item.defaultLocationId,
      purchasePriceCents: item.purchasePriceCents,
      salePriceCents: item.salePriceCents,
      stock: item.stock,
      safeStock: item.safeStock,
      batchCode: item.batchCode,
      expiresAt: item.expiresAt?.toISOString() ?? null,
      enabled: item.enabled,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private requireRole(actor: AuthUser, roles: readonly AppRole[]) {
    if (!hasRole(actor, roles))
      throw new ForbiddenException('当前角色无权访问库存资料');
  }

  /**
   * An idempotency key is an immutable command identity, not a convenient
   * lookup alias.  Reusing it with a different item/quantity/type would
   * otherwise silently return the first ledger row and hide a client bug (or
   * a replay attack).  Validate the command shape on every replay path.
   */
  private assertIdempotentReplay(
    existing: {
      itemId?: string;
      type?: InventoryTxnType;
      quantity?: number;
      reason?: string;
      operatorId?: string;
    },
    itemId: string,
    dto: InventoryTransactionDto,
    actor: AuthUser,
  ): void {
    // Unit-test doubles and rows created before the ledger fields were
    // introduced may omit some properties.  Treat an omitted property as an
    // unknown value, but never accept a known conflicting value.
    if (
      (existing.itemId !== undefined && existing.itemId !== itemId) ||
      (existing.type !== undefined && existing.type !== dto.type) ||
      (existing.quantity !== undefined && existing.quantity !== dto.quantity) ||
      (existing.reason !== undefined && existing.reason !== dto.reason.trim())
    ) {
      throw new ConflictException('幂等键已用于其他库存指令，请更换幂等键');
    }
    // The same command may be retried by a different authorized operator
    // after a timeout; that is safe and should remain idempotent.  We only
    // validate immutable business fields above, not the actor identity.
    void actor;
  }
}
