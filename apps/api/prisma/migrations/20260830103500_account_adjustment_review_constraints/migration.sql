ALTER TABLE "AccountAdjustmentRequest"
  DROP CONSTRAINT "AccountAdjustmentRequest_state_check",
  ADD CONSTRAINT "AccountAdjustmentRequest_state_check" CHECK (
    (
      "status" = 'REQUESTED'
      AND "reviewedById" IS NULL
      AND "reviewedAt" IS NULL
      AND "reviewReason" IS NULL
      AND "transactionId" IS NULL
    )
    OR (
      "status" = 'POSTED'
      AND "reviewedById" IS NOT NULL
      AND "reviewedById" <> "requestedById"
      AND "reviewedAt" IS NOT NULL
      AND "reviewReason" IS NOT NULL
      AND char_length(btrim("reviewReason")) BETWEEN 2 AND 200
      AND "transactionId" IS NOT NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "reviewedById" IS NOT NULL
      AND "reviewedById" <> "requestedById"
      AND "reviewedAt" IS NOT NULL
      AND "reviewReason" IS NOT NULL
      AND char_length(btrim("reviewReason")) BETWEEN 2 AND 200
      AND "transactionId" IS NULL
    )
  );
