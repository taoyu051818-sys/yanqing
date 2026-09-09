import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import {
  CreateTrainingConsumeCorrectionDto,
  DecideTrainingConsumeCorrectionDto,
} from '../training.dto.js';
import { TrainingCorrectionsService } from './training-corrections.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingCorrectionsController {
  constructor(
    @Inject(TrainingCorrectionsService)
    private readonly corrections: TrainingCorrectionsService,
  ) {}

  @Get('consume-corrections')
  @Roles(
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  consumeCorrections(@CurrentUser() actor: AuthUser) {
    return this.corrections.listConsumeCorrections(actor);
  }

  @Post('consume-corrections')
  @Roles(AppRole.COACH, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  requestConsumeCorrection(
    @Body() dto: CreateTrainingConsumeCorrectionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.corrections.requestConsumeCorrection(dto, actor);
  }

  @Post('consume-corrections/:id/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approveConsumeCorrection(
    @Param('id') id: string,
    @Body() dto: DecideTrainingConsumeCorrectionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.corrections.approveConsumeCorrection(id, dto, actor);
  }

  @Post('consume-corrections/:id/reject')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  rejectConsumeCorrection(
    @Param('id') id: string,
    @Body() dto: DecideTrainingConsumeCorrectionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.corrections.rejectConsumeCorrection(id, dto, actor);
  }
}
