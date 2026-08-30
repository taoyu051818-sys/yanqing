import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'

import { Roles } from '../common/auth/auth.decorators.js'
import { AppRole } from '../generated/prisma/enums.js'
import { AuditService } from './audit.service.js'

class AuditQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20

  @IsOptional()
  @IsString()
  objectType?: string
}

@ApiTags('审计')
@ApiBearerAuth()
@Controller('audit-logs')
@Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.FINANCE)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query)
  }
}
