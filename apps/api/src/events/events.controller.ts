import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CorrectScoreDto,
  CreateEventDto,
  IssueEventPrizeDto,
  PublishEventDto,
  ReceiveEventPrizeDto,
  RegisterEventTeamDto,
  SubmitScoreDto,
} from './events.dto.js';
import { EventsService } from './events.service.js';

@ApiTags('瑞士积分赛事')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list() {
    return this.events.list();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.events.detail(id);
  }

  @Get(':id/prizes')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  prizes(@Param('id') id: string) {
    return this.events.listPrizeAwards(id);
  }

  @Post()
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }

  @Post(':id/publish')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  publish(
    @Param('id') id: string,
    @Body() dto: PublishEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.publish(id, dto, actor);
  }

  @Post(':id/register')
  register(
    @Param('id') id: string,
    @Body() dto: RegisterEventTeamDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.register(id, dto, actor);
  }

  @Post(':id/teams/:teamId/check-in')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  checkIn(
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.checkIn(id, teamId, actor);
  }

  @Post(':id/rounds/next')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  nextRound(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.events.startNextRound(id, actor);
  }

  @Post('matches/:matchId/score')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  score(
    @Param('matchId') matchId: string,
    @Body() dto: SubmitScoreDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.submitScore(matchId, dto, actor);
  }

  @Post('matches/:matchId/correct')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  correct(
    @Param('matchId') matchId: string,
    @Body() dto: CorrectScoreDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.correctScore(matchId, dto, actor);
  }

  @Post(':id/finish')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  finish(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.events.finish(id, actor);
  }

  @Post(':id/prizes')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  issuePrize(
    @Param('id') id: string,
    @Body() dto: IssueEventPrizeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.issuePrize(id, dto, actor);
  }

  @Post(':id/prizes/:awardId/receive')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  receivePrize(
    @Param('id') id: string,
    @Param('awardId') awardId: string,
    @Body() dto: ReceiveEventPrizeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.receivePrize(id, awardId, dto, actor);
  }
}
