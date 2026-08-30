import { Module } from '@nestjs/common'

import { AllianceController } from './alliance.controller.js'
import { AllianceService } from './alliance.service.js'

@Module({
  controllers: [AllianceController],
  providers: [AllianceService],
  exports: [AllianceService],
})
export class AllianceModule {}
