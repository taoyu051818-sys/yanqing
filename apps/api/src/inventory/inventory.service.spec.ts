import { describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import {
  AppRole,
  InventoryMode,
  InventoryOperationStatus,
  InventoryTxnType,
} from '../generated/prisma/enums.js';
import type { InventoryTransactionDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
};
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const coach: AuthUser = {
  sub: 'coach-1',
  displayName: '教练',
  roles: [AppRole.COACH],
};
const eventManager: AuthUser = {
  sub: 'event-manager-1',
  displayName: '赛事管理员',
  roles: [AppRole.EVENT_MANAGER],
};

const dto = (
  overrides: Partial<InventoryTransactionDto> = {},
): InventoryTransactionDto => ({
  type: InventoryTxnType.PURCHASE_IN,
  quantity: 5,
  reason: '补货',
  idempotencyKey: 'inventory-key-1',
  ...overrides,
});

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

describe('InventoryService stock ledger', () => {
  it('rejects inventory mutation by a coach before opening a transaction', async () => {
    const transaction = vi.fn();
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn() },
      $transaction: transaction,
    } as never);

    await expect(
      service.transact('item-1', dto(), coach),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns an existing idempotent ledger row without changing stock', async () => {
    const existing = { id: 'txn-1', idempotencyKey: 'inventory-key-1' };
    const transaction = vi.fn();
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: transaction,
    } as never);

    await expect(service.transact('item-1', dto(), admin)).resolves.toEqual({
      id: existing.id,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects replaying an idempotency key with a different command', async () => {
    const existing = {
      id: 'txn-1',
      idempotencyKey: 'inventory-key-1',
      itemId: 'item-1',
      type: InventoryTxnType.PURCHASE_IN,
      quantity: 5,
      reason: '补货',
    };
    const transaction = vi.fn();
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(existing) },
      $transaction: transaction,
    } as never);

    await expect(
      service.transact('item-1', dto({ quantity: 6 }), admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a negative resulting stock and never writes a transaction', async () => {
    const tx = {
      inventoryTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item-1',
          stock: 2,
          defaultLocationId: 'loc-1',
          batchCode: null,
          expiresAt: null,
        }),
        updateMany: vi.fn(),
      },
      inventoryStockBalance: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bal-1', quantity: 2 }),
        findMany: vi.fn().mockResolvedValue([{ quantity: 2 }]),
        updateMany: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    } as never);

    await expect(
      service.transact(
        'item-1',
        dto({ type: InventoryTxnType.SALE_OUT, quantity: -3 }),
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  it('uses an observed-stock guard for a successful movement', async () => {
    const item = {
      id: 'item-1',
      stock: 10,
      defaultLocationId: 'loc-1',
      batchCode: null,
      expiresAt: null,
    };
    const tx = {
      inventoryTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'txn-1' }),
      },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryStockBalance: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bal-1', quantity: 10 }),
        findMany: vi.fn().mockResolvedValue([{ quantity: 10 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    } as never);

    await expect(
      service.transact(
        'item-1',
        dto({ type: InventoryTxnType.SALE_OUT, quantity: -5 }),
        admin,
      ),
    ).resolves.toEqual({ id: 'txn-1' });
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1', stock: 10 },
      data: { stock: 5 },
    });
    expect(tx.inventoryStockBalance.updateMany).toHaveBeenCalledWith({
      where: { id: 'bal-1', quantity: 10 },
      data: { quantity: 5 },
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('requires controlled inventory movements to use a business document', async () => {
    const transaction = vi.fn();
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as never);

    await expect(
      service.transact('item-1', dto(), admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps training material usage out of the full inventory API for coaches', async () => {
    const transaction = vi.fn();
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: transaction,
    } as never);

    await expect(
      service.transact(
        'item-1',
        dto({
          type: InventoryTxnType.TRAINING_USAGE,
          quantity: -2,
          referenceType: 'TrainingSession',
          referenceId: 'session-1',
        }),
        coach,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns award choices with an explicit non-financial projection', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'item-1',
        sku: 'BALL-01',
        name: '比赛用球',
        stock: 8,
        enabled: true,
      },
    ]);
    const service = new InventoryService({
      inventoryItem: { findMany },
    } as never);

    await expect(service.awardOptions(eventManager)).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, sku: true, name: true, stock: true, enabled: true },
      }),
    );
    expect(JSON.stringify(findMany.mock.calls[0][0])).not.toContain(
      'purchasePriceCents',
    );
  });

  it('returns only the low-stock fields needed by front desk', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'item-1',
        sku: 'BALL-01',
        name: '比赛用球',
        mode: InventoryMode.CONSIGNMENT,
        stock: 2,
        safeStock: 8,
      },
    ]);
    const service = new InventoryService({ $queryRaw: queryRaw } as never);

    const result = await service.lowStock(frontDesk);

    expect(result).toEqual([
      {
        id: 'item-1',
        sku: 'BALL-01',
        name: '比赛用球',
        mode: InventoryMode.CONSIGNMENT,
        stock: 2,
        safeStock: 8,
      },
    ]);
    expect(JSON.stringify(queryRaw.mock.calls[0])).not.toContain(
      'purchasePriceCents',
    );
    expect(JSON.stringify(queryRaw.mock.calls[0])).not.toContain('supplier');
    expect(String(queryRaw.mock.calls[0][0])).toContain('mode');
  });

  it('keeps ledger and posting evidence out of full inventory reads', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'item-1',
        transactions: [
          {
            id: 'transaction-private',
            itemId: 'item-1',
            type: InventoryTxnType.SALE_OUT,
            quantity: -1,
            reason: '前台零售',
            idempotencyKey: 'inventory-private-key',
            metadata: { upstreamSecret: 'private' },
          },
        ],
        inventoryDocuments: [
          {
            id: 'operation-private',
            status: InventoryOperationStatus.POSTED,
            postIdempotencyKey: 'operation-private-key',
            sourceTransactionId: 'transaction-private-source',
            targetTransactionId: 'transaction-private-target',
          },
        ],
      },
    ]);
    const service = new InventoryService({
      inventoryItem: { findMany },
    } as never);

    const result = await service.list(admin);

    expect(JSON.stringify(result)).not.toMatch(
      /idempotencyKey|postIdempotencyKey|metadata|sourceTransactionId|targetTransactionId|upstreamSecret/,
    );
  });

  it('does not expose full inventory reads to front desk', () => {
    const findMany = vi.fn();
    const service = new InventoryService({
      inventoryItem: { findMany },
    } as never);
    expect(() => service.list(frontDesk)).toThrow(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps event material usage out of the full inventory API', async () => {
    const service = new InventoryService({
      inventoryTransaction: { findUnique: vi.fn() },
    } as never);
    await expect(
      service.transact(
        'item-1',
        dto({ type: InventoryTxnType.PURCHASE_IN }),
        eventManager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
