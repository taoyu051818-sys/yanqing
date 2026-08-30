ALTER TYPE "InventoryTxnType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "InventoryTxnType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';
ALTER TYPE "InventoryTxnType" ADD VALUE IF NOT EXISTS 'LOSS_OUT';
ALTER TYPE "InventoryTxnType" ADD VALUE IF NOT EXISTS 'STOCKTAKE_GAIN';
ALTER TYPE "InventoryTxnType" ADD VALUE IF NOT EXISTS 'STOCKTAKE_LOSS';

CREATE TYPE "SupplierType" AS ENUM ('OWNED', 'CONSIGNMENT');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'COUNTING', 'REVIEW', 'POSTED');
CREATE TYPE "InventoryOperationType" AS ENUM ('TRANSFER', 'LOSS');
CREATE TYPE "InventoryOperationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED');

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "SupplierType" NOT NULL,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "settlementRule" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryLocation" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryItem"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "defaultLocationId" TEXT,
  ADD COLUMN "batchCode" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

INSERT INTO "InventoryLocation" ("id", "code", "name", "enabled", "createdAt", "updatedAt")
VALUES ('inventory-location-main', 'MAIN', '主仓', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "InventoryItem" SET "defaultLocationId" = 'inventory-location-main' WHERE "defaultLocationId" IS NULL;

CREATE TABLE "InventoryStockBalance" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "batchCode" TEXT NOT NULL DEFAULT 'DEFAULT',
  "expiresAt" TIMESTAMP(3),
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryStockBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryStockBalance_quantity_nonnegative_check" CHECK ("quantity" >= 0)
);

INSERT INTO "InventoryStockBalance" ("id", "itemId", "locationId", "batchCode", "expiresAt", "quantity", "createdAt", "updatedAt")
SELECT 'opening-' || "id", "id", 'inventory-location-main', COALESCE(NULLIF("batchCode", ''), 'DEFAULT'), "expiresAt", "stock", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "InventoryItem";

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "remark" TEXT,
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "approvedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "orderedQuantity" INTEGER NOT NULL,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "unitCostCents" INTEGER NOT NULL,
  "batchCode" TEXT NOT NULL DEFAULT 'DEFAULT',
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderLine_quantity_check" CHECK ("orderedQuantity" > 0 AND "receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity"),
  CONSTRAINT "PurchaseOrderLine_cost_check" CHECK ("unitCostCents" >= 0)
);

CREATE TABLE "PurchaseReceipt" (
  "id" TEXT NOT NULL,
  "receiptNo" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReceiptLine" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "batchCode" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "inventoryTransactionId" TEXT NOT NULL,
  CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseReceiptLine_quantity_positive_check" CHECK ("quantity" > 0)
);

CREATE TABLE "Stocktake" (
  "id" TEXT NOT NULL,
  "stocktakeNo" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "submittedById" TEXT,
  "reviewedById" TEXT,
  "postedById" TEXT,
  "startedAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "postIdempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Stocktake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StocktakeLine" (
  "id" TEXT NOT NULL,
  "stocktakeId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "batchCode" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "bookQuantity" INTEGER NOT NULL,
  "countedQuantity" INTEGER,
  "difference" INTEGER,
  "inventoryTransactionId" TEXT,
  CONSTRAINT "StocktakeLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StocktakeLine_quantity_check" CHECK ("bookQuantity" >= 0 AND ("countedQuantity" IS NULL OR "countedQuantity" >= 0))
);

CREATE TABLE "InventoryOperation" (
  "id" TEXT NOT NULL,
  "documentNo" TEXT NOT NULL,
  "type" "InventoryOperationType" NOT NULL,
  "status" "InventoryOperationStatus" NOT NULL DEFAULT 'DRAFT',
  "itemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "batchCode" TEXT NOT NULL DEFAULT 'DEFAULT',
  "expiresAt" TIMESTAMP(3),
  "sourceLocationId" TEXT NOT NULL,
  "targetLocationId" TEXT,
  "reason" TEXT NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "postedById" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "postIdempotencyKey" TEXT,
  "sourceTransactionId" TEXT,
  "targetTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryOperation_quantity_positive_check" CHECK ("quantity" > 0),
  CONSTRAINT "InventoryOperation_location_check" CHECK (
    ("type" = 'TRANSFER' AND "targetLocationId" IS NOT NULL AND "targetLocationId" <> "sourceLocationId") OR
    ("type" = 'LOSS' AND "targetLocationId" IS NULL)
  )
);

CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");
CREATE INDEX "Supplier_type_enabled_idx" ON "Supplier"("type", "enabled");
CREATE UNIQUE INDEX "InventoryLocation_code_key" ON "InventoryLocation"("code");
CREATE UNIQUE INDEX "InventoryStockBalance_itemId_locationId_batchCode_key" ON "InventoryStockBalance"("itemId", "locationId", "batchCode");
CREATE INDEX "InventoryStockBalance_locationId_quantity_idx" ON "InventoryStockBalance"("locationId", "quantity");
CREATE INDEX "InventoryStockBalance_expiresAt_idx" ON "InventoryStockBalance"("expiresAt");
CREATE UNIQUE INDEX "PurchaseOrder_orderNo_key" ON "PurchaseOrder"("orderNo");
CREATE INDEX "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");
CREATE INDEX "PurchaseOrder_supplierId_status_idx" ON "PurchaseOrder"("supplierId", "status");
CREATE UNIQUE INDEX "po_line_item_location_batch_key" ON "PurchaseOrderLine"("purchaseOrderId", "itemId", "locationId", "batchCode");
CREATE INDEX "PurchaseOrderLine_itemId_idx" ON "PurchaseOrderLine"("itemId");
CREATE UNIQUE INDEX "PurchaseReceipt_receiptNo_key" ON "PurchaseReceipt"("receiptNo");
CREATE UNIQUE INDEX "PurchaseReceipt_idempotencyKey_key" ON "PurchaseReceipt"("idempotencyKey");
CREATE INDEX "PurchaseReceipt_purchaseOrderId_receivedAt_idx" ON "PurchaseReceipt"("purchaseOrderId", "receivedAt");
CREATE UNIQUE INDEX "PurchaseReceiptLine_inventoryTransactionId_key" ON "PurchaseReceiptLine"("inventoryTransactionId");
CREATE UNIQUE INDEX "PurchaseReceiptLine_receiptId_purchaseOrderLineId_key" ON "PurchaseReceiptLine"("receiptId", "purchaseOrderLineId");
CREATE UNIQUE INDEX "Stocktake_stocktakeNo_key" ON "Stocktake"("stocktakeNo");
CREATE UNIQUE INDEX "Stocktake_postIdempotencyKey_key" ON "Stocktake"("postIdempotencyKey");
CREATE INDEX "Stocktake_status_createdAt_idx" ON "Stocktake"("status", "createdAt");
CREATE INDEX "Stocktake_locationId_status_idx" ON "Stocktake"("locationId", "status");
CREATE UNIQUE INDEX "StocktakeLine_inventoryTransactionId_key" ON "StocktakeLine"("inventoryTransactionId");
CREATE UNIQUE INDEX "StocktakeLine_stocktakeId_itemId_batchCode_key" ON "StocktakeLine"("stocktakeId", "itemId", "batchCode");
CREATE UNIQUE INDEX "InventoryOperation_documentNo_key" ON "InventoryOperation"("documentNo");
CREATE UNIQUE INDEX "InventoryOperation_postIdempotencyKey_key" ON "InventoryOperation"("postIdempotencyKey");
CREATE UNIQUE INDEX "InventoryOperation_sourceTransactionId_key" ON "InventoryOperation"("sourceTransactionId");
CREATE UNIQUE INDEX "InventoryOperation_targetTransactionId_key" ON "InventoryOperation"("targetTransactionId");
CREATE INDEX "InventoryOperation_status_createdAt_idx" ON "InventoryOperation"("status", "createdAt");
CREATE INDEX "InventoryOperation_sourceLocationId_status_idx" ON "InventoryOperation"("sourceLocationId", "status");
CREATE INDEX "InventoryOperation_targetLocationId_status_idx" ON "InventoryOperation"("targetLocationId", "status");
CREATE INDEX "InventoryItem_supplierId_enabled_idx" ON "InventoryItem"("supplierId", "enabled");
CREATE INDEX "InventoryItem_defaultLocationId_enabled_idx" ON "InventoryItem"("defaultLocationId", "enabled");
CREATE INDEX "InventoryItem_expiresAt_idx" ON "InventoryItem"("expiresAt");

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStockBalance" ADD CONSTRAINT "InventoryStockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stocktake" ADD CONSTRAINT "Stocktake_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StocktakeLine" ADD CONSTRAINT "StocktakeLine_inventoryTransactionId_fkey" FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_targetTransactionId_fkey" FOREIGN KEY ("targetTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
