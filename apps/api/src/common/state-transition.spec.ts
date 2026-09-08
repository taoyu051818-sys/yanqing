import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { stateTransition } from './state-transition.js';

describe('state transition conflict responses', () => {
  it.each([
    { code: 'P2034' },
    { code: 'P2002' },
    { code: 'P2025' },
    { code: 'P2010', meta: { code: '40001' } },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    },
  ])(
    'turns a database concurrency failure into a refreshable conflict: %j',
    async (failure) => {
      const db = { $transaction: vi.fn().mockRejectedValue(failure) };
      await expect(
        stateTransition(db as never, async () => null),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.$transaction).toHaveBeenCalledOnce();
    },
  );
  it('preserves unrelated database failures', async () => {
    const failure = { code: 'P2010', meta: { code: '42P01' } };
    const db = { $transaction: vi.fn().mockRejectedValue(failure) };
    await expect(stateTransition(db as never, async () => null)).rejects.toBe(
      failure,
    );
  });
});
