CREATE TYPE "FrontDeskShiftStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "FrontDeskShift" (
    "id" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "venueCode" TEXT NOT NULL DEFAULT 'MAIN',
    "operatorId" TEXT NOT NULL,
    "status" "FrontDeskShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCashCents" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closingCashCents" INTEGER,
    "expectedCashCents" INTEGER,
    "cashVarianceCents" INTEGER,
    "handoverNote" TEXT,
    "closeReason" TEXT,
    "pendingSnapshot" JSONB,
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrontDeskShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "front_desk_shift_opening_cash_nonnegative" CHECK ("openingCashCents" >= 0),
    CONSTRAINT "front_desk_shift_venue_code_valid" CHECK (length(btrim("venueCode")) BETWEEN 1 AND 30),
    CONSTRAINT "front_desk_shift_opened_by_operator" CHECK ("openedById" = "operatorId"),
    CONSTRAINT "front_desk_shift_close_amounts_nonnegative" CHECK (
      ("closingCashCents" IS NULL OR "closingCashCents" >= 0)
      AND ("expectedCashCents" IS NULL OR "expectedCashCents" >= 0)
    ),
    CONSTRAINT "front_desk_shift_close_text_valid" CHECK (
      ("handoverNote" IS NULL OR length(btrim("handoverNote")) BETWEEN 2 AND 1000)
      AND ("closeReason" IS NULL OR length(btrim("closeReason")) BETWEEN 2 AND 300)
    ),
    CONSTRAINT "front_desk_shift_state_consistency" CHECK (
      (
        "status" = 'OPEN'
        AND "closedAt" IS NULL
        AND "closingCashCents" IS NULL
        AND "expectedCashCents" IS NULL
        AND "cashVarianceCents" IS NULL
        AND "handoverNote" IS NULL
        AND "closeReason" IS NULL
        AND "pendingSnapshot" IS NULL
        AND "closedById" IS NULL
      )
      OR
      (
        "status" = 'CLOSED'
        AND "closedAt" IS NOT NULL
        AND "closedAt" >= "openedAt"
        AND "closingCashCents" IS NOT NULL
        AND "expectedCashCents" IS NOT NULL
        AND "cashVarianceCents" = "closingCashCents" - "expectedCashCents"
        AND "handoverNote" IS NOT NULL
        AND "pendingSnapshot" IS NOT NULL
        AND "closedById" IS NOT NULL
        AND ("closedById" = "operatorId" OR "closeReason" IS NOT NULL)
      )
    )
);

CREATE UNIQUE INDEX "front_desk_shift_business_operator_venue_key"
  ON "FrontDeskShift"("businessDate", "operatorId", "venueCode");
CREATE INDEX "FrontDeskShift_status_businessDate_idx"
  ON "FrontDeskShift"("status", "businessDate");
CREATE INDEX "FrontDeskShift_venueCode_businessDate_idx"
  ON "FrontDeskShift"("venueCode", "businessDate");
CREATE INDEX "FrontDeskShift_operatorId_openedAt_idx"
  ON "FrontDeskShift"("operatorId", "openedAt");

ALTER TABLE "FrontDeskShift"
  ADD CONSTRAINT "FrontDeskShift_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrontDeskShift"
  ADD CONSTRAINT "FrontDeskShift_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrontDeskShift"
  ADD CONSTRAINT "FrontDeskShift_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
