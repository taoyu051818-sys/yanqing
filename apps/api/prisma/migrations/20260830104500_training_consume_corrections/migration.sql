CREATE TYPE "TrainingRecognitionType" AS ENUM ('CONSUME', 'REVERSAL');
CREATE TYPE "TrainingConsumeCorrectionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

DROP INDEX "TrainingRevenueRecognition_attendanceId_key";

ALTER TABLE "TrainingRevenueRecognition"
  ADD COLUMN "type" "TrainingRecognitionType" NOT NULL DEFAULT 'CONSUME',
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reversalOfId" TEXT;

ALTER TABLE "TrainingRevenueRecognition" DROP CONSTRAINT "TrainingRecognition_contract_invariants";
ALTER TABLE "TrainingRevenueRecognition" ADD CONSTRAINT "TrainingRecognition_contract_invariants" CHECK (
  "contractRateBps" = 2000 AND "venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0 AND
  "venueContributionCents" = ROUND("effectiveRevenueCents" * 2000 / 10000.0)
);
ALTER TABLE "TrainingSettlement" DROP CONSTRAINT "TrainingSettlement_contract_invariants";
ALTER TABLE "TrainingSettlement" ADD CONSTRAINT "TrainingSettlement_contract_invariants" CHECK (
  "contractRateBps" = 2000 AND "venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0 AND
  "venueContributionCents" = ROUND("effectiveRevenueCents" * 2000 / 10000.0)
);

ALTER TABLE "TrainingRevenueRecognition"
  ADD CONSTRAINT "training_recognition_sequence_positive" CHECK ("sequence" > 0),
  ADD CONSTRAINT "training_recognition_signed_values" CHECK (
    ("type" = 'CONSUME' AND "effectiveRevenueCents" >= 0 AND "venueContributionCents" >= 0 AND "reversalOfId" IS NULL)
    OR
    ("type" = 'REVERSAL' AND "effectiveRevenueCents" <= 0 AND "venueContributionCents" <= 0 AND "reversalOfId" IS NOT NULL)
  ),
  ADD CONSTRAINT "training_recognition_no_venue_fee" CHECK ("venueFeeCents" = 0 AND "trainingPayableVenueCents" = 0);

CREATE UNIQUE INDEX "training_recognition_attendance_sequence_key"
  ON "TrainingRevenueRecognition"("attendanceId", "sequence");
CREATE UNIQUE INDEX "TrainingRevenueRecognition_reversalOfId_key"
  ON "TrainingRevenueRecognition"("reversalOfId");
CREATE INDEX "TrainingRevenueRecognition_type_createdAt_idx"
  ON "TrainingRevenueRecognition"("type", "createdAt");

ALTER TABLE "TrainingRevenueRecognition"
  ADD CONSTRAINT "TrainingRevenueRecognition_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "TrainingRevenueRecognition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TrainingConsumeCorrection" (
  "id" TEXT NOT NULL,
  "recognitionId" TEXT NOT NULL,
  "attendanceId" TEXT NOT NULL,
  "status" "TrainingConsumeCorrectionStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT NOT NULL,
  "reviewReason" TEXT,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reversalRecognitionId" TEXT,
  "requestIdempotencyKey" TEXT NOT NULL,
  "decisionIdempotencyKey" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingConsumeCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "training_correction_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 2 AND 300),
  CONSTRAINT "training_correction_review_reason_check" CHECK ("reviewReason" IS NULL OR char_length(btrim("reviewReason")) BETWEEN 2 AND 300),
  CONSTRAINT "training_correction_request_key_check" CHECK (char_length("requestIdempotencyKey") BETWEEN 8 AND 100 AND btrim("requestIdempotencyKey") = "requestIdempotencyKey"),
  CONSTRAINT "training_correction_decision_key_check" CHECK ("decisionIdempotencyKey" IS NULL OR (char_length("decisionIdempotencyKey") BETWEEN 8 AND 100 AND btrim("decisionIdempotencyKey") = "decisionIdempotencyKey")),
  CONSTRAINT "training_correction_status_fields_check" CHECK (
    ("status" = 'REQUESTED' AND "reviewReason" IS NULL AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "reversalRecognitionId" IS NULL AND "decisionIdempotencyKey" IS NULL)
    OR
    ("status" = 'APPROVED' AND "reviewReason" IS NOT NULL AND "reviewedById" IS NOT NULL AND "reviewedById" <> "requestedById" AND "reviewedAt" IS NOT NULL AND "reversalRecognitionId" IS NOT NULL AND "decisionIdempotencyKey" IS NOT NULL)
    OR
    ("status" = 'REJECTED' AND "reviewReason" IS NOT NULL AND "reviewedById" IS NOT NULL AND "reviewedById" <> "requestedById" AND "reviewedAt" IS NOT NULL AND "reversalRecognitionId" IS NULL AND "decisionIdempotencyKey" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "TrainingConsumeCorrection_reversalRecognitionId_key" ON "TrainingConsumeCorrection"("reversalRecognitionId");
CREATE UNIQUE INDEX "TrainingConsumeCorrection_requestIdempotencyKey_key" ON "TrainingConsumeCorrection"("requestIdempotencyKey");
CREATE UNIQUE INDEX "TrainingConsumeCorrection_decisionIdempotencyKey_key" ON "TrainingConsumeCorrection"("decisionIdempotencyKey");
CREATE INDEX "TrainingConsumeCorrection_status_requestedAt_idx" ON "TrainingConsumeCorrection"("status", "requestedAt");
CREATE INDEX "TrainingConsumeCorrection_recognitionId_status_idx" ON "TrainingConsumeCorrection"("recognitionId", "status");
CREATE INDEX "TrainingConsumeCorrection_attendanceId_status_idx" ON "TrainingConsumeCorrection"("attendanceId", "status");
CREATE UNIQUE INDEX "training_correction_one_active_per_recognition"
  ON "TrainingConsumeCorrection"("recognitionId")
  WHERE "status" IN ('REQUESTED', 'APPROVED');

ALTER TABLE "TrainingConsumeCorrection" ADD CONSTRAINT "TrainingConsumeCorrection_recognitionId_fkey" FOREIGN KEY ("recognitionId") REFERENCES "TrainingRevenueRecognition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingConsumeCorrection" ADD CONSTRAINT "TrainingConsumeCorrection_reversalRecognitionId_fkey" FOREIGN KEY ("reversalRecognitionId") REFERENCES "TrainingRevenueRecognition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingConsumeCorrection" ADD CONSTRAINT "TrainingConsumeCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "TrainingAttendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingConsumeCorrection" ADD CONSTRAINT "TrainingConsumeCorrection_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingConsumeCorrection" ADD CONSTRAINT "TrainingConsumeCorrection_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
