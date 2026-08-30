import { Controller, Get, Param, Res } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { ReportsService } from './reports.service.js'

@ApiTags('数据导出')
@ApiBearerAuth()
@Controller('reports')
@Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('exports/:scope.xlsx')
  async export(
    @Param('scope') scope: string,
    @CurrentUser() actor: AuthUser,
    @Res() response: Response,
  ) {
    const result = await this.reports.workbook(scope, actor)
    response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response.setHeader('content-disposition', `attachment; filename="${result.filename}"`)
    response.send(result.buffer)
  }
}
