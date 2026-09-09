import { Inject, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { PurchaseTrainingDto } from '../training.dto.js';
import { TrainingEnrollmentsService } from './training-enrollments.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingEnrollmentsController {
  constructor(
    @Inject(TrainingEnrollmentsService)
    private readonly enrollments: TrainingEnrollmentsService,
  ) {}

  @Post('purchase')
  purchase(@Body() dto: PurchaseTrainingDto, @CurrentUser() actor: AuthUser) {
    return this.enrollments.purchase(dto, actor);
  }

  @Get('enrollments')
  myEnrollments(@CurrentUser() actor: AuthUser) {
    return this.enrollments.listEnrollments(actor);
  }

  @Get('admin/enrollments')
  @Roles(
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  allEnrollments(@CurrentUser() actor: AuthUser) {
    return this.enrollments.listEnrollments(actor, true);
  }
}
