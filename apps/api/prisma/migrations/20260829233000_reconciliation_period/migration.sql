-- CreateEnum
CREATE TYPE "ReconciliationPeriodStatus" AS ENUM ('OPEN', 'REVIEW', 'LOCKED');

-- CreateTable
CREATE TABLE "ReconciliationPeriod" (
    "id" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "status" "ReconciliationPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "totals" JSONB NOT NULL,
    "exceptionCount" INTEGER NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationPeriod_businessDate_key" ON "ReconciliationPeriod"("businessDate");

-- CreateIndex
CREATE INDEX "ReconciliationPeriod_status_businessDate_idx" ON "ReconciliationPeriod"("status", "businessDate");

-- AddForeignKey
ALTER TABLE "ReconciliationPeriod" ADD CONSTRAINT "ReconciliationPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
