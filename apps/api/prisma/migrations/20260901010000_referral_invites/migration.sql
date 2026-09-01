-- Public referral links carry a random opaque value.  Only its SHA-256 hash
-- is persisted so a database read cannot recover an active invitation.
CREATE TABLE "ReferralInvite" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReferralInvite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReferralInvite_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ReferralInvite_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "ReferralInvite_use_count_check" CHECK ("useCount" >= 0)
);

CREATE UNIQUE INDEX "ReferralInvite_tokenHash_key"
  ON "ReferralInvite"("tokenHash");

CREATE INDEX "ReferralInvite_inviterId_expiresAt_idx"
  ON "ReferralInvite"("inviterId", "expiresAt");

CREATE INDEX "ReferralInvite_expiresAt_revokedAt_idx"
  ON "ReferralInvite"("expiresAt", "revokedAt");

ALTER TABLE "ReferralInvite"
  ADD CONSTRAINT "ReferralInvite_inviterId_fkey"
  FOREIGN KEY ("inviterId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
