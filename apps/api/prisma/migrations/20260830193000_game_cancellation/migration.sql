ALTER TABLE "Game"
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelPolicySnapshot" JSONB,
  ADD COLUMN "cancelIdempotencyKey" TEXT,
  ADD COLUMN "cancelCommandHash" TEXT,
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Game_cancelIdempotencyKey_key"
  ON "Game"("cancelIdempotencyKey");
CREATE INDEX "Game_cancelledById_cancelledAt_idx"
  ON "Game"("cancelledById", "cancelledAt");

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve cancellations created before this workflow while keeping them
-- distinguishable from operator commands that carry actor/idempotency proof.
UPDATE "Game"
SET
  "cancelReason" = '历史取消记录（迁移前）',
  "cancelPolicySnapshot" =
    '{"version":0,"legacy":true,"approvalRequired":true}'::jsonb,
  "cancelledAt" = GREATEST("createdAt", "updatedAt")
WHERE "status" = 'CANCELLED';

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_cancel_command_pair_check"
  CHECK (("cancelIdempotencyKey" IS NULL) = ("cancelCommandHash" IS NULL));

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_cancel_key_shape_check"
  CHECK (
    "cancelIdempotencyKey" IS NULL OR
    char_length("cancelIdempotencyKey") BETWEEN 8 AND 100
  );

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_cancel_hash_shape_check"
  CHECK (
    "cancelCommandHash" IS NULL OR
    "cancelCommandHash" ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_cancel_terminal_consistency_check"
  CHECK (
    (
      "status" = 'CANCELLED' AND
      char_length(btrim("cancelReason")) BETWEEN 2 AND 300 AND
      "cancelPolicySnapshot" IS NOT NULL AND
      "cancelledAt" IS NOT NULL AND
      (
        (
          "cancelledById" IS NOT NULL AND
          "cancelIdempotencyKey" IS NOT NULL AND
          "cancelCommandHash" IS NOT NULL AND
          "cancelledAt" < "startsAt"
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

ALTER TABLE "Game"
  ADD CONSTRAINT "Game_cancel_timestamp_check"
  CHECK ("cancelledAt" IS NULL OR "cancelledAt" >= "createdAt");
