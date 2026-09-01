import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { applyInventoryDelta } from './inventory-balance.js';

describe('inventory balance concurrent sale guard', () => {
  it('allows only one of two simultaneous sales to consume the last unit', async () => {
    let aggregateStock = 1;
    let locationStock = 1;

    const transactionClient = () => ({
      inventoryItem: {
        updateMany: vi.fn(async ({ where, data }) => {
          if (aggregateStock !== where.stock) return { count: 0 };
          aggregateStock = data.stock;
          return { count: 1 };
        }),
      },
      inventoryStockBalance: {
        findUnique: vi.fn(async () => ({
          id: 'balance-1',
          quantity: locationStock,
        })),
        findMany: vi.fn(async () => [{ quantity: locationStock }]),
        updateMany: vi.fn(async ({ where, data }) => {
          if (locationStock !== where.quantity) return { count: 0 };
          locationStock = data.quantity;
          return { count: 1 };
        }),
      },
    });
    const observedLastUnit = {
      id: 'item-last-unit',
      stock: 1,
      defaultLocationId: 'location-1',
      batchCode: null,
      expiresAt: null,
    };

    const results = await Promise.allSettled([
      applyInventoryDelta(
        transactionClient() as never,
        observedLastUnit,
        -1,
      ),
      applyInventoryDelta(
        transactionClient() as never,
        observedLastUnit,
        -1,
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
      '库存已被其他操作更新，请重试',
    );
    expect(aggregateStock).toBe(0);
    expect(locationStock).toBe(0);
  });
});
