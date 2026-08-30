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
} from './inventory.dto.js';

const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

const FRONT_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];
const ADMIN_ROLES: readonly AppRole[] = [AppRole.ADMIN, AppRole.SUPER_ADMIN];

@Injectable()
export class InventoryOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  suppliers() {
    return this.prisma.supplier.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    });
  }

  locations() {
    return this.prisma.inventoryLocation.findMany({
      include: {
        stockBalances: {
          include: { item: true },
          orderBy: { item: { name: 'asc' } },
        },
      },
      orderBy: [{ enabled: 'desc' }, { code: 'asc' }],
    });
  }

  purchaseOrders() {
    return this.prisma.purchaseOrder.findMany({
      include: {
        supplier: true,
        lines: { include: { item: true, location: true } },
        receipts: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  stocktakes() {
    return this.prisma.stocktake.findMany({
      include: { location: true, lines: { include: { item: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  operations() {
    return this.prisma.inventoryOperation.findMany({
      include: { item: true, sourceLocation: true, targetLocation: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  createSupplier(dto: CreateSupplierDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          type: dto.type,
          contactName: dto.contactName?.trim() || null,
          contactPhone: dto.contactPhone?.trim() || null,
          settlementRule: dto.settlementRule as never,
        },
      });
      await this.audit(
        tx,
        actor,
        'SUPPLIER_CREATED',
        'Supplier',
        supplier.id,
        'ABSENT',
        'ENABLED',
        `创建供应商 ${supplier.name}`,
      );
      return supplier;
    });
  }

  createLocation(dto: CreateInventoryLocationDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const location = await tx.inventoryLocation.create({
        data: { code: dto.code.trim().toUpperCase(), name: dto.name.trim() },
      });
      await this.audit(
        tx,
        actor,
        'INVENTORY_LOCATION_CREATED',
        'InventoryLocation',
        location.id,
        'ABSENT',
        'ENABLED',
        `创建库位 ${location.name}`,
      );
      return location;
    });
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
      return existing;
    }
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { supplier: true, lines: { include: { item: true } } },
        });
        if (!order) throw new NotFoundException('采购单不存在');
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
        return tx.purchaseReceipt.findUniqueOrThrow({
          where: { id: receipt.id },
          include: { lines: true },
        });
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
    return this.prisma.stocktake.create({
      data: {
        stocktakeNo: serial('ST'),
        locationId: location.id,
        reason: dto.reason.trim(),
        createdById: actor.sub,
      },
      include: { location: true, lines: true },
    });
  }

  startStocktake(id: string, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({ where: { id } });
      if (!stocktake) throw new NotFoundException('盘点单不存在');
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
    });
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
    return this.prisma.$transaction(async (tx) => {
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
    });
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
          return stocktake;
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
        return tx.stocktake.findUniqueOrThrow({
          where: { id },
          include: { location: true, lines: { include: { item: true } } },
        });
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
    return this.prisma.inventoryOperation.create({
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
  }

  submitOperation(id: string, actor: AuthUser) {
    this.requireRole(actor, FRONT_ROLES);
    return this.moveOperation(
      id,
      InventoryOperationStatus.DRAFT,
      InventoryOperationStatus.SUBMITTED,
      actor,
    );
  }

  approveOperation(id: string, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(async (tx) => {
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
    });
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
          include: { item: true },
        });
        if (!operation) throw new NotFoundException('库存业务单不存在');
        if (operation.status === InventoryOperationStatus.POSTED) {
          if (operation.postIdempotencyKey !== dto.idempotencyKey)
            throw new ConflictException('库存业务单已使用其他幂等键过账');
          return operation;
        }
        if (operation.status !== InventoryOperationStatus.APPROVED)
          throw new ConflictException('库存业务单尚未审批');
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
        return tx.inventoryOperation.findUniqueOrThrow({
          where: { id },
          include: { item: true, sourceLocation: true, targetLocation: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelOperation(id: string, dto: CancelDocumentDto, actor: AuthUser) {
    this.requireRole(actor, ADMIN_ROLES);
    return this.prisma.$transaction(async (tx) => {
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
    });
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
