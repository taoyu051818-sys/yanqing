CREATE TABLE "AvatarDeletionTask" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AvatarDeletionTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "avatar_deletion_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "avatar_deletion_generated_filename" CHECK (
    "filename" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
  )
);
CREATE UNIQUE INDEX "AvatarDeletionTask_filename_key" ON "AvatarDeletionTask"("filename");
CREATE INDEX "AvatarDeletionTask_completedAt_nextAttemptAt_idx" ON "AvatarDeletionTask"("completedAt", "nextAttemptAt");
-- Avatar lookup runs before every local avatar response. This also makes
-- legacy orphan files inaccessible without trying to guess their old owners.
CREATE INDEX "User_avatarUrl_idx" ON "User"("avatarUrl");
