import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260830104500_training_consume_corrections/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('training consume correction migration invariants', () => {
  it('replaces legacy nonnegative constraints so signed reversals and net-negative settlements are valid', () => {
    expect(migration).toContain(
      'DROP CONSTRAINT "TrainingRecognition_contract_invariants"',
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "TrainingSettlement_contract_invariants"',
    );
    expect(migration).toContain(
      '"type" = \'REVERSAL\' AND "effectiveRevenueCents" <= 0',
    );
    expect(migration).toContain(
      '"venueContributionCents" = ROUND("effectiveRevenueCents" * 2000 / 10000.0)',
    );
  });

  it('enforces one active correction and complete status evidence at the database boundary', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "training_correction_one_active_per_recognition"',
    );
    expect(migration).toContain(
      "WHERE \"status\" IN ('REQUESTED', 'APPROVED')",
    );
    expect(migration).toContain(
      'CONSTRAINT "training_correction_status_fields_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "training_correction_request_key_check"',
    );
  });
});
