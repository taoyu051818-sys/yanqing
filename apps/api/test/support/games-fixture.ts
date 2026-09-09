import type { PrismaService } from '../../src/database/prisma.service.js';
import { GameCatalogService } from '../../src/games/catalog/games-catalog.service.js';
import { GameHostsService } from '../../src/games/hosts/games-hosts.service.js';
import { GameCancellationService } from '../../src/games/cancellation/games-cancellation.service.js';
import { GameRegistrationService } from '../../src/games/registration/games-registration.service.js';
import { GameCompletionService } from '../../src/games/completion/games-completion.service.js';
import { GameRewardsService } from '../../src/games/rewards/games-rewards.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class GamesService {
  private readonly domain0: GameCatalogService;
  private readonly domain1: GameHostsService;
  private readonly domain2: GameCancellationService;
  private readonly domain3: GameRegistrationService;
  private readonly domain4: GameCompletionService;
  private readonly domain5: GameRewardsService;
  constructor(prisma: PrismaService) {
    this.domain0 = new GameCatalogService(prisma);
    this.domain1 = new GameHostsService(prisma);
    this.domain2 = new GameCancellationService(prisma);
    this.domain3 = new GameRegistrationService(prisma);
    this.domain4 = new GameCompletionService(prisma);
    this.domain5 = new GameRewardsService(prisma);
  }
  detail(...args: Parameters<GameCatalogService['detail']>) {
    return this.domain0.detail(...args);
  }
  participants(...args: Parameters<GameCatalogService['participants']>) {
    return this.domain0.participants(...args);
  }
  list(...args: Parameters<GameCatalogService['list']>) {
    return this.domain0.list(...args);
  }
  managed(...args: Parameters<GameCatalogService['managed']>) {
    return this.domain0.managed(...args);
  }
  create(...args: Parameters<GameCatalogService['create']>) {
    return this.domain0.create(...args);
  }
  publish(...args: Parameters<GameCatalogService['publish']>) {
    return this.domain0.publish(...args);
  }
  applyHost(...args: Parameters<GameHostsService['applyHost']>) {
    return this.domain1.applyHost(...args);
  }
  hostApplications(...args: Parameters<GameHostsService['hostApplications']>) {
    return this.domain1.hostApplications(...args);
  }
  approveHost(...args: Parameters<GameHostsService['approveHost']>) {
    return this.domain1.approveHost(...args);
  }
  rejectHost(...args: Parameters<GameHostsService['rejectHost']>) {
    return this.domain1.rejectHost(...args);
  }
  cancel(...args: Parameters<GameCancellationService['cancel']>) {
    return this.domain2.cancel(...args);
  }
  register(...args: Parameters<GameRegistrationService['register']>) {
    return this.domain3.register(...args);
  }
  promoteWaitlist(
    ...args: Parameters<GameRegistrationService['promoteWaitlist']>
  ) {
    return this.domain3.promoteWaitlist(...args);
  }
  checkIn(...args: Parameters<GameRegistrationService['checkIn']>) {
    return this.domain3.checkIn(...args);
  }
  complete(...args: Parameters<GameCompletionService['complete']>) {
    return this.domain4.complete(...args);
  }
  grantMatured(...args: Parameters<GameRewardsService['grantMatured']>) {
    return this.domain5.grantMatured(...args);
  }
}
