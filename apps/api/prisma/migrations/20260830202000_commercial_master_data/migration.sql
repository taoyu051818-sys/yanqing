-- Membership products and venue price rules are immutable commercial versions.
-- Existing rows are retained as v1 and keep every historical foreign key valid.

ALTER TABLE "MembershipProduct"
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "effectiveTo" TIMESTAMP(3),
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT,
  ADD COLUMN "createdById" TEXT;

UPDATE "MembershipProduct"
SET
  "version" = 1,
  "effectiveFrom" = LEAST("createdAt", CURRENT_TIMESTAMP),
  "creationIdempotencyKey" = 'MIGRATION:MEMBERSHIP:' || "id",
  "creationCommandHash" = md5('membership-product:' || "id") || md5('membership-product-hash:' || "id"),
  "createdById" = (
    SELECT "id"
    FROM "User"
    ORDER BY
      CASE WHEN "primaryRole" IN ('SUPER_ADMIN', 'ADMIN') THEN 0 ELSE 1 END,
      "createdAt",
      "id"
    LIMIT 1
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MembershipProduct" WHERE "createdById" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill MembershipProduct.createdById without an existing User';
  END IF;
END $$;

-- Older releases did not enforce the commercial field bounds below. Retain
-- every historical row and its stable id, but deactivate an invalid version so
-- it cannot remain publicly purchasable after the stricter model is deployed.
-- The NOT VALID constraints added below still reject every new or subsequently
-- updated invalid row while deliberately preserving these immutable snapshots.
UPDATE "MembershipProduct"
SET "enabled" = false
WHERE
  "code" !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' OR
  char_length("name") NOT BETWEEN 2 AND 80 OR
  "name" <> btrim("name") OR
  "priceCents" NOT BETWEEN 0 AND 10000000 OR
  "durationDays" NOT BETWEEN 1 AND 3650;

ALTER TABLE "MembershipProduct"
  ALTER COLUMN "version" SET NOT NULL,
  ALTER COLUMN "effectiveFrom" SET NOT NULL,
  ALTER COLUMN "creationIdempotencyKey" SET NOT NULL,
  ALTER COLUMN "creationCommandHash" SET NOT NULL,
  ALTER COLUMN "createdById" SET NOT NULL,
  ALTER COLUMN "enabled" SET DEFAULT false;

DROP INDEX "MembershipProduct_code_key";

CREATE UNIQUE INDEX "MembershipProduct_code_version_key"
  ON "MembershipProduct"("code", "version");
CREATE UNIQUE INDEX "MembershipProduct_creationIdempotencyKey_key"
  ON "MembershipProduct"("creationIdempotencyKey");
CREATE INDEX "MembershipProduct_enabled_effectiveFrom_effectiveTo_idx"
  ON "MembershipProduct"("enabled", "effectiveFrom", "effectiveTo");
CREATE INDEX "MembershipProduct_createdById_createdAt_idx"
  ON "MembershipProduct"("createdById", "createdAt");

ALTER TABLE "MembershipProduct"
  ADD CONSTRAINT "MembershipProduct_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MembershipProduct_version_check"
    CHECK ("version" >= 1),
  ADD CONSTRAINT "MembershipProduct_code_check"
    CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$') NOT VALID,
  ADD CONSTRAINT "MembershipProduct_name_check"
    CHECK (char_length("name") BETWEEN 2 AND 80 AND "name" = btrim("name")) NOT VALID,
  ADD CONSTRAINT "MembershipProduct_price_duration_check"
    CHECK ("priceCents" BETWEEN 0 AND 10000000 AND "durationDays" BETWEEN 1 AND 3650) NOT VALID,
  ADD CONSTRAINT "MembershipProduct_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "MembershipProduct_creation_evidence_check"
    CHECK (
      char_length("creationIdempotencyKey") BETWEEN 8 AND 100 AND
      "creationIdempotencyKey" = btrim("creationIdempotencyKey") AND
      "creationCommandHash" ~ '^[0-9a-f]{64}$'
    );

CREATE TABLE "MembershipProductTransition" (
  "id" TEXT NOT NULL,
  "membershipProductId" TEXT NOT NULL,
  "oldEnabled" BOOLEAN NOT NULL,
  "newEnabled" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipProductTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MembershipProductTransition_state_check" CHECK ("oldEnabled" <> "newEnabled"),
  CONSTRAINT "MembershipProductTransition_reason_check" CHECK (char_length("reason") BETWEEN 2 AND 300 AND "reason" = btrim("reason")),
  CONSTRAINT "MembershipProductTransition_evidence_check" CHECK (
    char_length("idempotencyKey") BETWEEN 8 AND 100 AND
    "idempotencyKey" = btrim("idempotencyKey") AND
    "commandHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "MembershipProductTransition_idempotencyKey_key"
  ON "MembershipProductTransition"("idempotencyKey");
CREATE INDEX "MembershipProductTransition_membershipProductId_createdAt_idx"
  ON "MembershipProductTransition"("membershipProductId", "createdAt");
CREATE INDEX "MembershipProductTransition_actorId_createdAt_idx"
  ON "MembershipProductTransition"("actorId", "createdAt");
ALTER TABLE "MembershipProductTransition"
  ADD CONSTRAINT "MembershipProductTransition_membershipProductId_fkey"
    FOREIGN KEY ("membershipProductId") REFERENCES "MembershipProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MembershipProductTransition_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriceRule"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "creationIdempotencyKey" TEXT,
  ADD COLUMN "creationCommandHash" TEXT,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

WITH normalized AS (
  SELECT
    rule."id",
    'PRICE_' || left(COALESCE(
      NULLIF(regexp_replace(upper(slot."code"), '[^A-Z0-9_-]', '_', 'g'), ''),
      'GLOBAL'
    ), 34) AS "derivedCode",
    rule."effectiveFrom",
    rule."createdAt"
  FROM "PriceRule" rule
  LEFT JOIN "TimeSlot" slot ON slot."id" = rule."timeSlotId"
), ranked AS (
  SELECT
    normalized."id",
    normalized."derivedCode",
    row_number() OVER (
      PARTITION BY normalized."derivedCode"
      ORDER BY normalized."effectiveFrom", normalized."createdAt", normalized."id"
    ) AS "derivedVersion"
  FROM normalized
)
UPDATE "PriceRule" rule
SET
  "code" = ranked."derivedCode",
  "version" = ranked."derivedVersion",
  "creationIdempotencyKey" = 'MIGRATION:PRICE:' || rule."id",
  "creationCommandHash" = md5('price-rule:' || rule."id") || md5('price-rule-hash:' || rule."id"),
  "createdById" = (
    SELECT "id"
    FROM "User"
    ORDER BY
      CASE WHEN "primaryRole" IN ('SUPER_ADMIN', 'ADMIN') THEN 0 ELSE 1 END,
      "createdAt",
      "id"
    LIMIT 1
  )
FROM ranked
WHERE rule."id" = ranked."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PriceRule" WHERE "createdById" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill PriceRule.createdById without an existing User';
  END IF;
END $$;

-- Preserve invalid pre-versioning rules as historical evidence, but remove them
-- from price resolution. In particular, weekdayMask=0 previously meant the
-- rule could never match, and an excessive/newcomer surcharge must not survive
-- as an active customer price. No row, id, label or monetary value is rewritten.
UPDATE "PriceRule"
SET "enabled" = false
WHERE
  char_length("name") NOT BETWEEN 2 AND 80 OR
  "name" <> btrim("name") OR
  "weekdayMask" NOT BETWEEN 1 AND 127 OR
  "priceCents" NOT BETWEEN 0 AND 10000000 OR
  (
    "newcomerPriceCents" IS NOT NULL AND
    "newcomerPriceCents" NOT BETWEEN 0 AND "priceCents"
  ) OR
  ("effectiveTo" IS NOT NULL AND "effectiveTo" <= "effectiveFrom");

ALTER TABLE "PriceRule"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "version" SET NOT NULL,
  ALTER COLUMN "creationIdempotencyKey" SET NOT NULL,
  ALTER COLUMN "creationCommandHash" SET NOT NULL,
  ALTER COLUMN "createdById" SET NOT NULL,
  ALTER COLUMN "enabled" SET DEFAULT false,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

DROP INDEX "PriceRule_timeSlotId_effectiveFrom_effectiveTo_idx";

CREATE UNIQUE INDEX "PriceRule_code_version_key"
  ON "PriceRule"("code", "version");
CREATE UNIQUE INDEX "PriceRule_creationIdempotencyKey_key"
  ON "PriceRule"("creationIdempotencyKey");
CREATE INDEX "PriceRule_timeSlotId_enabled_effectiveFrom_effectiveTo_idx"
  ON "PriceRule"("timeSlotId", "enabled", "effectiveFrom", "effectiveTo");
CREATE INDEX "PriceRule_createdById_createdAt_idx"
  ON "PriceRule"("createdById", "createdAt");

ALTER TABLE "PriceRule" DROP CONSTRAINT "PriceRule_timeSlotId_fkey";
ALTER TABLE "PriceRule"
  ADD CONSTRAINT "PriceRule_timeSlotId_fkey"
    FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PriceRule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PriceRule_version_check"
    CHECK ("version" >= 1),
  ADD CONSTRAINT "PriceRule_code_check"
    CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  ADD CONSTRAINT "PriceRule_name_check"
    CHECK (char_length("name") BETWEEN 2 AND 80 AND "name" = btrim("name")) NOT VALID,
  ADD CONSTRAINT "PriceRule_price_check"
    CHECK (
      "weekdayMask" BETWEEN 1 AND 127 AND
      "priceCents" BETWEEN 0 AND 10000000 AND
      ("newcomerPriceCents" IS NULL OR "newcomerPriceCents" BETWEEN 0 AND "priceCents")
    ) NOT VALID,
  ADD CONSTRAINT "PriceRule_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom") NOT VALID,
  ADD CONSTRAINT "PriceRule_creation_evidence_check"
    CHECK (
      char_length("creationIdempotencyKey") BETWEEN 8 AND 100 AND
      "creationIdempotencyKey" = btrim("creationIdempotencyKey") AND
      "creationCommandHash" ~ '^[0-9a-f]{64}$'
    );

CREATE TABLE "PriceRuleTransition" (
  "id" TEXT NOT NULL,
  "priceRuleId" TEXT NOT NULL,
  "oldEnabled" BOOLEAN NOT NULL,
  "newEnabled" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceRuleTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PriceRuleTransition_state_check" CHECK ("oldEnabled" <> "newEnabled"),
  CONSTRAINT "PriceRuleTransition_reason_check" CHECK (char_length("reason") BETWEEN 2 AND 300 AND "reason" = btrim("reason")),
  CONSTRAINT "PriceRuleTransition_evidence_check" CHECK (
    char_length("idempotencyKey") BETWEEN 8 AND 100 AND
    "idempotencyKey" = btrim("idempotencyKey") AND
    "commandHash" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "PriceRuleTransition_idempotencyKey_key"
  ON "PriceRuleTransition"("idempotencyKey");
CREATE INDEX "PriceRuleTransition_priceRuleId_createdAt_idx"
  ON "PriceRuleTransition"("priceRuleId", "createdAt");
CREATE INDEX "PriceRuleTransition_actorId_createdAt_idx"
  ON "PriceRuleTransition"("actorId", "createdAt");
ALTER TABLE "PriceRuleTransition"
  ADD CONSTRAINT "PriceRuleTransition_priceRuleId_fkey"
    FOREIGN KEY ("priceRuleId") REFERENCES "PriceRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PriceRuleTransition_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
