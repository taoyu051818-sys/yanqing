ALTER TABLE "Event"
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelPolicySnapshot" JSONB,
  ADD COLUMN "cancelIdempotencyKey" TEXT,
  ADD COLUMN "cancelCommandHash" TEXT,
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "EventTeam"
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT,
  ADD COLUMN "sourceChannel" "SourceChannel",
  ADD COLUMN "listAmountCents" INTEGER,
  ADD COLUMN "payableCents" INTEGER,
  -- Keep this nullable until the legacy order snapshot has been copied below.
  -- Adding the final DEFAULT here would materialize false for every old row and
  -- make COALESCE unable to distinguish legacy rows from an intentional value.
  ADD COLUMN "memberFeeApplied" BOOLEAN,
  ADD COLUMN "waitlistedAt" TIMESTAMP(3),
  ADD COLUMN "promotedAt" TIMESTAMP(3),
  ADD COLUMN "paymentDueAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Event_cancelIdempotencyKey_key"
  ON "Event"("cancelIdempotencyKey");
CREATE UNIQUE INDEX "EventTeam_creationIdempotencyKey_key"
  ON "EventTeam"("creationIdempotencyKey");
CREATE INDEX "EventTeam_eventId_status_createdAt_idx"
  ON "EventTeam"("eventId", "status", "createdAt");
CREATE INDEX "EventTeam_status_paymentDueAt_idx"
  ON "EventTeam"("status", "paymentDueAt");
CREATE INDEX "Event_cancelledById_cancelledAt_idx"
  ON "Event"("cancelledById", "cancelledAt");

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve pre-migration history while making every legacy cancellation
-- explicit. New cancellations always carry a real actor and idempotent
-- command; legacy rows are distinguishable in the immutable policy snapshot.
UPDATE "Event"
SET
  "cancelReason" = COALESCE("cancelReason", '历史取消记录（迁移前）'),
  "cancelPolicySnapshot" = COALESCE(
    "cancelPolicySnapshot",
    '{"version":0,"legacy":true,"approvalRequired":true}'::jsonb
  ),
  "cancelledAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'CANCELLED';

-- Existing active reservations predate paymentDueAt. Reconstruct their
-- immutable price/channel snapshot and a deterministic, already-expired when
-- appropriate, deadline from the original order/event timestamps.
UPDATE "EventTeam" AS team
SET
  "sourceChannel" = COALESCE(team."sourceChannel", orders."sourceChannel"),
  "listAmountCents" = COALESCE(team."listAmountCents", orders."listAmountCents"),
  "payableCents" = COALESCE(team."payableCents", orders."payableCents"),
  "memberFeeApplied" = COALESCE(
    team."memberFeeApplied",
    orders."discountCents" > 0
  )
FROM "Order" AS orders
WHERE team."orderId" = orders."id";

-- Rows without an order have no member-price evidence. Finish the backfill only
-- after linked legacy orders have derived their value from discountCents, then
-- restore the schema default expected by newly-created teams.
UPDATE "EventTeam"
SET "memberFeeApplied" = false
WHERE "memberFeeApplied" IS NULL;

ALTER TABLE "EventTeam"
  ALTER COLUMN "memberFeeApplied" SET DEFAULT false,
  ALTER COLUMN "memberFeeApplied" SET NOT NULL;

UPDATE "EventTeam" AS team
SET "paymentDueAt" = LEAST(
  event."registrationEndsAt",
  event."startsAt",
  team."createdAt" + INTERVAL '15 minutes'
)
FROM "Event" AS event
WHERE
  team."eventId" = event."id"
  AND team."status" = 'REGISTERED'
  AND team."orderId" IS NOT NULL
  AND team."paymentDueAt" IS NULL;

UPDATE "Order" AS orders
SET
  "status" = 'CANCELLED',
  "cancelledAt" = COALESCE(orders."cancelledAt", NOW())
FROM "EventTeam" AS team
WHERE
  team."orderId" = orders."id"
  AND team."status" = 'REGISTERED'
  AND team."paymentDueAt" <= team."createdAt"
  AND orders."status" = 'PENDING';

UPDATE "EventTeam"
SET
  "status" = 'CANCELLED',
  "paymentDueAt" = NULL,
  "cancelledAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'REGISTERED' AND "paymentDueAt" <= "createdAt";

UPDATE "EventTeam"
SET
  "status" = 'CANCELLED',
  "cancelledAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'REGISTERED' AND "orderId" IS NULL;

UPDATE "EventTeam"
SET
  "orderId" = NULL,
  "waitlistedAt" = COALESCE("waitlistedAt", "createdAt"),
  "paymentDueAt" = NULL
WHERE "status" = 'WAITLISTED';

UPDATE "EventTeam"
SET "paymentDueAt" = NULL
WHERE "status" IN ('PAID', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REFUNDED');

UPDATE "EventTeam"
SET "cancelledAt" = COALESCE("cancelledAt", "updatedAt")
WHERE "status" = 'CANCELLED';

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_cancel_command_pair_check"
  CHECK (("cancelIdempotencyKey" IS NULL) = ("cancelCommandHash" IS NULL));

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_cancel_key_shape_check"
  CHECK (
    "cancelIdempotencyKey" IS NULL OR
    char_length("cancelIdempotencyKey") BETWEEN 8 AND 100
  );

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_cancel_hash_shape_check"
  CHECK (
    "cancelCommandHash" IS NULL OR
    "cancelCommandHash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_cancel_terminal_consistency_check"
  CHECK (
    (
      "status" = 'CANCELLED' AND
      char_length(btrim("cancelReason")) >= 2 AND
      "cancelPolicySnapshot" IS NOT NULL AND
      "cancelledAt" IS NOT NULL AND
      (
        (
          "cancelledById" IS NOT NULL AND
          "cancelIdempotencyKey" IS NOT NULL AND
          "cancelCommandHash" IS NOT NULL
        ) OR
        (
          "cancelledById" IS NULL AND
          "cancelIdempotencyKey" IS NULL AND
          "cancelCommandHash" IS NULL AND
          "cancelPolicySnapshot"->>'legacy' = 'true'
        )
      )
    ) OR
    (
      "status" <> 'CANCELLED' AND
      "cancelReason" IS NULL AND
      "cancelPolicySnapshot" IS NULL AND
      "cancelIdempotencyKey" IS NULL AND
      "cancelCommandHash" IS NULL AND
      "cancelledById" IS NULL AND
      "cancelledAt" IS NULL
    )
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_creation_command_pair_check"
  CHECK (("creationIdempotencyKey" IS NULL) = ("creationCommandHash" IS NULL));

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_creation_key_shape_check"
  CHECK (
    "creationIdempotencyKey" IS NULL OR
    char_length("creationIdempotencyKey") BETWEEN 8 AND 100
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_creation_hash_shape_check"
  CHECK (
    "creationCommandHash" IS NULL OR
    "creationCommandHash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_price_snapshot_check"
  CHECK (
    ("listAmountCents" IS NULL AND "payableCents" IS NULL) OR
    (
      "listAmountCents" >= 0 AND
      "payableCents" >= 0 AND
      "listAmountCents" >= "payableCents"
    )
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_waitlist_has_no_order_check"
  CHECK (
    "status" <> 'WAITLISTED' OR
    (
      "orderId" IS NULL AND
      "waitlistedAt" IS NOT NULL AND
      "paymentDueAt" IS NULL
    )
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_registered_reservation_check"
  CHECK (
    "status" <> 'REGISTERED' OR
    ("orderId" IS NOT NULL AND "paymentDueAt" IS NOT NULL)
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_terminal_payment_due_check"
  CHECK (
    "status" NOT IN ('PAID', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'REFUNDED') OR
    "paymentDueAt" IS NULL
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_cancelled_at_check"
  CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL) OR
    ("status" <> 'CANCELLED')
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_lifecycle_timestamp_check"
  CHECK (
    ("waitlistedAt" IS NULL OR "waitlistedAt" >= "createdAt") AND
    ("promotedAt" IS NULL OR "waitlistedAt" IS NOT NULL) AND
    ("promotedAt" IS NULL OR "promotedAt" >= "waitlistedAt") AND
    ("paymentDueAt" IS NULL OR "paymentDueAt" > "createdAt") AND
    ("cancelledAt" IS NULL OR "cancelledAt" >= "createdAt")
  );
