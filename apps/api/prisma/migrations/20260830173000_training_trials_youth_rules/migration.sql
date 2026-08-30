CREATE TYPE "TrainingTrialStatus" AS ENUM (
  'RESERVED',
  'CHECKED_IN',
  'NO_SHOW',
  'ASSESSED',
  'CONVERTED',
  'LOST',
  'CANCELLED'
);

CREATE TYPE "YouthTrainingRuleStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'REJECTED',
  'SUPERSEDED'
);

CREATE TABLE "TrainingTrial" (
  "id" TEXT NOT NULL,
  "trialNo" TEXT NOT NULL,
  "status" "TrainingTrialStatus" NOT NULL DEFAULT 'RESERVED',
  "leadId" TEXT,
  "studentId" TEXT,
  "guardianId" TEXT,
  "memberId" TEXT,
  "productId" TEXT NOT NULL,
  "classId" TEXT,
  "sessionId" TEXT,
  "coachId" TEXT NOT NULL,
  "sourceChannel" "SourceChannel" NOT NULL,
  "scheduledStartsAt" TIMESTAMP(3) NOT NULL,
  "scheduledEndsAt" TIMESTAMP(3) NOT NULL,
  "assessmentDimensions" JSONB,
  "recommendation" TEXT,
  "assessmentNote" TEXT,
  "convertedEnrollmentId" TEXT,
  "createdById" TEXT NOT NULL,
  "creationIdempotencyKey" TEXT NOT NULL,
  "creationCommandHash" TEXT NOT NULL,
  "checkedInAt" TIMESTAMP(3),
  "noShowAt" TIMESTAMP(3),
  "assessedAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "lostAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingTrial_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingTrial_schedule_check" CHECK ("scheduledEndsAt" > "scheduledStartsAt"),
  CONSTRAINT "TrainingTrial_creation_key_check" CHECK (
    length("creationIdempotencyKey") BETWEEN 8 AND 100 AND
    "creationIdempotencyKey" = btrim("creationIdempotencyKey")
  ),
  CONSTRAINT "TrainingTrial_creation_hash_check" CHECK (
    "creationCommandHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "TrainingTrial_participant_check" CHECK (
    "leadId" IS NOT NULL OR "studentId" IS NOT NULL OR "memberId" IS NOT NULL
  ),
  CONSTRAINT "TrainingTrial_student_guardian_check" CHECK (
    "studentId" IS NULL OR "guardianId" IS NOT NULL
  ),
  CONSTRAINT "TrainingTrial_status_evidence_check" CHECK (
    ("status" = 'RESERVED' AND "checkedInAt" IS NULL AND "noShowAt" IS NULL AND "assessedAt" IS NULL AND "convertedAt" IS NULL AND "lostAt" IS NULL AND "cancelledAt" IS NULL AND "convertedEnrollmentId" IS NULL)
    OR ("status" = 'NO_SHOW' AND "checkedInAt" IS NULL AND "noShowAt" IS NOT NULL AND "assessedAt" IS NULL AND "convertedAt" IS NULL AND "lostAt" IS NULL AND "cancelledAt" IS NULL AND "convertedEnrollmentId" IS NULL)
    OR ("status" = 'CHECKED_IN' AND "checkedInAt" IS NOT NULL AND "noShowAt" IS NULL AND "assessedAt" IS NULL AND "convertedAt" IS NULL AND "lostAt" IS NULL AND "cancelledAt" IS NULL AND "convertedEnrollmentId" IS NULL)
    OR ("status" = 'ASSESSED' AND "checkedInAt" IS NOT NULL AND "noShowAt" IS NULL AND "assessedAt" IS NOT NULL AND "convertedAt" IS NULL AND "lostAt" IS NULL AND "cancelledAt" IS NULL AND "convertedEnrollmentId" IS NULL)
    OR ("status" = 'CONVERTED' AND "checkedInAt" IS NOT NULL AND "noShowAt" IS NULL AND "assessedAt" IS NOT NULL AND "convertedAt" IS NOT NULL AND "lostAt" IS NULL AND "cancelledAt" IS NULL AND "convertedEnrollmentId" IS NOT NULL)
    OR ("status" = 'LOST' AND "lostAt" IS NOT NULL AND "convertedAt" IS NULL AND "cancelledAt" IS NULL AND "convertedEnrollmentId" IS NULL AND (("noShowAt" IS NOT NULL AND "checkedInAt" IS NULL AND "assessedAt" IS NULL) OR ("noShowAt" IS NULL AND "checkedInAt" IS NOT NULL AND "assessedAt" IS NOT NULL)))
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "convertedAt" IS NULL AND "lostAt" IS NULL AND "convertedEnrollmentId" IS NULL AND (("noShowAt" IS NULL AND "checkedInAt" IS NULL AND "assessedAt" IS NULL) OR ("noShowAt" IS NOT NULL AND "checkedInAt" IS NULL AND "assessedAt" IS NULL)))
  ),
  CONSTRAINT "TrainingTrial_assessment_check" CHECK (
    "status" NOT IN ('ASSESSED', 'CONVERTED') OR (
      jsonb_typeof("assessmentDimensions") = 'array' AND
      jsonb_array_length("assessmentDimensions") > 0 AND
      length(btrim("recommendation")) BETWEEN 2 AND 500
    )
  )
);

CREATE TABLE "TrainingTrialTransition" (
  "id" TEXT NOT NULL,
  "trialId" TEXT NOT NULL,
  "fromStatus" "TrainingTrialStatus",
  "toStatus" "TrainingTrialStatus" NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "payload" JSONB,
  "commandHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingTrialTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingTrialTransition_action_check" CHECK (
    length(btrim("action")) BETWEEN 2 AND 40
  ),
  CONSTRAINT "TrainingTrialTransition_reason_check" CHECK (
    length(btrim("reason")) BETWEEN 2 AND 300
  ),
  CONSTRAINT "TrainingTrialTransition_key_check" CHECK (
    length("idempotencyKey") BETWEEN 8 AND 100 AND
    "idempotencyKey" = btrim("idempotencyKey")
  ),
  CONSTRAINT "TrainingTrialTransition_hash_check" CHECK (
    "commandHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "YouthTrainingRule" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "YouthTrainingRuleStatus" NOT NULL DEFAULT 'DRAFT',
  "maxTotalSessions" INTEGER NOT NULL,
  "maxValidityDays" INTEGER NOT NULL,
  "maxContractAmountCents" INTEGER NOT NULL,
  "warningThresholdDays" INTEGER NOT NULL,
  "hardBlock" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "requestReason" TEXT NOT NULL,
  "reviewReason" TEXT,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "requestIdempotencyKey" TEXT NOT NULL,
  "decisionIdempotencyKey" TEXT,
  "commandHash" TEXT NOT NULL,
  "decisionCommandHash" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YouthTrainingRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "YouthTrainingRule_values_check" CHECK (
    "maxTotalSessions" > 0 AND
    "maxValidityDays" > 0 AND
    "maxContractAmountCents" > 0 AND
    "warningThresholdDays" >= 0 AND
    "warningThresholdDays" <= "maxValidityDays"
  ),
  CONSTRAINT "YouthTrainingRule_period_check" CHECK (
    "effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"
  ),
  CONSTRAINT "YouthTrainingRule_review_check" CHECK (
    ("status" = 'DRAFT' AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "decisionIdempotencyKey" IS NULL AND "decisionCommandHash" IS NULL AND "reviewReason" IS NULL)
    OR
    ("status" <> 'DRAFT' AND "reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "decisionIdempotencyKey" IS NOT NULL AND "decisionCommandHash" IS NOT NULL AND length(btrim("reviewReason")) BETWEEN 2 AND 300)
  ),
  CONSTRAINT "YouthTrainingRule_maker_checker_check" CHECK (
    "reviewedById" IS NULL OR "reviewedById" <> "requestedById"
  ),
  CONSTRAINT "YouthTrainingRule_request_reason_check" CHECK (
    length(btrim("requestReason")) BETWEEN 2 AND 300
  ),
  CONSTRAINT "YouthTrainingRule_request_key_check" CHECK (
    length("requestIdempotencyKey") BETWEEN 8 AND 100 AND
    "requestIdempotencyKey" = btrim("requestIdempotencyKey")
  ),
  CONSTRAINT "YouthTrainingRule_decision_key_check" CHECK (
    "decisionIdempotencyKey" IS NULL OR (
      length("decisionIdempotencyKey") BETWEEN 8 AND 100 AND
      "decisionIdempotencyKey" = btrim("decisionIdempotencyKey")
    )
  ),
  CONSTRAINT "YouthTrainingRule_hash_check" CHECK (
    "commandHash" ~ '^[0-9a-f]{64}$' AND
    ("decisionCommandHash" IS NULL OR "decisionCommandHash" ~ '^[0-9a-f]{64}$')
  )
);

CREATE UNIQUE INDEX "TrainingTrial_trialNo_key" ON "TrainingTrial"("trialNo");
CREATE UNIQUE INDEX "TrainingTrial_creationIdempotencyKey_key" ON "TrainingTrial"("creationIdempotencyKey");
CREATE UNIQUE INDEX "TrainingTrial_convertedEnrollmentId_key" ON "TrainingTrial"("convertedEnrollmentId");
CREATE INDEX "TrainingTrial_status_scheduledStartsAt_idx" ON "TrainingTrial"("status", "scheduledStartsAt");
CREATE INDEX "TrainingTrial_coachId_status_scheduledStartsAt_idx" ON "TrainingTrial"("coachId", "status", "scheduledStartsAt");
CREATE INDEX "TrainingTrial_guardianId_scheduledStartsAt_idx" ON "TrainingTrial"("guardianId", "scheduledStartsAt");
CREATE INDEX "TrainingTrial_memberId_scheduledStartsAt_idx" ON "TrainingTrial"("memberId", "scheduledStartsAt");
CREATE INDEX "TrainingTrial_leadId_idx" ON "TrainingTrial"("leadId");
CREATE INDEX "TrainingTrial_studentId_idx" ON "TrainingTrial"("studentId");
CREATE INDEX "TrainingTrial_productId_classId_idx" ON "TrainingTrial"("productId", "classId");

CREATE UNIQUE INDEX "TrainingTrialTransition_idempotencyKey_key" ON "TrainingTrialTransition"("idempotencyKey");
CREATE INDEX "TrainingTrialTransition_trialId_createdAt_idx" ON "TrainingTrialTransition"("trialId", "createdAt");
CREATE INDEX "TrainingTrialTransition_actorId_createdAt_idx" ON "TrainingTrialTransition"("actorId", "createdAt");
CREATE INDEX "TrainingTrialTransition_toStatus_createdAt_idx" ON "TrainingTrialTransition"("toStatus", "createdAt");

CREATE UNIQUE INDEX "YouthTrainingRule_version_key" ON "YouthTrainingRule"("version");
CREATE UNIQUE INDEX "YouthTrainingRule_requestIdempotencyKey_key" ON "YouthTrainingRule"("requestIdempotencyKey");
CREATE UNIQUE INDEX "YouthTrainingRule_decisionIdempotencyKey_key" ON "YouthTrainingRule"("decisionIdempotencyKey");
CREATE INDEX "YouthTrainingRule_status_effectiveFrom_effectiveTo_idx" ON "YouthTrainingRule"("status", "effectiveFrom", "effectiveTo");
CREATE INDEX "YouthTrainingRule_requestedById_createdAt_idx" ON "YouthTrainingRule"("requestedById", "createdAt");

ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "CustomerLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_guardianId_fkey"
  FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "TrainingProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "TrainingClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_coachId_fkey"
  FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_convertedEnrollmentId_fkey"
  FOREIGN KEY ("convertedEnrollmentId") REFERENCES "TrainingEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrial" ADD CONSTRAINT "TrainingTrial_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrialTransition" ADD CONSTRAINT "TrainingTrialTransition_trialId_fkey"
  FOREIGN KEY ("trialId") REFERENCES "TrainingTrial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingTrialTransition" ADD CONSTRAINT "TrainingTrialTransition_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "YouthTrainingRule" ADD CONSTRAINT "YouthTrainingRule_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "YouthTrainingRule" ADD CONSTRAINT "YouthTrainingRule_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
