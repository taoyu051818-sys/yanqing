import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Public, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CancelEventDto,
  CancelEventRegistrationDto,
  CorrectScoreDto,
  CorrectEventPairingsDto,
  CreateEventDto,
  EventPartnerInviteCodeDto,
  EventTeamCheckInDto,
  IssueEventPrizeDto,
  PublishEventDto,
  ReceiveEventPrizeDto,
  RegisterEventTeamDto,
  CreateEventTeamInviteDto,
  AcceptEventTeamInviteDto,
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

  @Get('managed')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  managedList() {
    return this.events.managedList();
  }

  @Get('managed/:id')
  @Roles(
    AppRole.EVENT_MANAGER,
    AppRole.FRONT_DESK,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  managedDetail(@Param('id') id: string) {
    return this.events.managedDetail(id);
  }

  @Get(':id/registration/me')
  myRegistration(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.events.myRegistration(id, actor);
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
  create(@Body() dto: CreateEventDto, @CurrentUser() actor: AuthUser) {
    return this.events.create(dto, actor);
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

  @Post(':id/partner-invites')
  createPartnerInvite(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.events.createPartnerInvite(id, actor);
  }

  @Post(':id/team-invites')
  createTeamInvite(
    @Param('id') id: string,
    @Body() dto: CreateEventTeamInviteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.createTeamInvite(id, dto, actor);
  }

  @Public()
  @Post(':id/team-invites/preview')
  previewTeamInvite(
    @Param('id') id: string,
    @Body() dto: EventPartnerInviteCodeDto,
  ) {
    return this.events.previewTeamInvite(id, dto.partnerInviteCode);
  }

  @Post(':id/team-invites/context')
  teamInviteContext(
    @Param('id') id: string,
    @Body() dto: EventPartnerInviteCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.previewTeamInvite(id, dto.partnerInviteCode, actor);
  }

  @Post(':id/team-invites/accept')
  acceptTeamInvite(
    @Param('id') id: string,
    @Body() dto: AcceptEventTeamInviteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.acceptTeamInvite(id, dto, actor);
  }

  @Post(':id/partner-invites/preview')
  previewPartnerInvite(
    @Param('id') id: string,
    @Body() dto: EventPartnerInviteCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.previewPartnerInvite(id, dto.partnerInviteCode, actor);
  }

  @Post(':id/promote-waitlist')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  promoteWaitlist(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.events.promoteWaitlist(id, actor);
  }

  @Post(':id/registration/cancel')
  cancelRegistration(
    @Param('id') id: string,
    @Body() dto: CancelEventRegistrationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.cancelRegistration(id, dto, actor);
  }

  @Post(':id/cancel')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.cancel(id, dto, actor);
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
    @Body() dto: EventTeamCheckInDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.checkIn(id, teamId, actor, dto);
  }

  @Post(':id/rounds/next')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  nextRound(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.events.startNextRound(id, actor);
  }

  @Post(':id/rounds/:round/pairings/correct')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  correctPairings(
    @Param('id') id: string,
    @Param('round') round: string,
    @Body() dto: CorrectEventPairingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.events.correctPairings(id, Number(round), dto, actor);
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
