import { Inject, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  ConfirmTrainingConsumeDto,
  ConsumeTrainingDto,
} from '../training.dto.js';
import { TrainingConsumptionService } from './training-consumption.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingConsumptionController {
  constructor(
    @Inject(TrainingConsumptionService)
    private readonly consumption: TrainingConsumptionService,
  ) {}

  @Post('sessions/:sessionId/consume')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  consume(
    @Param('sessionId') sessionId: string,
    @Body() dto: ConsumeTrainingDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.consumption.consume(sessionId, dto, actor);
  }

  @Post('sessions/:sessionId/consume/confirm')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmConsume(
    @Param('sessionId') sessionId: string,
    @Body() dto: ConfirmTrainingConsumeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.consumption.confirmConsume(sessionId, dto, actor);
  }
}
