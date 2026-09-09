import { Inject, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CorrectScoreDto,
  CorrectEventPairingsDto,
  EventTeamCheckInDto,
  SubmitScoreDto,
} from '../events.dto.js';
import { EventParticipationService } from '../registration/event-participation.service.js';
import { EventCompetitionService } from './event-competition.service.js';

@ApiTags('瑞士积分赛事')
@ApiBearerAuth()
@Controller('events')
export class EventCompetitionController {
  constructor(
    @Inject(EventParticipationService)
    private readonly participation: EventParticipationService,
    @Inject(EventCompetitionService)
    private readonly competition: EventCompetitionService,
  ) {}

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
    @Body() dto: EventTeamCheckInDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.participation.checkIn(id, teamId, actor, dto);
  }

  @Post(':id/rounds/next')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  nextRound(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.competition.startNextRound(id, actor);
  }

  @Post(':id/rounds/:round/pairings/correct')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  correctPairings(
    @Param('id') id: string,
    @Param('round') round: string,
    @Body() dto: CorrectEventPairingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.competition.correctPairings(id, Number(round), dto, actor);
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
    return this.competition.submitScore(matchId, dto, actor);
  }

  @Post('matches/:matchId/correct')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  correct(
    @Param('matchId') matchId: string,
    @Body() dto: CorrectScoreDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.competition.correctScore(matchId, dto, actor);
  }

  @Post(':id/finish')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  finish(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.competition.finish(id, actor);
  }
}
