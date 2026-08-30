import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsInt, IsOptional, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { WorkItemsService } from './work-items.service.js'

class WorkItemsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50
}

@ApiTags('经营待办')
@ApiBearerAuth()
@Controller('work-items')
@Roles(
  AppRole.FRONT_DESK,
  AppRole.COACH,
  AppRole.EVENT_MANAGER,
  AppRole.HOST,
  AppRole.MERCHANT,
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
)
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() query: WorkItemsQueryDto) {
    return this.workItems.list(actor, query.limit)
  }
}
