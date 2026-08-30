CREATE TYPE "DataErasureRequestStatus" AS ENUM ('REQUESTED', 'CANCELLED', 'REJECTED', 'COMPLETED');

CREATE TABLE "DataErasureRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DataErasureRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestIdempotencyKey" TEXT NOT NULL,
    "requestCommandHash" TEXT NOT NULL,
    "decisionIdempotencyKey" TEXT,
    "decisionCommandHash" TEXT,
    "reviewedById" TEXT,
    "reviewReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataErasureRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_erasure_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 2 AND 300),
    CONSTRAINT "data_erasure_request_key_check" CHECK (char_length("requestIdempotencyKey") BETWEEN 8 AND 100),
    CONSTRAINT "data_erasure_request_hash_check" CHECK ("requestCommandHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "data_erasure_decision_pair_check" CHECK (("decisionIdempotencyKey" IS NULL) = ("decisionCommandHash" IS NULL)),
    CONSTRAINT "data_erasure_decision_key_check" CHECK ("decisionIdempotencyKey" IS NULL OR char_length("decisionIdempotencyKey") BETWEEN 8 AND 100),
    CONSTRAINT "data_erasure_decision_hash_check" CHECK ("decisionCommandHash" IS NULL OR "decisionCommandHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "data_erasure_decision_state_check" CHECK (
      (
        "status" = 'REQUESTED'
        AND "decisionIdempotencyKey" IS NULL
        AND "decisionCommandHash" IS NULL
        AND "reviewedById" IS NULL
        AND "reviewReason" IS NULL
        AND "reviewedAt" IS NULL
        AND "completedAt" IS NULL
      )
      OR
      (
        "status" <> 'REQUESTED'
        AND "decisionIdempotencyKey" IS NOT NULL
        AND "decisionCommandHash" IS NOT NULL
        AND "reviewedById" IS NOT NULL
        AND "reviewReason" IS NOT NULL
        AND char_length(btrim("reviewReason")) BETWEEN 2 AND 300
        AND "reviewedAt" IS NOT NULL
        AND (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
      )
    )
);

CREATE UNIQUE INDEX "DataErasureRequest_requestIdempotencyKey_key" ON "DataErasureRequest"("requestIdempotencyKey");
CREATE UNIQUE INDEX "DataErasureRequest_decisionIdempotencyKey_key" ON "DataErasureRequest"("decisionIdempotencyKey");
CREATE UNIQUE INDEX "data_erasure_one_open_per_user" ON "DataErasureRequest"("userId") WHERE "status" = 'REQUESTED';
CREATE INDEX "DataErasureRequest_status_requestedAt_idx" ON "DataErasureRequest"("status", "requestedAt");
CREATE INDEX "DataErasureRequest_userId_requestedAt_idx" ON "DataErasureRequest"("userId", "requestedAt");
CREATE INDEX "DataErasureRequest_reviewedById_reviewedAt_idx" ON "DataErasureRequest"("reviewedById", "reviewedAt");

ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataErasureRequest" ADD CONSTRAINT "DataErasureRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
