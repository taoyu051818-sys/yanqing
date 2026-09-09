import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CancelEventRegistrationDto,
  RegisterEventTeamDto,
} from '../events.dto.js';
import { EventParticipationService } from './event-participation.service.js';
import { EventRegistrationService } from './event-registration.service.js';
import { EventWithdrawalService } from './event-withdrawal.service.js';

@ApiTags('瑞士积分赛事')
@ApiBearerAuth()
@Controller('events')
export class EventRegistrationController {
  constructor(
    @Inject(EventParticipationService)
    private readonly participation: EventParticipationService,
    @Inject(EventRegistrationService)
    private readonly registration: EventRegistrationService,
    @Inject(EventWithdrawalService)
    private readonly withdrawal: EventWithdrawalService,
  ) {}

  @Get(':id/registration/me')
  myRegistration(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.participation.myRegistration(id, actor);
  }

  @Post(':id/register')
  register(
    @Param('id') id: string,
    @Body() dto: RegisterEventTeamDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.registration.register(id, dto, actor);
  }

  @Post(':id/promote-waitlist')
  @Roles(AppRole.EVENT_MANAGER, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  promoteWaitlist(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.participation.promoteWaitlist(id, actor);
  }

  @Post(':id/registration/cancel')
  cancelRegistration(
    @Param('id') id: string,
    @Body() dto: CancelEventRegistrationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.withdrawal.cancelRegistration(id, dto, actor);
  }
}
