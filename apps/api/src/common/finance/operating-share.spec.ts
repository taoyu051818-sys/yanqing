import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { BusinessType } from '../../generated/prisma/enums.js';
import {
  operatingShareCents,
  operatingShareSnapshotFromOrder,
  resolveOperatingShareSnapshot,
} from './operating-share.js';

describe('operating share rule', () => {
  it('uses the effective administrator-configured rate and preserves its version evidence', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'share-rate-v2',
      value: 1_800,
      effectiveFrom: new Date('2026-09-01T00:00:00+08:00'),
      effectiveTo: null,
    });
    const snapshot = await resolveOperatingShareSnapshot(
      { systemParameter: { findFirst } } as never,
      BusinessType.VENUE,
      new Date('2026-09-02T10:00:00+08:00'),
    );

    expect(snapshot).toEqual({
      key: 'finance.operating_share_rate_bps',
      parameterId: 'share-rate-v2',
      rateBps: 1_800,
      businessType: BusinessType.VENUE,
      included: true,
      basis: 'REALIZED_NET_REVENUE',
      effectiveFrom: '2026-08-31T16:00:00.000Z',
      effectiveTo: null,
    });
    expect(operatingShareCents(10_001, snapshot)).toBe(1_800);
  });

  it('excludes recharge from realized-revenue sharing without querying a rate', async () => {
    const findFirst = vi.fn();
    const snapshot = await resolveOperatingShareSnapshot(
      { systemParameter: { findFirst } } as never,
      BusinessType.RECHARGE,
    );

    expect(snapshot).toMatchObject({ included: false, rateBps: 0 });
    expect(operatingShareCents(100_000, snapshot)).toBe(0);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when the stored financial rate is corrupt', async () => {
    await expect(
      resolveOperatingShareSnapshot(
        {
          systemParameter: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'bad',
              value: 10_001,
              effectiveFrom: new Date(),
              effectiveTo: null,
            }),
          },
        } as never,
        BusinessType.EVENT,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a refund on the original order rate after an administrator edits the current rule', () => {
    const original = operatingShareSnapshotFromOrder(
      { operatingShare: { included: true, rateBps: 1_500 } },
      BusinessType.GAME,
    );
    expect(operatingShareCents(-10_000, original)).toBe(-1_500);
  });
});
