-- Participant contact snapshots are private business data, not login accounts.
BEGIN;
ALTER TABLE "EventTeam"
  ADD COLUMN "playerAPhone" TEXT,
  ADD COLUMN "playerBPhone" TEXT,
  ADD COLUMN "captainPlays" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "registrationMode" TEXT NOT NULL DEFAULT 'INVITE';
ALTER TABLE "EventPartnerInvite"
  ALTER COLUMN "partnerId" DROP NOT NULL,
  ADD COLUMN "captainId" TEXT,
  ADD COLUMN "teamName" TEXT,
  ADD COLUMN "category" "TeamCategory",
  ADD COLUMN "playerAName" TEXT,
  ADD COLUMN "playerAPhone" TEXT,
  ADD COLUMN "playerBName" TEXT,
  ADD COLUMN "playerBPhone" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD CONSTRAINT "EventPartnerInvite_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventPartnerInvite_issuer_check" CHECK ("partnerId" IS NOT NULL OR "captainId" IS NOT NULL);
CREATE INDEX "EventPartnerInvite_eventId_captainId_expiresAt_idx" ON "EventPartnerInvite"("eventId", "captainId", "expiresAt");
CREATE INDEX "EventTeam_eventId_playerAPhone_idx" ON "EventTeam"("eventId", "playerAPhone");
CREATE INDEX "EventTeam_eventId_playerBPhone_idx" ON "EventTeam"("eventId", "playerBPhone");
COMMIT;
