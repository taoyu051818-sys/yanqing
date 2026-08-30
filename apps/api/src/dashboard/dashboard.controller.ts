import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { Roles } from '../common/auth/auth.decorators.js'
import { AppRole } from '../generated/prisma/enums.js'
import { DashboardService } from './dashboard.service.js'

@ApiTags('老板驾驶舱')
@ApiBearerAuth()
@Controller('dashboard')
@Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@Query('periodStart') start?: string, @Query('periodEnd') end?: string) {
    return this.dashboard.overview(start ? new Date(start) : undefined, end ? new Date(end) : undefined)
  }
}
