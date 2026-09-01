CREATE TABLE "EventPartnerInvite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "consumedTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPartnerInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventPartnerInvite_tokenHash_key"
ON "EventPartnerInvite"("tokenHash");

CREATE UNIQUE INDEX "EventPartnerInvite_consumedTeamId_key"
ON "EventPartnerInvite"("consumedTeamId");

CREATE INDEX "EventPartnerInvite_eventId_partnerId_expiresAt_idx"
ON "EventPartnerInvite"("eventId", "partnerId", "expiresAt");

CREATE INDEX "EventPartnerInvite_expiresAt_revokedAt_consumedAt_idx"
ON "EventPartnerInvite"("expiresAt", "revokedAt", "consumedAt");

ALTER TABLE "EventPartnerInvite"
ADD CONSTRAINT "EventPartnerInvite_eventId_fkey"
FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventPartnerInvite"
ADD CONSTRAINT "EventPartnerInvite_partnerId_fkey"
FOREIGN KEY ("partnerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventPartnerInvite"
ADD CONSTRAINT "EventPartnerInvite_consumedTeamId_fkey"
FOREIGN KEY ("consumedTeamId") REFERENCES "EventTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
