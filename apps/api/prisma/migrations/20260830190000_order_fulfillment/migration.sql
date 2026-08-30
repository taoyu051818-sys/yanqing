ALTER TYPE "BookingStatus" ADD VALUE 'NO_SHOW' AFTER 'CHECKED_IN';
ALTER TYPE "RegistrationStatus" ADD VALUE 'NO_SHOW' AFTER 'CHECKED_IN';

ALTER TABLE "CourtBooking"
  ADD COLUMN "fulfillmentIdempotencyKey" TEXT,
  ADD COLUMN "fulfillmentCommandHash" TEXT,
  ADD COLUMN "fulfillmentReason" TEXT,
  ADD COLUMN "fulfillmentEvidence" JSONB,
  ADD COLUMN "fulfilledById" TEXT,
  ADD COLUMN "fulfilledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CourtBooking_fulfillmentIdempotencyKey_key"
  ON "CourtBooking"("fulfillmentIdempotencyKey");
CREATE INDEX "CourtBooking_status_endsAt_idx"
  ON "CourtBooking"("status", "endsAt");
CREATE INDEX "CourtBooking_fulfilledById_fulfilledAt_idx"
  ON "CourtBooking"("fulfilledById", "fulfilledAt");

ALTER TABLE "CourtBooking"
  ADD CONSTRAINT "CourtBooking_fulfilledById_fkey"
  FOREIGN KEY ("fulfilledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve pre-existing terminal retail records without inventing a modern
-- operator or idempotency command. The legacy marker remains distinguishable
-- from all newly created fulfilment evidence.
UPDATE "CourtBooking"
SET
  "fulfillmentReason" = '历史履约记录',
  "fulfillmentEvidence" = jsonb_build_object('legacy', true),
  "fulfilledAt" = GREATEST("endsAt", "updatedAt")
WHERE
  "orderId" IS NOT NULL AND
  "status" = 'COMPLETED' AND
  "fulfilledAt" IS NULL;

ALTER TABLE "CourtBooking"
  ADD CONSTRAINT "CourtBooking_fulfillment_command_check"
  CHECK (
    (
      "orderId" IS NULL AND
      "fulfillmentIdempotencyKey" IS NULL AND
      "fulfillmentCommandHash" IS NULL AND
      "fulfillmentReason" IS NULL AND
      "fulfillmentEvidence" IS NULL AND
      "fulfilledById" IS NULL AND
      "fulfilledAt" IS NULL
    ) OR
    (
      "orderId" IS NOT NULL AND
      "status" NOT IN ('COMPLETED', 'NO_SHOW') AND
      "fulfillmentIdempotencyKey" IS NULL AND
      "fulfillmentCommandHash" IS NULL AND
      "fulfillmentReason" IS NULL AND
      "fulfillmentEvidence" IS NULL AND
      "fulfilledById" IS NULL AND
      "fulfilledAt" IS NULL
    ) OR
    (
      "orderId" IS NOT NULL AND
      "status" IN ('COMPLETED', 'NO_SHOW') AND
      "fulfilledAt" IS NOT NULL AND
      "fulfilledAt" >= "endsAt" AND
      (
        (
          "fulfillmentIdempotencyKey" IS NULL AND
          "fulfillmentCommandHash" IS NULL AND
          "fulfilledById" IS NULL AND
          "fulfillmentReason" IS NOT NULL AND
          "fulfillmentEvidence" IS NOT NULL AND
          "fulfillmentReason" = '历史履约记录' AND
          "fulfillmentEvidence"->>'legacy' = 'true'
        ) OR
        (
          "fulfillmentIdempotencyKey" IS NOT NULL AND
          "fulfillmentCommandHash" IS NOT NULL AND
          "fulfillmentReason" IS NOT NULL AND
          "fulfillmentEvidence" IS NOT NULL AND
          "fulfilledById" IS NOT NULL AND
          char_length("fulfillmentIdempotencyKey") BETWEEN 8 AND 100 AND
          "fulfillmentCommandHash" ~ '^[0-9a-f]{64}$' AND
          char_length(btrim("fulfillmentReason")) BETWEEN 2 AND 300 AND
          jsonb_typeof("fulfillmentEvidence") = 'object' AND
          "fulfillmentEvidence"->>'source' IN (
            'FRONT_DESK_ROLL_CALL',
            'ACCESS_CONTROL_LOG',
            'COURT_INSPECTION'
          ) AND
          char_length("fulfillmentEvidence"->>'observedAt') > 0
        )
      )
    )
  );

-- NO_SHOW is a terminal service outcome. Event registrations must release
-- their temporary payment deadline just like checked-in/completed records.
ALTER TABLE "EventTeam"
  DROP CONSTRAINT "EventTeam_terminal_payment_due_check";

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_terminal_payment_due_check"
  CHECK (
    "status" NOT IN ('PAID', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED', 'CANCELLED', 'REFUNDED') OR
    "paymentDueAt" IS NULL
  );
