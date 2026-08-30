import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CloseFrontDeskShiftDto,
  FrontDeskShiftHistoryQueryDto,
  OpenFrontDeskShiftDto,
  ReviewFrontDeskShiftVarianceDto,
} from './frontdesk-shifts.dto.js';
import { FrontDeskShiftsService } from './frontdesk-shifts.service.js';

@ApiTags('前台班次与交接')
@ApiBearerAuth()
@Controller('operations/shifts')
@Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class FrontDeskShiftsController {
  constructor(private readonly shifts: FrontDeskShiftsService) {}

  @Get('current')
  current(@CurrentUser() actor: AuthUser) {
    return this.shifts.current(actor);
  }

  @Get('history')
  @Roles(
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  )
  history(
    @Query() query: FrontDeskShiftHistoryQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.shifts.history(query, actor);
  }

  @Post('open')
  open(@Body() dto: OpenFrontDeskShiftDto, @CurrentUser() actor: AuthUser) {
    return this.shifts.open(dto, actor);
  }

  @Post(':id/close')
  close(
    @Param('id') id: string,
    @Body() dto: CloseFrontDeskShiftDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.shifts.close(id, dto, actor);
  }

  @Post(':id/review-variance')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  reviewVariance(
    @Param('id') id: string,
    @Body() dto: ReviewFrontDeskShiftVarianceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.shifts.reviewVariance(id, dto, actor);
  }
}
