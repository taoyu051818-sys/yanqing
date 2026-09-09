import type { PrismaService } from '../../src/database/prisma.service.js';
import { GovernanceUsersService } from '../../src/governance/users/governance-users.service.js';
import { GovernanceRisksService } from '../../src/governance/risks/governance-risks.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class GovernanceService {
  private readonly domain0: GovernanceUsersService;
  private readonly domain1: GovernanceRisksService;
  constructor(prisma: PrismaService) {
    this.domain0 = new GovernanceUsersService(prisma);
    this.domain1 = new GovernanceRisksService(prisma);
  }
  users(...args: Parameters<GovernanceUsersService['users']>) {
    return this.domain0.users(...args);
  }
  setUserRoles(...args: Parameters<GovernanceUsersService['setUserRoles']>) {
    return this.domain0.setUserRoles(...args);
  }
  setUserStatus(...args: Parameters<GovernanceUsersService['setUserStatus']>) {
    return this.domain0.setUserStatus(...args);
  }
  riskEvents(...args: Parameters<GovernanceRisksService['riskEvents']>) {
    return this.domain1.riskEvents(...args);
  }
  transitionRisk(
    ...args: Parameters<GovernanceRisksService['transitionRisk']>
  ) {
    return this.domain1.transitionRisk(...args);
  }
}
