import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { TrainingBatchDto } from './training-batch.dto.js';
import { TrainingBatchService } from './training-batch.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training/sessions/:sessionId/batch')
export class TrainingBatchController {
  constructor(
    @Inject(TrainingBatchService) private readonly batch: TrainingBatchService,
  ) {}

  @Post('attendance')
  @Roles(AppRole.COACH, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  attendance(
    @Param('sessionId') id: string,
    @Body() dto: TrainingBatchDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.batch.execute(id, 'attendance', dto, actor);
  }

  @Post('proposal')
  @Roles(AppRole.COACH)
  proposal(
    @Param('sessionId') id: string,
    @Body() dto: TrainingBatchDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.batch.execute(id, 'proposal', dto, actor);
  }

  @Post('confirmation')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  confirmation(
    @Param('sessionId') id: string,
    @Body() dto: TrainingBatchDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.batch.execute(id, 'confirmation', dto, actor);
  }
}
