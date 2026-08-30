import { describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole, InventoryTxnType } from '../generated/prisma/enums.js';
import type { InventoryTransactionDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
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

    await expect(service.transact('item-1', dto(), frontDesk)).resolves.toBe(
      existing,
    );
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
      service.transact('item-1', dto({ quantity: 6 }), frontDesk),
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
        frontDesk,
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
        frontDesk,
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
      service.transact('item-1', dto(), frontDesk),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('allows a coach to record training usage only with a class reference', async () => {
    const tx = {
      inventoryTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'txn-training' }),
      },
      inventoryItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'item-1',
          stock: 10,
          defaultLocationId: 'loc-1',
          batchCode: null,
          expiresAt: null,
        }),
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
        dto({ type: InventoryTxnType.TRAINING_USAGE, quantity: -2 }),
        coach,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();

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
    ).resolves.toMatchObject({ id: 'txn-training' });
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: InventoryTxnType.TRAINING_USAGE,
          quantity: -2,
          metadata: {
            referenceType: 'TrainingSession',
            referenceId: 'session-1',
          },
        }),
      }),
    );
  });

  it('allows an event manager to record event usage but not purchase stock', async () => {
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
