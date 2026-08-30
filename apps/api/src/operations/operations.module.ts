import { Module } from '@nestjs/common';

import { FrontDeskShiftsController } from './frontdesk-shifts.controller.js';
import { FrontDeskShiftsService } from './frontdesk-shifts.service.js';

@Module({
  controllers: [FrontDeskShiftsController],
  providers: [FrontDeskShiftsService],
  exports: [FrontDeskShiftsService],
})
export class OperationsModule {}
