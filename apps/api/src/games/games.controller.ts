import { Inject } from '@nestjs/common';
import { GameCatalogService } from './catalog/games-catalog.service.js';
import { GameHostsService } from './hosts/games-hosts.service.js';
import { GameCancellationService } from './cancellation/games-cancellation.service.js';
import { GameRegistrationService } from './registration/games-registration.service.js';
import { GameCompletionService } from './completion/games-completion.service.js';
import { GameRewardsService } from './rewards/games-rewards.service.js';
import { GAME_MANAGEMENT_ROLES } from '../common/auth/operation-scopes.js';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Public, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CancelGameDto,
  CreateGameDto,
  GameCheckInDto,
  PublishGameDto,
  RegisterGameDto,
  RejectHostDto,
  ReviewHostDto,
} from './games.dto.js';

@ApiTags('球局与主理人')
@ApiBearerAuth()
@Controller('games')
export class GamesController {
  constructor(
    @Inject(GameCatalogService)
    private readonly gamesGameCatalog: GameCatalogService,
    @Inject(GameHostsService) private readonly gamesGameHosts: GameHostsService,
    @Inject(GameCancellationService)
    private readonly gamesGameCancellation: GameCancellationService,
    @Inject(GameRegistrationService)
    private readonly gamesGameRegistration: GameRegistrationService,
    @Inject(GameCompletionService)
    private readonly gamesGameCompletion: GameCompletionService,
    @Inject(GameRewardsService)
    private readonly gamesGameRewards: GameRewardsService,
  ) {}

  @Get()
  list(@CurrentUser() actor: AuthUser) {
    return this.gamesGameCatalog.list(actor);
  }

  @Public()
  @Get('public')
  publicList() {
    return this.gamesGameCatalog.publicList();
  }

  @Get('managed')
  @Roles(...GAME_MANAGEMENT_ROLES)
  managed(@CurrentUser() actor: AuthUser) {
    return this.gamesGameCatalog.managed(actor);
  }

  @Post('hosts/apply')
  @Roles(AppRole.MEMBER)
  apply(@CurrentUser() actor: AuthUser) {
    return this.gamesGameHosts.applyHost(actor);
  }

  @Get('host-applications')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  hostApplications() {
    return this.gamesGameHosts.hostApplications();
  }

  // A shared link is readable before login; the roster is a separate,
  // authenticated projection and never inherits this route's public metadata.
  @Public()
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.gamesGameCatalog.detail(id);
  }

  @Get(':id/participants')
  participants(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.gamesGameCatalog.participants(id, actor);
  }

  @Post('hosts/:userId/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approve(
    @Param('userId') userId: string,
    @Body() dto: ReviewHostDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.gamesGameHosts.approveHost(userId, dto, actor);
  }

  @Post('hosts/:userId/reject')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  reject(
    @Param('userId') userId: string,
    @Body() dto: RejectHostDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.gamesGameHosts.rejectHost(userId, dto, actor);
  }

  @Post('rewards/grant-matured')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  grantMaturedRewards(@CurrentUser() actor: AuthUser) {
    return this.gamesGameRewards.grantMatured(actor);
  }

  @Post()
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateGameDto, @CurrentUser() actor: AuthUser) {
    return this.gamesGameCatalog.create(dto, actor);
  }

  @Post(':id/publish')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  publish(
    @Param('id') id: string,
    @Body() dto: PublishGameDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.gamesGameCatalog.publish(id, dto, actor);
  }

  @Post(':id/cancel')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelGameDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.gamesGameCancellation.cancel(id, dto, actor);
  }

  @Post(':id/register')
  register(
    @Param('id') id: string,
    @Body() dto: RegisterGameDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.gamesGameRegistration.register(id, dto, actor);
  }

  @Post(':id/promote-waitlist')
  @Roles(AppRole.HOST, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  promoteWaitlist(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.gamesGameRegistration.promoteWaitlist(id, actor);
  }

  @Post(':id/check-in/:userId')
  @Roles(AppRole.HOST, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  checkIn(
    @Param('id') id: string,
    @Param('userId') registrationId: string,
    @Body() dto: GameCheckInDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.gamesGameRegistration.checkIn(id, registrationId, actor, dto);
  }

  @Post(':id/complete')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  complete(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.gamesGameCompletion.complete(id, actor);
  }
}
