import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { CreateParameterDto, ParameterQueryDto } from './configuration.dto.js'
import { ConfigurationService } from './configuration.service.js'

@ApiTags('参数配置')
@ApiBearerAuth()
@Controller('parameters')
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Get()
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  list(@Query() query: ParameterQueryDto) {
    return this.configuration.list(query)
  }

  @Get(':key')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  resolve(@Param('key') key: string, @Query('at') at?: string) {
    return this.configuration.resolve(key, at ? new Date(at) : new Date())
  }

  @Post()
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateParameterDto, @CurrentUser() actor: AuthUser) {
    return this.configuration.createVersion(dto, actor)
  }
}
