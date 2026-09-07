ALTER TABLE "RiskEvent" ADD COLUMN "dedupKey" TEXT, ADD COLUMN "lastSeenAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "RiskEvent_dedupKey_key" ON "RiskEvent"("dedupKey");
CREATE TABLE "BossBriefing" (
  "date" TEXT NOT NULL PRIMARY KEY,
  "summaryHash" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "model" TEXT,
  "generatedAt" TIMESTAMP(3),
  "attemptedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);
