CREATE TYPE "ConsignmentPayableEntryType" AS ENUM ('SALE', 'REFUND_REVERSAL');
CREATE TYPE "ConsignmentSettlementAction" AS ENUM (
  'CREATED',
  'SUBMITTED',
  'CONFIRMED',
  'DISPUTED',
  'RETURNED',
  'SETTLED',
  'VOIDED'
);

CREATE TABLE "ConsignmentPayableEntry" (
  "id" TEXT NOT NULL,
  "type" "ConsignmentPayableEntryType" NOT NULL,
  "supplierId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "refundId" TEXT,
  "reversalOfId" TEXT,
  "quantity" INTEGER NOT NULL,
  "unitSalePriceCents" INTEGER NOT NULL,
  "grossSaleCents" INTEGER NOT NULL,
  "commissionRateBps" INTEGER NOT NULL,
  "commissionCents" INTEGER NOT NULL,
  "payableCents" INTEGER NOT NULL,
  "ruleSnapshot" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsignmentPayableEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsignmentPayableEntry_amount_check" CHECK (
    "unitSalePriceCents" >= 0 AND
    "commissionRateBps" BETWEEN 0 AND 10000 AND
    "grossSaleCents" = "unitSalePriceCents" * "quantity" AND
    "payableCents" = "grossSaleCents" - "commissionCents" AND
    jsonb_typeof("ruleSnapshot") = 'object' AND
    char_length("idempotencyKey") BETWEEN 8 AND 100 AND
    (
      (
        "type" = 'SALE' AND
        "quantity" > 0 AND
        "grossSaleCents" > 0 AND
        "commissionCents" BETWEEN 0 AND "grossSaleCents" AND
        "payableCents" >= 0 AND
        "refundId" IS NULL AND
        "reversalOfId" IS NULL
      ) OR
      (
        "type" = 'REFUND_REVERSAL' AND
        "quantity" < 0 AND
        "grossSaleCents" < 0 AND
        "commissionCents" BETWEEN "grossSaleCents" AND 0 AND
        "payableCents" <= 0 AND
        "refundId" IS NOT NULL AND
        "reversalOfId" IS NOT NULL
      )
    )
  )
);

CREATE TABLE "ConsignmentSettlement" (
  "id" TEXT NOT NULL,
  "statementNo" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
  "entryCount" INTEGER NOT NULL,
  "netQuantity" INTEGER NOT NULL,
  "grossSaleCents" INTEGER NOT NULL,
  "commissionCents" INTEGER NOT NULL,
  "payableCents" INTEGER NOT NULL,
  "ruleSnapshot" JSONB NOT NULL,
  "creationReason" TEXT NOT NULL,
  "creationIdempotencyKey" TEXT NOT NULL,
  "creationCommandHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "confirmedById" TEXT,
  "settledById" TEXT,
  "voidedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "paymentReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConsignmentSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsignmentSettlement_period_command_check" CHECK (
    "periodEnd" > "periodStart" AND
    "version" > 0 AND
    "entryCount" > 0 AND
    jsonb_typeof("ruleSnapshot") = 'object' AND
    char_length(btrim("creationReason")) BETWEEN 2 AND 300 AND
    char_length("creationIdempotencyKey") BETWEEN 8 AND 100 AND
    "creationCommandHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ConsignmentSettlement_maker_checker_check" CHECK (
    ("confirmedById" IS NULL OR "confirmedById" <> "createdById") AND
    ("settledById" IS NULL OR "settledById" <> "createdById")
  ),
  CONSTRAINT "ConsignmentSettlement_state_check" CHECK (
    (
      "status" = 'DRAFT' AND
      "submittedById" IS NULL AND "submittedAt" IS NULL AND
      "confirmedById" IS NULL AND "confirmedAt" IS NULL AND
      "settledById" IS NULL AND "settledAt" IS NULL AND
      "voidedById" IS NULL AND "voidedAt" IS NULL AND
      "paymentReference" IS NULL
    ) OR (
      "status" = 'PENDING_CONFIRMATION' AND
      "submittedById" IS NOT NULL AND "submittedAt" IS NOT NULL AND
      "confirmedById" IS NULL AND "confirmedAt" IS NULL AND
      "settledById" IS NULL AND "settledAt" IS NULL AND
      "voidedById" IS NULL AND "voidedAt" IS NULL AND
      "paymentReference" IS NULL
    ) OR (
      "status" = 'CONFIRMED' AND
      "submittedById" IS NOT NULL AND "submittedAt" IS NOT NULL AND
      "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL AND
      "settledById" IS NULL AND "settledAt" IS NULL AND
      "voidedById" IS NULL AND "voidedAt" IS NULL AND
      "paymentReference" IS NULL
    ) OR (
      "status" = 'SETTLED' AND
      "submittedById" IS NOT NULL AND "submittedAt" IS NOT NULL AND
      "confirmedById" IS NOT NULL AND "confirmedAt" IS NOT NULL AND
      "settledById" IS NOT NULL AND "settledAt" IS NOT NULL AND
      "voidedById" IS NULL AND "voidedAt" IS NULL AND
      char_length(btrim("paymentReference")) BETWEEN 2 AND 120
    ) OR (
      "status" = 'VOID' AND
      "submittedById" IS NULL AND "submittedAt" IS NULL AND
      "confirmedById" IS NULL AND "confirmedAt" IS NULL AND
      "settledById" IS NULL AND "settledAt" IS NULL AND
      "voidedById" IS NOT NULL AND "voidedAt" IS NOT NULL AND
      "paymentReference" IS NULL
    )
  )
);

CREATE TABLE "ConsignmentSettlementLine" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "payableEntryId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "grossSaleCents" INTEGER NOT NULL,
  "commissionCents" INTEGER NOT NULL,
  "payableCents" INTEGER NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsignmentSettlementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsignmentSettlementLine_release_check" CHECK (
    "releasedAt" IS NULL OR "releasedAt" >= "createdAt"
  )
);

CREATE TABLE "ConsignmentSettlementTransition" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "action" "ConsignmentSettlementAction" NOT NULL,
  "fromStatus" "SettlementStatus",
  "toStatus" "SettlementStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConsignmentSettlementTransition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsignmentSettlementTransition_command_check" CHECK (
    char_length(btrim("reason")) BETWEEN 2 AND 300 AND
    char_length("idempotencyKey") BETWEEN 8 AND 100 AND
    "commandHash" ~ '^[0-9a-f]{64}$' AND
    (
      ("action" = 'CREATED' AND "fromStatus" IS NULL AND "toStatus" = 'DRAFT') OR
      ("action" = 'SUBMITTED' AND "fromStatus" = 'DRAFT' AND "toStatus" = 'PENDING_CONFIRMATION') OR
      ("action" = 'CONFIRMED' AND "fromStatus" = 'PENDING_CONFIRMATION' AND "toStatus" = 'CONFIRMED') OR
      ("action" = 'DISPUTED' AND "fromStatus" = 'PENDING_CONFIRMATION' AND "toStatus" = 'DRAFT') OR
      ("action" = 'RETURNED' AND "fromStatus" = 'CONFIRMED' AND "toStatus" = 'DRAFT') OR
      ("action" = 'SETTLED' AND "fromStatus" = 'CONFIRMED' AND "toStatus" = 'SETTLED') OR
      ("action" = 'VOIDED' AND "fromStatus" = 'DRAFT' AND "toStatus" = 'VOID')
    )
  )
);

CREATE UNIQUE INDEX "ConsignmentPayableEntry_idempotencyKey_key"
  ON "ConsignmentPayableEntry"("idempotencyKey");
CREATE UNIQUE INDEX "ConsignmentPayableEntry_reversalOfId_key"
  ON "ConsignmentPayableEntry"("reversalOfId");
CREATE UNIQUE INDEX "consignment_payable_sale_order_item_key"
  ON "ConsignmentPayableEntry"("orderItemId") WHERE "type" = 'SALE';
CREATE UNIQUE INDEX "consignment_payable_refund_order_item_key"
  ON "ConsignmentPayableEntry"("refundId", "orderItemId") WHERE "type" = 'REFUND_REVERSAL';
CREATE INDEX "ConsignmentPayableEntry_supplierId_occurredAt_idx"
  ON "ConsignmentPayableEntry"("supplierId", "occurredAt");
CREATE INDEX "ConsignmentPayableEntry_orderId_createdAt_idx"
  ON "ConsignmentPayableEntry"("orderId", "createdAt");
CREATE INDEX "ConsignmentPayableEntry_orderItemId_type_idx"
  ON "ConsignmentPayableEntry"("orderItemId", "type");
CREATE INDEX "ConsignmentPayableEntry_refundId_idx"
  ON "ConsignmentPayableEntry"("refundId");
CREATE INDEX "ConsignmentPayableEntry_type_occurredAt_idx"
  ON "ConsignmentPayableEntry"("type", "occurredAt");

CREATE UNIQUE INDEX "ConsignmentSettlement_statementNo_key"
  ON "ConsignmentSettlement"("statementNo");
CREATE UNIQUE INDEX "ConsignmentSettlement_creationIdempotencyKey_key"
  ON "ConsignmentSettlement"("creationIdempotencyKey");
CREATE UNIQUE INDEX "consignment_settlement_supplier_period_version_key"
  ON "ConsignmentSettlement"("supplierId", "periodStart", "periodEnd", "version");
CREATE INDEX "ConsignmentSettlement_supplierId_status_periodEnd_idx"
  ON "ConsignmentSettlement"("supplierId", "status", "periodEnd");
CREATE INDEX "ConsignmentSettlement_status_periodEnd_idx"
  ON "ConsignmentSettlement"("status", "periodEnd");
CREATE INDEX "ConsignmentSettlement_createdById_createdAt_idx"
  ON "ConsignmentSettlement"("createdById", "createdAt");

CREATE UNIQUE INDEX "consignment_settlement_line_statement_entry_key"
  ON "ConsignmentSettlementLine"("settlementId", "payableEntryId");
CREATE UNIQUE INDEX "consignment_settlement_line_active_entry_key"
  ON "ConsignmentSettlementLine"("payableEntryId") WHERE "releasedAt" IS NULL;
CREATE INDEX "ConsignmentSettlementLine_payableEntryId_releasedAt_idx"
  ON "ConsignmentSettlementLine"("payableEntryId", "releasedAt");
CREATE INDEX "ConsignmentSettlementLine_settlementId_releasedAt_idx"
  ON "ConsignmentSettlementLine"("settlementId", "releasedAt");

CREATE UNIQUE INDEX "ConsignmentSettlementTransition_idempotencyKey_key"
  ON "ConsignmentSettlementTransition"("idempotencyKey");
CREATE INDEX "ConsignmentSettlementTransition_settlementId_createdAt_idx"
  ON "ConsignmentSettlementTransition"("settlementId", "createdAt");
CREATE INDEX "ConsignmentSettlementTransition_actorId_createdAt_idx"
  ON "ConsignmentSettlementTransition"("actorId", "createdAt");
CREATE INDEX "ConsignmentSettlementTransition_action_createdAt_idx"
  ON "ConsignmentSettlementTransition"("action", "createdAt");

ALTER TABLE "ConsignmentPayableEntry"
  ADD CONSTRAINT "ConsignmentPayableEntry_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentPayableEntry_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentPayableEntry_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentPayableEntry_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentPayableEntry_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentPayableEntry_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "ConsignmentPayableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsignmentSettlement"
  ADD CONSTRAINT "ConsignmentSettlement_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlement_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlement_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlement_settledById_fkey"
  FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlement_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsignmentSettlementLine"
  ADD CONSTRAINT "ConsignmentSettlementLine_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "ConsignmentSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlementLine_payableEntryId_fkey"
  FOREIGN KEY ("payableEntryId") REFERENCES "ConsignmentPayableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsignmentSettlementTransition"
  ADD CONSTRAINT "ConsignmentSettlementTransition_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "ConsignmentSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ConsignmentSettlementTransition_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
