import { ConsignmentLedgerService } from './consignment/ledger/consignment-settlement-ledger.service.js';
import { ConsignmentQueriesService } from './consignment/queries/consignment-settlement-queries.service.js';
import { ConsignmentStatementsService } from './consignment/statements/consignment-settlement-statements.service.js';
import { ConsignmentWorkflowService } from './consignment/workflow/consignment-settlement-workflow.service.js';
import { InventorySuppliersService } from './suppliers/inventory-operations-suppliers.service.js';
import { InventoryLocationsService } from './locations/inventory-operations-locations.service.js';
import { InventoryPurchasingService } from './purchasing/inventory-operations-purchasing.service.js';
import { InventoryStocktakingService } from './stocktaking/inventory-operations-stocktaking.service.js';
import { InventoryMovementsService } from './movements/inventory-operations-movements.service.js';
import { InventoryCatalogService } from './catalog/inventory-catalog.service.js';
import { InventoryTransactionsService } from './transactions/inventory-transactions.service.js';
import { Module } from '@nestjs/common';

import { ConsignmentSettlementController } from './consignment-settlement.controller.js';

import { InventoryController } from './inventory.controller.js';

@Module({
  controllers: [InventoryController, ConsignmentSettlementController],
  providers: [
    InventoryCatalogService,
    InventoryTransactionsService,
    InventorySuppliersService,
    InventoryLocationsService,
    InventoryPurchasingService,
    InventoryStocktakingService,
    InventoryMovementsService,
    ConsignmentLedgerService,
    ConsignmentQueriesService,
    ConsignmentStatementsService,
    ConsignmentWorkflowService,
  ],
  exports: [
    InventoryCatalogService,
    InventoryTransactionsService,
    ConsignmentLedgerService,
    ConsignmentQueriesService,
    ConsignmentStatementsService,
    ConsignmentWorkflowService,
  ],
})
export class InventoryModule {}
