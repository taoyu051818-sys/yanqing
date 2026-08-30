import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260830160000_event_waitlist_cancellation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('event waitlist cancellation legacy migration', () => {
  it('derives the member-fee snapshot from the linked legacy order before applying the default', () => {
    const nullableColumn = 'ADD COLUMN "memberFeeApplied" BOOLEAN,';
    const legacyOrderBackfill =
      '"memberFeeApplied" = COALESCE(\n    team."memberFeeApplied",\n    orders."discountCents" > 0\n  )';
    const missingEvidenceFallback =
      'SET "memberFeeApplied" = false\nWHERE "memberFeeApplied" IS NULL;';
    const defaultAndNotNull =
      'ALTER COLUMN "memberFeeApplied" SET DEFAULT false,\n  ALTER COLUMN "memberFeeApplied" SET NOT NULL;';

    expect(migration).toContain(nullableColumn);
    expect(migration).not.toContain(
      'ADD COLUMN "memberFeeApplied" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(migration).toContain(legacyOrderBackfill);
    expect(migration).toContain(missingEvidenceFallback);
    expect(migration).toContain(defaultAndNotNull);

    expect(migration.indexOf(nullableColumn)).toBeLessThan(
      migration.indexOf(legacyOrderBackfill),
    );
    expect(migration.indexOf(legacyOrderBackfill)).toBeLessThan(
      migration.indexOf(missingEvidenceFallback),
    );
    expect(migration.indexOf(missingEvidenceFallback)).toBeLessThan(
      migration.indexOf(defaultAndNotNull),
    );
  });
});
