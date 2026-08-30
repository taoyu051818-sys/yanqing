CREATE TYPE "LeadStatus" AS ENUM (
  'NEW',
  'CONTACTING',
  'TRIAL_RESERVED',
  'ATTENDED',
  'CONVERTED',
  'LOST',
  'ARCHIVED'
);

CREATE TABLE "CustomerLead" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "phone" TEXT,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "sourceChannel" "SourceChannel" NOT NULL,
  "campaign" TEXT,
  "referrerId" TEXT,
  "ownerId" TEXT,
  "convertedMemberId" TEXT,
  "createdById" TEXT NOT NULL,
  "nextFollowUpAt" TIMESTAMP(3),
  "slaDueAt" TIMESTAMP(3) NOT NULL,
  "convertedAt" TIMESTAMP(3),
  "lostAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "lostReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadFollowUp" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "statusBefore" "LeadStatus" NOT NULL,
  "statusAfter" "LeadStatus" NOT NULL,
  "nextFollowUpAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerLead_status_slaDueAt_idx" ON "CustomerLead"("status", "slaDueAt");
CREATE INDEX "CustomerLead_ownerId_status_nextFollowUpAt_idx" ON "CustomerLead"("ownerId", "status", "nextFollowUpAt");
CREATE INDEX "CustomerLead_sourceChannel_campaign_createdAt_idx" ON "CustomerLead"("sourceChannel", "campaign", "createdAt");
CREATE INDEX "CustomerLead_convertedMemberId_idx" ON "CustomerLead"("convertedMemberId");
CREATE INDEX "CustomerLead_phone_idx" ON "CustomerLead"("phone");
CREATE UNIQUE INDEX "CustomerLead_active_phone_key" ON "CustomerLead"("phone")
  WHERE "phone" IS NOT NULL AND "status" NOT IN ('CONVERTED', 'LOST', 'ARCHIVED');
CREATE INDEX "LeadFollowUp_leadId_createdAt_idx" ON "LeadFollowUp"("leadId", "createdAt");
CREATE INDEX "LeadFollowUp_actorId_createdAt_idx" ON "LeadFollowUp"("actorId", "createdAt");

ALTER TABLE "CustomerLead" ADD CONSTRAINT "CustomerLead_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerLead" ADD CONSTRAINT "CustomerLead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerLead" ADD CONSTRAINT "CustomerLead_convertedMemberId_fkey" FOREIGN KEY ("convertedMemberId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerLead" ADD CONSTRAINT "CustomerLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CustomerLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerLead" ADD CONSTRAINT "CustomerLead_terminal_state_check" CHECK (
  ("status" = 'CONVERTED' AND "convertedMemberId" IS NOT NULL AND "convertedAt" IS NOT NULL AND "lostReason" IS NULL)
  OR ("status" = 'LOST' AND "lostAt" IS NOT NULL AND "lostReason" IS NOT NULL AND "convertedMemberId" IS NULL)
  OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL)
  OR ("status" NOT IN ('CONVERTED', 'LOST', 'ARCHIVED') AND "convertedMemberId" IS NULL AND "lostReason" IS NULL)
);
