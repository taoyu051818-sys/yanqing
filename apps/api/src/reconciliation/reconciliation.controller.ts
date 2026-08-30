import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { CloseReconciliationPeriodDto } from './reconciliation.dto.js'
import { ReconciliationService } from './reconciliation.service.js'

@ApiTags('日结与账期关账')
@ApiBearerAuth()
@Controller('reconciliation')
@Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('periods/:date')
  get(@Param('date') date: string, @CurrentUser() actor: AuthUser) {
    return this.reconciliation.get(date, actor)
  }

  @Post('periods/:date/close')
  close(
    @Param('date') date: string,
    @Body() dto: CloseReconciliationPeriodDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reconciliation.close(date, dto, actor)
  }
}
