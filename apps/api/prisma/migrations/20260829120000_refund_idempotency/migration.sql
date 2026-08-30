-- Add a nullable request key so existing refund rows remain valid while new
-- requests can be deduplicated atomically by the database.
ALTER TABLE "Refund" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
