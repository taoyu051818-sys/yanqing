import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  InventoryOperationStatus,
  InventoryOperationType,
  PurchaseOrderStatus,
  SupplierType,
} from '../generated/prisma/client.js';
import { InventoryOperationsService } from './inventory-operations.service.js';

const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};

const transactional = (tx: Record<string, unknown>) => ({
  $transaction: vi.fn(
    async (work: (client: Record<string, unknown>) => unknown) => work(tx),
  ),
});

describe('InventoryOperationsService', () => {
  it('enforces maker/checker when approving a purchase order', async () => {
    const order = {
      id: 'po-1',
      status: PurchaseOrderStatus.SUBMITTED,
      createdById: admin.sub,
      submittedById: admin.sub,
    };
    const tx = {
      purchaseOrder: { findUnique: vi.fn().mockResolvedValue(order) },
    };
    const service = new InventoryOperationsService(transactional(tx) as never);

    await expect(
      service.approvePurchaseOrder(order.id, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records partial receipt, location balance and immutable ledger atomically', async () => {
    const order = {
      id: 'po-1',
      orderNo: 'PO001',
      status: PurchaseOrderStatus.APPROVED,
      supplier: { type: SupplierType.OWNED },
      lines: [
        {
          id: 'line-1',
          itemId: 'item-1',
          locationId: 'loc-1',
          orderedQuantity: 10,
          receivedQuantity: 0,
          unitCostCents: 500,
          batchCode: 'DEFAULT',
          expiresAt: null,
          item: { id: 'item-1', stock: 3, defaultLocationId: 'loc-1' },
        },
      ],
    };
    const receipt = {
      id: 'receipt-1',
      purchaseOrderId: order.id,
      idempotencyKey: 'receipt-key-1',
      operatorId: admin.sub,
    };
    const tx = {
      purchaseOrder: {
        findUnique: vi.fn().mockResolvedValue(order),
        update: vi.fn().mockResolvedValue({}),
      },
      purchaseReceipt: {
        create: vi.fn().mockResolvedValue(receipt),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...receipt, lines: [{ quantity: 4 }] }),
      },
      inventoryStockBalance: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bal-1', quantity: 3 }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
      },
      inventoryItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryTransaction: {
        create: vi.fn().mockResolvedValue({ id: 'txn-1' }),
      },
      purchaseReceiptLine: { create: vi.fn().mockResolvedValue({}) },
      purchaseOrderLine: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      purchaseReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      ...transactional(tx),
    };
    const service = new InventoryOperationsService(prisma as never);

    const response = await service.receivePurchaseOrder(
      order.id,
      {
        lines: [{ lineId: 'line-1', quantity: 4 }],
        idempotencyKey: 'receipt-key-1',
      },
      admin,
    );
    expect(response).toMatchObject({ id: receipt.id });
    expect(response).not.toHaveProperty('idempotencyKey');
    expect(response).not.toHaveProperty('operatorId');
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1', stock: 3 },
      data: { stock: { increment: 4 } },
    });
    expect(tx.inventoryStockBalance.update).toHaveBeenCalledWith({
      where: { id: 'bal-1' },
      data: { quantity: { increment: 4 }, expiresAt: null },
    });
    expect(tx.purchaseOrder.update).toHaveBeenLastCalledWith({
      where: { id: order.id },
      data: { status: PurchaseOrderStatus.PARTIAL_RECEIVED },
    });
  });

  it('rejects receiving beyond the remaining ordered quantity before stock writes', async () => {
    const tx = {
      purchaseOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'po-1',
          status: PurchaseOrderStatus.APPROVED,
          supplier: { type: SupplierType.OWNED },
          lines: [
            {
              id: 'line-1',
              orderedQuantity: 5,
              receivedQuantity: 4,
              item: { id: 'item-1', stock: 4, defaultLocationId: 'loc-1' },
            },
          ],
        }),
      },
      purchaseReceipt: {
        create: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
      },
      inventoryItem: { updateMany: vi.fn() },
    };
    const service = new InventoryOperationsService({
      purchaseReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      ...transactional(tx),
    } as never);

    await expect(
      service.receivePurchaseOrder(
        'po-1',
        {
          lines: [{ lineId: 'line-1', quantity: 2 }],
          idempotencyKey: 'receipt-key-2',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('keeps a posted transfer idempotent without a second stock mutation', async () => {
    const operation = {
      id: 'op-1',
      type: InventoryOperationType.TRANSFER,
      status: InventoryOperationStatus.POSTED,
      postIdempotencyKey: 'operation-key-1',
    };
    const tx = {
      inventoryOperation: { findUnique: vi.fn().mockResolvedValue(operation) },
      inventoryStockBalance: { update: vi.fn() },
    };
    const service = new InventoryOperationsService(transactional(tx) as never);

    const response = await service.postOperation(
      operation.id,
      { idempotencyKey: operation.postIdempotencyKey },
      admin,
    );
    expect(response).toEqual({
      id: operation.id,
      type: operation.type,
      status: operation.status,
    });
    expect(response).not.toHaveProperty('postIdempotencyKey');
    expect(tx.inventoryStockBalance.update).not.toHaveBeenCalled();
  });

  it('snapshots every batch at a stocktake location', async () => {
    const item = { id: 'item-1', enabled: true, defaultLocationId: null };
    const balances = [
      {
        id: 'bal-a',
        itemId: item.id,
        batchCode: 'BATCH-A',
        expiresAt: new Date('2027-01-01'),
        quantity: 2,
        item,
      },
      {
        id: 'bal-b',
        itemId: item.id,
        batchCode: 'BATCH-B',
        expiresAt: new Date('2027-02-01'),
        quantity: 3,
        item,
      },
    ];
    const tx = {
      stocktake: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'stocktake-1',
          status: 'DRAFT',
          locationId: 'loc-1',
        }),
        update: vi.fn().mockResolvedValue({}),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: 'stocktake-1', lines: [] }),
      },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([item]) },
      inventoryStockBalance: {
        findMany: vi.fn().mockResolvedValue(balances),
        create: vi.fn(),
      },
      stocktakeLine: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new InventoryOperationsService(transactional(tx) as never);

    await service.startStocktake('stocktake-1', admin);
    expect(tx.stocktakeLine.create).toHaveBeenCalledTimes(2);
    expect(tx.stocktakeLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ batchCode: 'BATCH-A', bookQuantity: 2 }),
    });
    expect(tx.stocktakeLine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ batchCode: 'BATCH-B', bookQuantity: 3 }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.sub,
        action: 'STOCKTAKE_STARTED',
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'COUNTING' },
      }),
    });
  });
});
