import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  InventoryMode,
  InventoryTxnType,
  SupplierType,
} from '../generated/prisma/client.js';
import { InventoryOperationsService } from './inventory-operations.service.js';
import { InventoryService } from './inventory.service.js';

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const superAdmin: AuthUser = {
  sub: 'super-admin-1',
  displayName: '超级管理员',
  roles: [AppRole.SUPER_ADMIN],
};
const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
};
const frontDesk: AuthUser = {
  sub: 'front-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
};

const now = new Date('2026-08-30T08:00:00.000Z');

const runTransaction = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (client: Record<string, unknown>) => unknown) => work(tx));

describe('inventory master-data lifecycle', () => {
  it('rejects whitespace-only master fields and trims idempotency commands before opening a transaction', async () => {
    const transaction = vi.fn();
    const service = new InventoryOperationsService({
      $transaction: transaction,
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    const base = {
      name: '自营供应商',
      type: SupplierType.OWNED,
      settlementRule: {
        settlementCycle: 'MONTHLY',
        paymentTermsDays: 30,
      },
      reason: '新增供货关系',
      idempotencyKey: 'supplier-create-valid-1',
    };

    await expect(
      service.createSupplier({ ...base, code: '   ' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createSupplier(
        { ...base, code: 'SUP-1', idempotencyKey: '   short   ' },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createSupplier({ ...base, code: 'SUP-1', reason: '   ' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('enforces service-layer read authorization for inventory documents', async () => {
    const purchaseOrders = vi.fn();
    const stocktakes = vi.fn();
    const operations = vi.fn();
    const service = new InventoryOperationsService({
      purchaseOrder: { findMany: purchaseOrders },
      stocktake: { findMany: stocktakes },
      inventoryOperation: { findMany: operations },
    } as never);
    const member: AuthUser = {
      sub: 'member-1',
      displayName: '普通会员',
      roles: [AppRole.MEMBER],
    };

    expect(() => service.purchaseOrders(member)).toThrowError(
      ForbiddenException,
    );
    expect(() => service.stocktakes(member)).toThrowError(ForbiddenException);
    expect(() => service.operations(member)).toThrowError(ForbiddenException);
    expect(purchaseOrders).not.toHaveBeenCalled();
    expect(stocktakes).not.toHaveBeenCalled();
    expect(operations).not.toHaveBeenCalled();
  });

  it('enforces service-layer admin authorization before creating a supplier', async () => {
    const transaction = vi.fn();
    const service = new InventoryOperationsService({
      $transaction: transaction,
    } as never);

    await expect(
      service.createSupplier(
        {
          code: 'vendor-1',
          name: '寄售伙伴',
          type: SupplierType.CONSIGNMENT,
          settlementRule: {
            settlementCycle: 'MONTHLY',
            commissionRateBps: 2500,
          },
          reason: '新增寄售合作方',
          idempotencyKey: 'supplier-create-1',
        },
        finance,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates an auditable supplier and replays the same command without another write', async () => {
    const supplier = {
      id: 'supplier-1',
      code: 'VENDOR-1',
      name: '寄售伙伴',
      type: SupplierType.CONSIGNMENT,
      contactName: null,
      contactPhone: null,
      settlementRule: {
        settlementCycle: 'MONTHLY',
        commissionRateBps: 2500,
      },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      supplier: {
        create: vi.fn().mockResolvedValue(supplier),
        findUniqueOrThrow: vi.fn().mockResolvedValue(supplier),
      },
    };
    const prisma = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      supplier: { findUniqueOrThrow: vi.fn().mockResolvedValue(supplier) },
      $transaction: runTransaction(tx),
    };
    const service = new InventoryOperationsService(prisma as never);
    const command = {
      code: 'vendor-1',
      name: '寄售伙伴',
      type: SupplierType.CONSIGNMENT,
      settlementRule: {
        settlementCycle: 'MONTHLY',
        commissionRateBps: 2500,
      },
      reason: '新增寄售合作方',
      idempotencyKey: 'supplier-create-1',
    };

    await expect(service.createSupplier(command, admin)).resolves.toBe(
      supplier,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'SUPPLIER_CREATED',
        actorId: admin.sub,
        requestId: command.idempotencyKey,
        reason: command.reason,
        oldValue: expect.anything(),
        newValue: expect.objectContaining({ commandHash: expect.any(String) }),
      }),
    });

    const createdAudit = tx.auditLog.create.mock.calls[0][0].data;
    prisma.auditLog.findFirst.mockResolvedValueOnce({
      objectId: supplier.id,
      actorId: admin.sub,
      newValue: createdAudit.newValue,
    });
    await expect(service.createSupplier(command, admin)).resolves.toBe(
      supplier,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    prisma.auditLog.findFirst.mockResolvedValueOnce({
      objectId: supplier.id,
      actorId: admin.sub,
      newValue: createdAudit.newValue,
    });
    await expect(service.createSupplier(command, superAdmin)).rejects.toThrow(
      '其他操作人',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('blocks disabling a supplier while an unfinished purchase order exists', async () => {
    const supplier = {
      id: 'supplier-1',
      code: 'OWN-1',
      name: '自营供货商',
      type: SupplierType.OWNED,
      contactName: null,
      contactPhone: null,
      settlementRule: { settlementCycle: 'MONTHLY', paymentTermsDays: 30 },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      supplier: { findUnique: vi.fn().mockResolvedValue(supplier) },
      purchaseOrder: { count: vi.fn().mockResolvedValue(1) },
      inventoryItem: { count: vi.fn().mockResolvedValue(0) },
    };
    const service = new InventoryOperationsService({
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: runTransaction(tx),
    } as never);

    await expect(
      service.setSupplierStatus(
        supplier.id,
        {
          enabled: false,
          expectedUpdatedAt: now.toISOString(),
          reason: '合作结束停用',
          idempotencyKey: 'supplier-disable-1',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks disabling a location with balance, default SKUs or unfinished documents', async () => {
    const location = {
      id: 'location-1',
      code: 'MAIN',
      name: '主仓',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      inventoryLocation: { findUnique: vi.fn().mockResolvedValue(location) },
      inventoryStockBalance: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 3 } }),
      },
      inventoryItem: { count: vi.fn().mockResolvedValue(1) },
      purchaseOrderLine: { count: vi.fn().mockResolvedValue(1) },
      stocktake: { count: vi.fn().mockResolvedValue(1) },
      inventoryOperation: { count: vi.fn().mockResolvedValue(1) },
    };
    const service = new InventoryOperationsService({
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: runTransaction(tx),
    } as never);

    await expect(
      service.setLocationStatus(
        location.id,
        {
          enabled: false,
          expectedUpdatedAt: now.toISOString(),
          reason: '尝试停用仍被使用的库位',
          idempotencyKey: 'location-disable-1',
        },
        admin,
      ),
    ).rejects.toThrow('现存数量 3');
    expect(tx.inventoryItem.count).toHaveBeenCalledOnce();
    expect(tx.purchaseOrderLine.count).toHaveBeenCalledOnce();
    expect(tx.stocktake.count).toHaveBeenCalledOnce();
    expect(tx.inventoryOperation.count).toHaveBeenCalledOnce();
  });

  it('creates an SKU with supplier/location context and a zero balance snapshot', async () => {
    const supplier = {
      id: 'supplier-1',
      name: '寄售伙伴',
      type: SupplierType.CONSIGNMENT,
      enabled: true,
    };
    const location = { id: 'location-1', enabled: true };
    const item = {
      id: 'item-1',
      sku: 'GRIP-NEW',
      name: '新款手胶',
      category: '手胶',
      mode: InventoryMode.CONSIGNMENT,
      supplier: supplier.name,
      supplierId: supplier.id,
      defaultLocationId: location.id,
      purchasePriceCents: 800,
      salePriceCents: 1500,
      stock: 0,
      safeStock: 10,
      batchCode: 'DEFAULT',
      expiresAt: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const tx = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      supplier: { findUnique: vi.fn().mockResolvedValue(supplier) },
      inventoryLocation: { findUnique: vi.fn().mockResolvedValue(location) },
      inventoryItem: {
        create: vi.fn().mockResolvedValue(item),
        findUnique: vi.fn(),
      },
      inventoryStockBalance: { create: vi.fn().mockResolvedValue({}) },
    };
    const auditFindFirst = vi.fn().mockResolvedValue(null);
    const service = new InventoryService({
      auditLog: { findFirst: auditFindFirst },
      $transaction: runTransaction(tx),
    } as never);
    const command = {
      sku: 'grip-new',
      name: '新款手胶',
      category: '手胶',
      mode: InventoryMode.CONSIGNMENT,
      supplierId: supplier.id,
      defaultLocationId: location.id,
      purchasePriceCents: 800,
      salePriceCents: 1500,
      safeStock: 10,
      reason: '新增寄售商品',
      idempotencyKey: 'inventory-item-create-1',
    };

    await expect(service.create(command, admin)).resolves.toBe(item);
    expect(tx.inventoryItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sku: 'GRIP-NEW',
        supplier: supplier.name,
        supplierId: supplier.id,
        defaultLocationId: location.id,
      }),
    });
    expect(tx.inventoryStockBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 0, batchCode: 'DEFAULT' }),
    });

    const createdAudit = tx.auditLog.create.mock.calls[0][0].data;
    auditFindFirst.mockResolvedValueOnce({
      objectId: item.id,
      actorId: admin.sub,
      newValue: createdAudit.newValue,
    });
    await expect(service.create(command, superAdmin)).rejects.toThrow(
      '其他操作人',
    );
  });

  it('blocks both deactivation with remaining stock and movement after deactivation', async () => {
    const item = {
      id: 'item-1',
      sku: 'BALL-1',
      name: '训练球',
      category: '羽毛球',
      mode: InventoryMode.PURCHASE,
      supplier: '供货商',
      supplierId: 'supplier-1',
      defaultLocationId: 'location-1',
      purchasePriceCents: 6800,
      salePriceCents: 8800,
      stock: 3,
      safeStock: 1,
      batchCode: 'DEFAULT',
      expiresAt: null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const statusTx = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      inventoryItem: { findUnique: vi.fn().mockResolvedValue(item) },
      purchaseOrderLine: { count: vi.fn().mockResolvedValue(0) },
      stocktakeLine: { count: vi.fn().mockResolvedValue(0) },
      inventoryOperation: { count: vi.fn().mockResolvedValue(0) },
      orderItem: { count: vi.fn().mockResolvedValue(0) },
    };
    const statusService = new InventoryService({
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: runTransaction(statusTx),
    } as never);
    await expect(
      statusService.setStatus(
        item.id,
        {
          enabled: false,
          expectedUpdatedAt: now.toISOString(),
          reason: '商品停止经营',
          idempotencyKey: 'inventory-item-disable-1',
        },
        admin,
      ),
    ).rejects.toThrow('现存库存 3');

    const movementTx = {
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({ ...item, enabled: false }),
      },
    };
    const movementService = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runTransaction(movementTx),
    } as never);
    await expect(
      movementService.transact(
        item.id,
        {
          type: InventoryTxnType.SALE_OUT,
          quantity: -1,
          reason: '前台销售',
          idempotencyKey: 'disabled-item-sale-1',
        },
        frontDesk,
      ),
    ).rejects.toThrow('已停用');
  });
});
