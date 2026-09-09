import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CreateTrainingSessionDto,
  TrainingSessionActionDto,
} from '../training.dto.js';
import { TrainingScheduleService } from './training-schedule.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingScheduleController {
  constructor(
    @Inject(TrainingScheduleService)
    private readonly schedule: TrainingScheduleService,
  ) {}

  @Get('sessions')
  @Roles(
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  sessions(@CurrentUser() actor: AuthUser) {
    return this.schedule.listSessions(actor);
  }

  @Post('sessions')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createSession(
    @Body() dto: CreateTrainingSessionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.schedule.createSession(dto, actor);
  }

  @Post('sessions/:sessionId/complete')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  complete(
    @Param('sessionId') sessionId: string,
    @CurrentUser() actor: AuthUser,
    @Body() dto: TrainingSessionActionDto = {},
  ) {
    return this.schedule.completeSession(sessionId, actor, dto);
  }
}
