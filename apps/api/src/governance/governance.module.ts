import { GovernanceUsersService } from './users/governance-users.service.js';
import { GovernanceRisksService } from './risks/governance-risks.service.js';
import { Module } from '@nestjs/common';

import { GovernanceController } from './governance.controller.js';

@Module({
  controllers: [GovernanceController],
  providers: [GovernanceUsersService, GovernanceRisksService],
})
export class GovernanceModule {}
