CREATE TYPE "CourtClosureStatus" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "CourtClosure" (
  "id" TEXT NOT NULL,
  "courtId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "CourtClosureStatus" NOT NULL DEFAULT 'ACTIVE',
  "creationIdempotencyKey" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "cancelledById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CourtClosure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourtClosure_time_range_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CourtClosure_reason_check" CHECK (
    char_length(btrim("reason")) BETWEEN 2 AND 300
    AND btrim("reason") = "reason"
  ),
  CONSTRAINT "CourtClosure_creation_key_check" CHECK (
    char_length("creationIdempotencyKey") BETWEEN 8 AND 100
    AND btrim("creationIdempotencyKey") = "creationIdempotencyKey"
  ),
  CONSTRAINT "CourtClosure_cancel_reason_check" CHECK (
    "cancelReason" IS NULL OR (
      char_length(btrim("cancelReason")) BETWEEN 2 AND 300
      AND btrim("cancelReason") = "cancelReason"
    )
  ),
  CONSTRAINT "CourtClosure_state_check" CHECK (
    (
      "status" = 'ACTIVE'
      AND "cancelledById" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelReason" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "cancelledById" IS NOT NULL
      AND "cancelledAt" IS NOT NULL
      AND "cancelReason" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "CourtClosure_creationIdempotencyKey_key"
  ON "CourtClosure"("creationIdempotencyKey");
CREATE INDEX "CourtClosure_courtId_status_startsAt_idx"
  ON "CourtClosure"("courtId", "status", "startsAt");
CREATE INDEX "CourtClosure_status_startsAt_endsAt_idx"
  ON "CourtClosure"("status", "startsAt", "endsAt");
CREATE INDEX "CourtClosure_createdById_createdAt_idx"
  ON "CourtClosure"("createdById", "createdAt");

ALTER TABLE "CourtClosure" ADD CONSTRAINT "CourtClosure_courtId_fkey"
  FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourtClosure" ADD CONSTRAINT "CourtClosure_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourtClosure" ADD CONSTRAINT "CourtClosure_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
