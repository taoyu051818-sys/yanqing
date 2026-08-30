import { Module } from '@nestjs/common'

import { InventoryController } from './inventory.controller.js'
import { InventoryOperationsService } from './inventory-operations.service.js'
import { InventoryService } from './inventory.service.js'

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryOperationsService],
  exports: [InventoryService],
})
export class InventoryModule {}
