ALTER TABLE "GameRegistration"
  ADD COLUMN "waitlistVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "waitlistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "GameRegistration" SET "waitlistedAt" = "createdAt";

ALTER TABLE "GameRegistration" ADD CONSTRAINT "GameRegistration_waitlist_version_check"
  CHECK ("waitlistVersion" >= 0);
CREATE INDEX "GameRegistration_gameId_status_waitlistedAt_idx"
  ON "GameRegistration"("gameId", "status", "waitlistedAt");
