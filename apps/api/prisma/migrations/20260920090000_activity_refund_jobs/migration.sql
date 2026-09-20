CREATE TABLE "ActivityRefundJob" (
 "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "activityId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "actorRoles" "AppRole"[] NOT NULL, "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "lastError" TEXT, "completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ActivityRefundJob_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ActivityRefundJob_kind_check" CHECK ("kind" IN ('GAME', 'EVENT')),
 CONSTRAINT "ActivityRefundJob_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'COMPLETED'))
);
CREATE UNIQUE INDEX "ActivityRefundJob_kind_activityId_key" ON "ActivityRefundJob"("kind", "activityId");
CREATE INDEX "ActivityRefundJob_status_nextAttemptAt_idx" ON "ActivityRefundJob"("status", "nextAttemptAt");
