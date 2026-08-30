import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260830202000_commercial_master_data/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('commercial master data migration invariants', () => {
  it('backfills existing membership products and price rules without replacing their ids', () => {
    expect(migration).toContain('UPDATE "MembershipProduct"');
    expect(migration).toContain(
      '"effectiveFrom" = LEAST("createdAt", CURRENT_TIMESTAMP)',
    );
    expect(migration).toContain('\'MIGRATION:MEMBERSHIP:\' || "id"');
    expect(migration).toContain('WITH normalized AS');
    expect(migration).toContain('), ranked AS (');
    expect(migration).toContain('row_number() OVER');
    expect(migration).toContain('\'MIGRATION:PRICE:\' || rule."id"');
    expect(migration).not.toContain('DELETE FROM "MembershipProduct"');
    expect(migration).not.toContain('DELETE FROM "PriceRule"');
  });

  it('keeps a fresh empty database valid before seed users exist', () => {
    const membershipEmptyGuard =
      'IF EXISTS (SELECT 1 FROM "MembershipProduct" WHERE "createdById" IS NULL)';
    const priceEmptyGuard =
      'IF EXISTS (SELECT 1 FROM "PriceRule" WHERE "createdById" IS NULL)';
    expect(migration).toContain(membershipEmptyGuard);
    expect(migration).toContain(priceEmptyGuard);
    expect(migration.indexOf(membershipEmptyGuard)).toBeLessThan(
      migration.indexOf(
        "RAISE EXCEPTION 'Cannot backfill MembershipProduct.createdById",
      ),
    );
    expect(migration.indexOf(priceEmptyGuard)).toBeLessThan(
      migration.indexOf(
        "RAISE EXCEPTION 'Cannot backfill PriceRule.createdById",
      ),
    );
  });

  it('enforces immutable versions, command evidence and valid commercial ranges', () => {
    expect(migration).toContain('"MembershipProduct_code_version_key"');
    expect(migration).toContain('"PriceRule_code_version_key"');
    expect(migration).toContain('"MembershipProduct_creation_evidence_check"');
    expect(migration).toContain('"PriceRule_creation_evidence_check"');
    expect(migration).toContain('"MembershipProduct_effective_range_check"');
    expect(migration).toContain('"PriceRule_effective_range_check"');
    expect(migration).toContain('"MembershipProductTransition_state_check"');
    expect(migration).toContain('"PriceRuleTransition_state_check"');
    expect(
      migration.match(/ALTER COLUMN "enabled" SET DEFAULT false/g),
    ).toHaveLength(2);
    expect(migration).toContain('ALTER COLUMN "updatedAt" DROP DEFAULT');
    expect(
      migration.match(/\^\[0-9a-f\]\{64\}\$/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('keeps invalid legacy price rules as disabled history without weakening new writes', () => {
    const deactivation = migration.slice(
      migration.indexOf('UPDATE "PriceRule"\nSET "enabled" = false'),
      migration.indexOf(
        'ALTER TABLE "PriceRule"\n  ALTER COLUMN "code" SET NOT NULL',
      ),
    );

    expect(deactivation).toContain('char_length("name") NOT BETWEEN 2 AND 80');
    expect(deactivation).toContain('"weekdayMask" NOT BETWEEN 1 AND 127');
    expect(deactivation).toContain('"priceCents" NOT BETWEEN 0 AND 10000000');
    expect(deactivation).toContain(
      '"newcomerPriceCents" NOT BETWEEN 0 AND "priceCents"',
    );
    expect(migration).not.toContain('DELETE FROM "PriceRule"');
    expect(migration).not.toContain('SET "priceCents" =');
    expect(migration).not.toContain('SET "newcomerPriceCents" =');
    expect(migration).not.toContain('SET "weekdayMask" =');

    expect(migration).toContain(
      'CONSTRAINT "PriceRule_name_check"\n    CHECK (char_length("name") BETWEEN 2 AND 80 AND "name" = btrim("name")) NOT VALID',
    );
    expect(migration).toContain('CONSTRAINT "PriceRule_price_check"');
    expect(migration).toContain(
      ') NOT VALID,\n  ADD CONSTRAINT "PriceRule_effective_range_check"',
    );
  });
});
