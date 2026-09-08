BEGIN;
ALTER TABLE "CourtBooking" ADD COLUMN "operatorOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "CourtBooking" ADD CONSTRAINT "CourtBooking_operator_override_evidence" CHECK (
  (NOT "operatorOverride" AND "overrideReason" IS NULL) OR
  ("operatorOverride" AND "orderId" IS NOT NULL AND "usage" = 'RETAIL' AND "overrideReason" IS NOT NULL AND length(trim("overrideReason")) BETWEEN 2 AND 300)
);
DROP INDEX "CourtBooking_active_slot_key";
CREATE UNIQUE INDEX "CourtBooking_active_slot_key"
  ON "CourtBooking"("courtId", "startsAt", "endsAt")
  WHERE "status" <> 'CANCELLED' AND NOT "operatorOverride";

COMMIT;
