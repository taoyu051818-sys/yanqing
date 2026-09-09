import { Inject, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  EventPartnerInviteCodeDto,
  CreateEventTeamInviteDto,
  AcceptEventTeamInviteDto,
} from '../events.dto.js';
import { EventInvitationsService } from './event-invitations.service.js';

@ApiTags('瑞士积分赛事')
@ApiBearerAuth()
@Controller('events')
export class EventInvitationsController {
  constructor(
    @Inject(EventInvitationsService)
    private readonly invitations: EventInvitationsService,
  ) {}

  @Post(':id/partner-invites')
  createPartnerInvite(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.invitations.createPartnerInvite(id, actor);
  }

  @Post(':id/team-invites')
  createTeamInvite(
    @Param('id') id: string,
    @Body() dto: CreateEventTeamInviteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.invitations.createTeamInvite(id, dto, actor);
  }

  @Public()
  @Post(':id/team-invites/preview')
  previewTeamInvite(
    @Param('id') id: string,
    @Body() dto: EventPartnerInviteCodeDto,
  ) {
    return this.invitations.previewTeamInvite(id, dto.partnerInviteCode);
  }

  @Post(':id/team-invites/context')
  teamInviteContext(
    @Param('id') id: string,
    @Body() dto: EventPartnerInviteCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.invitations.previewTeamInvite(id, dto.partnerInviteCode, actor);
  }

  @Post(':id/team-invites/accept')
  acceptTeamInvite(
    @Param('id') id: string,
    @Body() dto: AcceptEventTeamInviteDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.invitations.acceptTeamInvite(id, dto, actor);
  }

  @Post(':id/partner-invites/preview')
  previewPartnerInvite(
    @Param('id') id: string,
    @Body() dto: EventPartnerInviteCodeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.invitations.previewPartnerInvite(
      id,
      dto.partnerInviteCode,
      actor,
    );
  }
}
