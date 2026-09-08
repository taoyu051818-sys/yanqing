import { describe, expect, it } from 'vitest';
import { trainingConsumptionQuote } from './training-contract.js';

describe('frozen training contract allocation', () => {
  it.each([
    [10000, 3],
    [10001, 3],
    [6, 10],
    [198000, 10],
  ])(
    'conserves every cent of %i across %i sessions',
    (totalAmountCents, totalSessions) => {
      let prepaidBalanceCents = totalAmountCents;
      const amounts: number[] = [];
      for (
        let consumedSessions = 0;
        consumedSessions < totalSessions;
        consumedSessions++
      ) {
        const quote = trainingConsumptionQuote({
          totalAmountCents,
          totalSessions,
          consumedSessions,
          prepaidBalanceCents,
        });
        expect(Number.isInteger(quote.amountCents)).toBe(true);
        expect(quote.amountCents).toBeGreaterThanOrEqual(0);
        prepaidBalanceCents -= quote.amountCents;
        amounts.push(quote.amountCents);
        if (consumedSessions < totalSessions - 1)
          expect(prepaidBalanceCents).toBeGreaterThan(0);
      }
      expect(prepaidBalanceCents).toBe(0);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(totalAmountCents);
    },
  );
  it('caps a partially refunded last paid lesson at its remaining balance', () => {
    expect(
      trainingConsumptionQuote({
        totalAmountCents: 10000,
        totalSessions: 10,
        consumedSessions: 4,
        prepaidBalanceCents: 500,
      }).amountCents,
    ).toBe(500);
  });
  it('absorbs a legacy rounding remainder at the final session', () => {
    expect(
      trainingConsumptionQuote({
        totalAmountCents: 10000,
        totalSessions: 3,
        consumedSessions: 2,
        prepaidBalanceCents: 3334,
      }).amountCents,
    ).toBe(3334);
  });
  it('settles only the restored balance after a final-session reversal', () => {
    expect(
      trainingConsumptionQuote({
        totalAmountCents: 10000,
        totalSessions: 3,
        consumedSessions: 2,
        prepaidBalanceCents: 2834,
      }).amountCents,
    ).toBe(2834);
  });
  it.each([
    { totalAmountCents: undefined },
    { totalSessions: 0 },
    { consumedSessions: 10 },
    { prepaidBalanceCents: -1 },
  ])('rejects an incomplete or invalid contract: %j', (override) => {
    expect(() =>
      trainingConsumptionQuote({
        totalAmountCents: 10000,
        totalSessions: 10,
        consumedSessions: 0,
        prepaidBalanceCents: 10000,
        ...override,
      } as never),
    ).toThrow('培训合同金额');
  });
});
