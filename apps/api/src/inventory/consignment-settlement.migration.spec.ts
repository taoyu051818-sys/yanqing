import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260830200000_consignment_settlements/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('consignment settlement migration invariants', () => {
  it('creates an immutable signed payable ledger with sale and refund provenance', () => {
    expect(migration).toContain(
      "CREATE TYPE \"ConsignmentPayableEntryType\" AS ENUM ('SALE', 'REFUND_REVERSAL')",
    );
    expect(migration).toContain(
      'CONSTRAINT "ConsignmentPayableEntry_amount_check"',
    );
    expect(migration).toContain(
      '"payableCents" = "grossSaleCents" - "commissionCents"',
    );
    expect(migration).toContain('"type" = \'REFUND_REVERSAL\' AND');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "consignment_payable_sale_order_item_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ConsignmentPayableEntry_reversalOfId_key"',
    );
  });

  it('enforces versioned statements, maker-checker evidence and the exact workflow', () => {
    expect(migration).toContain(
      'CONSTRAINT "ConsignmentSettlement_maker_checker_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "ConsignmentSettlement_state_check"',
    );
    expect(migration).toContain('"confirmedById" <> "createdById"');
    expect(migration).toContain(
      'consignment_settlement_supplier_period_version_key',
    );
    expect(migration).toContain(
      '("action" = \'DISPUTED\' AND "fromStatus" = \'PENDING_CONFIRMATION\' AND "toStatus" = \'DRAFT\')',
    );
    expect(migration).toContain(
      '("action" = \'RETURNED\' AND "fromStatus" = \'CONFIRMED\' AND "toStatus" = \'DRAFT\')',
    );
  });

  it('retains void history while allowing only one active statement claim per payable entry', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "consignment_settlement_line_active_entry_key"',
    );
    expect(migration).toContain(
      'ON "ConsignmentSettlementLine"("payableEntryId") WHERE "releasedAt" IS NULL',
    );
    expect(migration).toContain(
      'CONSTRAINT "ConsignmentSettlementLine_release_check"',
    );
  });
});
