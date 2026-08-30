import { Module } from '@nestjs/common';

import { ConsignmentSettlementController } from './consignment-settlement.controller.js';
import { ConsignmentSettlementService } from './consignment-settlement.service.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryOperationsService } from './inventory-operations.service.js';
import { InventoryService } from './inventory.service.js';

@Module({
  controllers: [InventoryController, ConsignmentSettlementController],
  providers: [
    InventoryService,
    InventoryOperationsService,
    ConsignmentSettlementService,
  ],
  exports: [InventoryService, ConsignmentSettlementService],
})
export class InventoryModule {}
