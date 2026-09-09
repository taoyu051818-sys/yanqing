import { Inject } from '@nestjs/common';
import { TrainingTrialBookingService } from './trials/booking/training-trials-booking.service.js';
import { TrainingTrialFollowUpService } from './trials/follow-up/training-trials-follow-up.service.js';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  AssessTrainingTrialDto,
  ConvertTrainingTrialDto,
  CreateTrainingTrialDto,
  CreateYouthTrainingRuleDto,
  DecideYouthTrainingRuleDto,
  TrainingTrialActionDto,
  TrainingTrialQueryDto,
  YouthTrainingRuleQueryDto,
} from './training-operations.dto.js';

import { YouthTrainingRulesService } from './youth-training-rules.service.js';

@ApiTags('培训试听')
@ApiBearerAuth()
@Controller('training/trials')
export class TrainingTrialsController {
  constructor(
    @Inject(TrainingTrialBookingService)
    private readonly trialsTrainingTrialBooking: TrainingTrialBookingService,
    @Inject(TrainingTrialFollowUpService)
    private readonly trialsTrainingTrialFollowUp: TrainingTrialFollowUpService,
  ) {}

  @Get('mine')
  mine(@Query() query: TrainingTrialQueryDto, @CurrentUser() actor: AuthUser) {
    return this.trialsTrainingTrialBooking.list(query, actor, true);
  }

  @Get()
  @Roles(AppRole.COACH, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  list(@Query() query: TrainingTrialQueryDto, @CurrentUser() actor: AuthUser) {
    return this.trialsTrainingTrialBooking.list(query, actor);
  }

  @Post()
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateTrainingTrialDto, @CurrentUser() actor: AuthUser) {
    return this.trialsTrainingTrialBooking.create(dto, actor);
  }

  @Post(':id/check-in')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  checkIn(
    @Param('id') id: string,
    @Body() dto: TrainingTrialActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trialsTrainingTrialFollowUp.checkIn(id, dto, actor);
  }

  @Post(':id/no-show')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  noShow(
    @Param('id') id: string,
    @Body() dto: TrainingTrialActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trialsTrainingTrialFollowUp.noShow(id, dto, actor);
  }

  @Post(':id/assess')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  assess(
    @Param('id') id: string,
    @Body() dto: AssessTrainingTrialDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trialsTrainingTrialFollowUp.assess(id, dto, actor);
  }

  @Post(':id/convert')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertTrainingTrialDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trialsTrainingTrialFollowUp.convert(id, dto, actor);
  }

  @Post(':id/lost')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  lost(
    @Param('id') id: string,
    @Body() dto: TrainingTrialActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trialsTrainingTrialFollowUp.lost(id, dto, actor);
  }

  @Post(':id/cancel')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancel(
    @Param('id') id: string,
    @Body() dto: TrainingTrialActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.trialsTrainingTrialFollowUp.cancel(id, dto, actor);
  }
}

@ApiTags('青少年培训监管')
@ApiBearerAuth()
@Controller('training/youth-rules')
export class YouthTrainingRulesController {
  constructor(private readonly rules: YouthTrainingRulesService) {}

  @Get('active')
  active() {
    return this.rules.active();
  }

  @Get()
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  list(
    @Query() query: YouthTrainingRuleQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rules.list(query, actor);
  }

  @Post()
  @Roles(AppRole.ADMIN)
  create(
    @Body() dto: CreateYouthTrainingRuleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rules.create(dto, actor);
  }

  @Post(':id/publish')
  @Roles(AppRole.SUPER_ADMIN)
  publish(
    @Param('id') id: string,
    @Body() dto: DecideYouthTrainingRuleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rules.publish(id, dto, actor);
  }

  @Post(':id/reject')
  @Roles(AppRole.SUPER_ADMIN)
  reject(
    @Param('id') id: string,
    @Body() dto: DecideYouthTrainingRuleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.rules.reject(id, dto, actor);
  }
}
