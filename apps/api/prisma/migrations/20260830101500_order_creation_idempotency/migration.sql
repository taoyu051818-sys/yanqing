ALTER TABLE "Order"
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT;

CREATE UNIQUE INDEX "Order_creationIdempotencyKey_key"
  ON "Order"("creationIdempotencyKey");

ALTER TABLE "Order" ADD CONSTRAINT "Order_creation_idempotency_pair_check" CHECK (
  ("creationIdempotencyKey" IS NULL AND "creationCommandHash" IS NULL)
  OR (
    "creationIdempotencyKey" IS NOT NULL
    AND "creationCommandHash" IS NOT NULL
    AND char_length("creationIdempotencyKey") BETWEEN 8 AND 100
    AND "creationCommandHash" ~ '^[0-9a-f]{64}$'
  )
);
