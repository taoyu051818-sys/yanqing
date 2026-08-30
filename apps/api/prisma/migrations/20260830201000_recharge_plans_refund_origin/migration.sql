CREATE TABLE "RechargePlan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "principalCents" INTEGER NOT NULL,
  "giftCents" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "creationIdempotencyKey" TEXT NOT NULL,
  "creationCommandHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RechargePlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RechargePlan_terms_check" CHECK (
    "code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' AND
    char_length(btrim("name")) BETWEEN 2 AND 50 AND
    "version" > 0 AND
    "principalCents" BETWEEN 100 AND 10000000 AND
    "giftCents" BETWEEN 0 AND 10000000 AND
    "giftCents" <= "principalCents" AND
    ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom") AND
    char_length("creationIdempotencyKey") BETWEEN 8 AND 100 AND
    "creationCommandHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE "RechargePlanTransition" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "oldEnabled" BOOLEAN NOT NULL,
  "newEnabled" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RechargePlanTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RechargePlanTransition_command_check" CHECK (
    "oldEnabled" <> "newEnabled" AND
    char_length(btrim("reason")) BETWEEN 2 AND 300 AND
    char_length("idempotencyKey") BETWEEN 8 AND 100 AND
    "commandHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "RechargePlan_creationIdempotencyKey_key"
  ON "RechargePlan"("creationIdempotencyKey");
CREATE UNIQUE INDEX "RechargePlan_code_version_key"
  ON "RechargePlan"("code", "version");
CREATE INDEX "RechargePlan_enabled_effectiveFrom_effectiveTo_idx"
  ON "RechargePlan"("enabled", "effectiveFrom", "effectiveTo");
CREATE INDEX "RechargePlan_createdById_createdAt_idx"
  ON "RechargePlan"("createdById", "createdAt");
CREATE UNIQUE INDEX "RechargePlanTransition_idempotencyKey_key"
  ON "RechargePlanTransition"("idempotencyKey");
CREATE INDEX "RechargePlanTransition_planId_createdAt_idx"
  ON "RechargePlanTransition"("planId", "createdAt");
CREATE INDEX "RechargePlanTransition_actorId_createdAt_idx"
  ON "RechargePlanTransition"("actorId", "createdAt");

ALTER TABLE "RechargePlan"
  ADD CONSTRAINT "RechargePlan_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RechargePlanTransition"
  ADD CONSTRAINT "RechargePlanTransition_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "RechargePlan"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RechargePlanTransition"
  ADD CONSTRAINT "RechargePlanTransition_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Refund"
  ADD COLUMN "originalOrderStatus" "OrderStatus";

UPDATE "Refund" AS refund
SET "originalOrderStatus" = CASE
  WHEN orders."refundedCents" > 0 THEN 'PARTIALLY_REFUNDED'::"OrderStatus"
  WHEN orders."completedAt" IS NOT NULL THEN 'COMPLETED'::"OrderStatus"
  WHEN orders."status" IN (
    'PAID'::"OrderStatus",
    'CHECKED_IN'::"OrderStatus",
    'COMPLETED'::"OrderStatus",
    'PARTIALLY_REFUNDED'::"OrderStatus"
  ) THEN orders."status"
  WHEN EXISTS (
    SELECT 1 FROM "CourtBooking" AS booking
    WHERE booking."orderId" = orders."id" AND booking."status" = 'CHECKED_IN'
  ) OR EXISTS (
    SELECT 1 FROM "GameRegistration" AS registration
    WHERE registration."orderId" = orders."id" AND registration."status" = 'CHECKED_IN'
  ) OR EXISTS (
    SELECT 1 FROM "EventTeam" AS team
    WHERE team."orderId" = orders."id" AND team."status" = 'CHECKED_IN'
  ) THEN 'CHECKED_IN'::"OrderStatus"
  ELSE 'PAID'::"OrderStatus"
END
FROM "Order" AS orders
WHERE refund."orderId" = orders."id";

ALTER TABLE "Refund"
  ALTER COLUMN "originalOrderStatus" SET NOT NULL;
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_original_order_status_check" CHECK (
    "originalOrderStatus" IN (
      'PAID'::"OrderStatus",
      'CHECKED_IN'::"OrderStatus",
      'COMPLETED'::"OrderStatus",
      'PARTIALLY_REFUNDED'::"OrderStatus"
    )
  );
