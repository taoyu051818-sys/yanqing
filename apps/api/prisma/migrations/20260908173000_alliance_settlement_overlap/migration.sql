-- A settled redemption must never be paid again through a different period.
-- Half-open ranges allow adjacent periods. Existing conflicting statements must
-- be reconciled explicitly; the migration never rewrites financial evidence.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "AllianceSettlement"
  ADD CONSTRAINT "AllianceSettlement_period_check"
    CHECK ("periodStart" < "periodEnd"),
  ADD CONSTRAINT "AllianceSettlement_no_active_overlap"
    EXCLUDE USING gist (
      "merchantId" WITH =,
      tsrange("periodStart", "periodEnd", '[)') WITH &&
    ) WHERE ("status" <> 'VOID');
