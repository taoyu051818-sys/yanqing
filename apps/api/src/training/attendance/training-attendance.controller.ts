import { Inject, Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/auth/auth.decorators.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/enums.js';
import { AttendanceActionDto, MakeupAttendanceDto } from '../training.dto.js';
import { TrainingAttendanceService } from './training-attendance.service.js';

@ApiTags('培训')
@ApiBearerAuth()
@Controller('training')
export class TrainingAttendanceController {
  constructor(
    @Inject(TrainingAttendanceService)
    private readonly attendance: TrainingAttendanceService,
  ) {}

  @Post('sessions/:sessionId/attendance')
  @Roles(AppRole.COACH, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  markAttendance(
    @Param('sessionId') sessionId: string,
    @Body() dto: AttendanceActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.attendance.markAttendance(sessionId, dto, actor);
  }

  @Post('sessions/:sessionId/attendance/makeup')
  @Roles(AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  scheduleMakeup(
    @Param('sessionId') sessionId: string,
    @Body() dto: MakeupAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.attendance.scheduleMakeup(sessionId, dto, actor);
  }
}
