CREATE TYPE "EventPrizeStatus" AS ENUM ('ISSUED', 'RECEIVED');

CREATE TABLE "EventPrizeAward" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "awardName" TEXT NOT NULL,
    "finalRank" INTEGER NOT NULL,
    "recipientNames" TEXT[] NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "EventPrizeStatus" NOT NULL DEFAULT 'ISSUED',
    "operatorId" TEXT NOT NULL,
    "inventoryTransactionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "prizePoolSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedByName" TEXT,
    "signedById" TEXT,
    "receiptNote" TEXT,
    "receiptIdempotencyKey" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventPrizeAward_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventPrizeAward_quantity_positive_check" CHECK ("quantity" > 0),
    CONSTRAINT "EventPrizeAward_final_rank_positive_check" CHECK ("finalRank" > 0),
    CONSTRAINT "EventPrizeAward_recipient_names_check" CHECK (cardinality("recipientNames") > 0),
    CONSTRAINT "EventPrizeAward_receipt_complete_check" CHECK (
      "status" <> 'RECEIVED' OR (
        "receivedByName" IS NOT NULL AND
        "signedById" IS NOT NULL AND
        "receiptIdempotencyKey" IS NOT NULL AND
        "receivedAt" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "EventPrizeAward_inventoryTransactionId_key" ON "EventPrizeAward"("inventoryTransactionId");
CREATE UNIQUE INDEX "EventPrizeAward_idempotencyKey_key" ON "EventPrizeAward"("idempotencyKey");
CREATE UNIQUE INDEX "EventPrizeAward_receiptIdempotencyKey_key" ON "EventPrizeAward"("receiptIdempotencyKey");
CREATE UNIQUE INDEX "EventPrizeAward_eventId_teamId_awardName_inventoryItemId_key" ON "EventPrizeAward"("eventId", "teamId", "awardName", "inventoryItemId");
CREATE INDEX "EventPrizeAward_eventId_status_issuedAt_idx" ON "EventPrizeAward"("eventId", "status", "issuedAt");
CREATE INDEX "EventPrizeAward_teamId_idx" ON "EventPrizeAward"("teamId");
CREATE INDEX "EventPrizeAward_inventoryItemId_issuedAt_idx" ON "EventPrizeAward"("inventoryItemId", "issuedAt");

ALTER TABLE "EventPrizeAward" ADD CONSTRAINT "EventPrizeAward_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventPrizeAward" ADD CONSTRAINT "EventPrizeAward_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "EventTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventPrizeAward" ADD CONSTRAINT "EventPrizeAward_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventPrizeAward" ADD CONSTRAINT "EventPrizeAward_inventoryTransactionId_fkey"
  FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventPrizeAward" ADD CONSTRAINT "EventPrizeAward_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventPrizeAward" ADD CONSTRAINT "EventPrizeAward_signedById_fkey"
  FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
