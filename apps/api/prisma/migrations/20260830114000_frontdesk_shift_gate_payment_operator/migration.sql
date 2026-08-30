ALTER TABLE "Payment" ADD COLUMN "operatorId" TEXT;

-- Historical payments predate explicit cashier attribution.  The order
-- creator is the strongest available evidence for assisted payments; member
-- self-service orders fall back to their payer identity.
UPDATE "Payment" AS payment
SET "operatorId" = COALESCE(orders."createdById", payment."userId")
FROM "Order" AS orders
WHERE orders."id" = payment."orderId";

ALTER TABLE "Payment" ALTER COLUMN "operatorId" SET NOT NULL;

CREATE INDEX "Payment_operatorId_channel_paidAt_idx"
  ON "Payment"("operatorId", "channel", "paidAt");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FrontDeskShift"
  ADD COLUMN "varianceReviewedById" TEXT,
  ADD COLUMN "varianceReviewedAt" TIMESTAMP(3),
  ADD COLUMN "varianceReviewReason" TEXT;

ALTER TABLE "FrontDeskShift" ADD CONSTRAINT "front_desk_shift_variance_review_consistency" CHECK (
  (
    "varianceReviewedById" IS NULL
    AND "varianceReviewedAt" IS NULL
    AND "varianceReviewReason" IS NULL
  )
  OR
  (
    "status" = 'CLOSED'
    AND "varianceReviewedById" IS NOT NULL
    AND "varianceReviewedAt" IS NOT NULL
    AND "varianceReviewedById" <> "operatorId"
    AND "varianceReviewedById" <> "closedById"
    AND (
      "varianceReviewReason" IS NULL
      OR (
        length(btrim("varianceReviewReason")) BETWEEN 2 AND 300
        AND btrim("varianceReviewReason") = "varianceReviewReason"
      )
    )
    AND ("cashVarianceCents" = 0 OR "varianceReviewReason" IS NOT NULL)
  )
);

CREATE INDEX "FrontDeskShift_varianceReviewedById_varianceReviewedAt_idx"
  ON "FrontDeskShift"("varianceReviewedById", "varianceReviewedAt");

ALTER TABLE "FrontDeskShift" ADD CONSTRAINT "FrontDeskShift_varianceReviewedById_fkey"
  FOREIGN KEY ("varianceReviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
