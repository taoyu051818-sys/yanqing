CREATE TYPE "AccountAdjustmentStatus" AS ENUM ('REQUESTED', 'POSTED', 'REJECTED');

CREATE TABLE "AccountAdjustmentRequest" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "AccountAdjustmentStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "requestIdempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "reviewReason" TEXT,
  "transactionId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountAdjustmentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountAdjustmentRequest_amount_check" CHECK ("amount" <> 0),
  CONSTRAINT "AccountAdjustmentRequest_command_check" CHECK (
    char_length("requestIdempotencyKey") BETWEEN 8 AND 100
    AND "commandHash" ~ '^[0-9a-f]{64}$'
    AND char_length(btrim("reason")) BETWEEN 2 AND 200
  ),
  CONSTRAINT "AccountAdjustmentRequest_state_check" CHECK (
    ("status" = 'REQUESTED' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "reviewReason" IS NULL AND "transactionId" IS NULL)
    OR ("status" = 'POSTED' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NOT NULL AND "transactionId" IS NOT NULL)
    OR ("status" = 'REJECTED' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewReason" IS NOT NULL AND "transactionId" IS NULL)
  )
);

CREATE UNIQUE INDEX "AccountAdjustmentRequest_requestIdempotencyKey_key"
  ON "AccountAdjustmentRequest"("requestIdempotencyKey");
CREATE UNIQUE INDEX "AccountAdjustmentRequest_transactionId_key"
  ON "AccountAdjustmentRequest"("transactionId");
CREATE INDEX "AccountAdjustmentRequest_status_createdAt_idx"
  ON "AccountAdjustmentRequest"("status", "createdAt");
CREATE INDEX "AccountAdjustmentRequest_accountId_createdAt_idx"
  ON "AccountAdjustmentRequest"("accountId", "createdAt");
CREATE INDEX "AccountAdjustmentRequest_requestedById_createdAt_idx"
  ON "AccountAdjustmentRequest"("requestedById", "createdAt");

ALTER TABLE "AccountAdjustmentRequest" ADD CONSTRAINT "AccountAdjustmentRequest_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAdjustmentRequest" ADD CONSTRAINT "AccountAdjustmentRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAdjustmentRequest" ADD CONSTRAINT "AccountAdjustmentRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountAdjustmentRequest" ADD CONSTRAINT "AccountAdjustmentRequest_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "AccountTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
