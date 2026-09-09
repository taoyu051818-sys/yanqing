import { GameCatalogService } from './catalog/games-catalog.service.js';
import { GameHostsService } from './hosts/games-hosts.service.js';
import { GameCancellationService } from './cancellation/games-cancellation.service.js';
import { GameRegistrationService } from './registration/games-registration.service.js';
import { GameCompletionService } from './completion/games-completion.service.js';
import { GameRewardsService } from './rewards/games-rewards.service.js';
import { Module } from '@nestjs/common';

import { GamesController } from './games.controller.js';

@Module({
  controllers: [GamesController],
  providers: [
    GameCatalogService,
    GameHostsService,
    GameCancellationService,
    GameRegistrationService,
    GameCompletionService,
    GameRewardsService,
  ],
  exports: [
    GameCatalogService,
    GameHostsService,
    GameCancellationService,
    GameRegistrationService,
    GameCompletionService,
    GameRewardsService,
  ],
})
export class GamesModule {}
