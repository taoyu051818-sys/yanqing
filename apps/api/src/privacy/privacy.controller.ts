import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  CreateDataErasureRequestDto,
  DataErasureRequestQueryDto,
  DecideDataErasureRequestDto,
} from './privacy.dto.js'
import { PrivacyService } from './privacy.service.js'

@ApiTags('隐私与账号注销')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post('erasure-requests')
  request(@Body() dto: CreateDataErasureRequestDto, @CurrentUser() actor: AuthUser) {
    return this.privacy.create(dto, actor)
  }

  @Get('erasure-requests/me')
  mine(@CurrentUser() actor: AuthUser) {
    return this.privacy.listMine(actor)
  }

  @Post('erasure-requests/:id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: DecideDataErasureRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.privacy.cancel(id, dto, actor)
  }

  @Get('erasure-requests')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  list(@Query() query: DataErasureRequestQueryDto, @CurrentUser() actor: AuthUser) {
    return this.privacy.list(query, actor)
  }

  @Get('erasure-requests/:id/blockers')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  blockers(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.privacy.blockers(id, actor)
  }

  @Post('erasure-requests/:id/reject')
  @Roles(AppRole.SUPER_ADMIN)
  reject(
    @Param('id') id: string,
    @Body() dto: DecideDataErasureRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.privacy.reject(id, dto, actor)
  }

  @Post('erasure-requests/:id/complete')
  @Roles(AppRole.SUPER_ADMIN)
  complete(
    @Param('id') id: string,
    @Body() dto: DecideDataErasureRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.privacy.complete(id, dto, actor)
  }
}
