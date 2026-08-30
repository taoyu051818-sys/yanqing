ALTER TABLE "EventTeam"
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "cancelIdempotencyKey" TEXT,
  ADD COLUMN "cancelCommandHash" TEXT,
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cancellationPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancellationResolvedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EventTeam_cancelIdempotencyKey_key"
  ON "EventTeam"("cancelIdempotencyKey");
CREATE INDEX "EventTeam_cancelledById_cancelRequestedAt_idx"
  ON "EventTeam"("cancelledById", "cancelRequestedAt");

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_cancel_command_evidence_check"
  CHECK (
    (
      "cancelIdempotencyKey" IS NULL AND
      "cancelCommandHash" IS NULL AND
      "cancelReason" IS NULL AND
      "cancelledById" IS NULL AND
      "cancelRequestedAt" IS NULL AND
      "cancellationPending" = false AND
      "cancellationResolvedAt" IS NULL
    ) OR
    (
      char_length("cancelIdempotencyKey") BETWEEN 8 AND 100 AND
      "cancelCommandHash" ~ '^[0-9a-f]{64}$' AND
      char_length(btrim("cancelReason")) BETWEEN 2 AND 300 AND
      "cancelledById" IS NOT NULL AND
      "cancelRequestedAt" IS NOT NULL AND
      (
        (
          "cancellationPending" = true AND
          "status" = 'PAID' AND
          "cancellationResolvedAt" IS NULL AND
          "cancelledAt" IS NULL
        ) OR
        (
          "cancellationPending" = false AND
          "cancellationResolvedAt" IS NOT NULL AND
          "cancellationResolvedAt" >= "cancelRequestedAt"
        )
      )
    )
  );

ALTER TABLE "EventTeam"
  ADD CONSTRAINT "EventTeam_cancel_request_timestamp_check"
  CHECK (
    ("cancelRequestedAt" IS NULL OR "cancelRequestedAt" >= "createdAt") AND
    ("cancellationResolvedAt" IS NULL OR "cancellationResolvedAt" >= "createdAt")
  );
