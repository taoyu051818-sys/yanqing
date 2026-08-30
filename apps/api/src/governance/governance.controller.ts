import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  GovernanceUserQueryDto,
  ReviewRiskEventDto,
  RiskEventQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
} from './governance.dto.js'
import { GovernanceService } from './governance.service.js'

@ApiTags('组织权限与风险治理')
@ApiBearerAuth()
@Controller('governance')
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('users')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  users(@Query() query: GovernanceUserQueryDto, @CurrentUser() actor: AuthUser) {
    return this.governance.users(query, actor)
  }

  @Post('users/:id/roles')
  @Roles(AppRole.SUPER_ADMIN)
  setRoles(
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.governance.setUserRoles(id, dto, actor)
  }

  @Post('users/:id/status')
  @Roles(AppRole.SUPER_ADMIN)
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.governance.setUserStatus(id, dto, actor)
  }

  @Get('risk-events')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  risks(@Query() query: RiskEventQueryDto, @CurrentUser() actor: AuthUser) {
    return this.governance.riskEvents(query, actor)
  }

  @Post('risk-events/:id/review')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  reviewRisk(
    @Param('id') id: string,
    @Body() dto: ReviewRiskEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.governance.transitionRisk(id, 'REVIEW', dto, actor)
  }

  @Post('risk-events/:id/resolve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  resolveRisk(
    @Param('id') id: string,
    @Body() dto: ReviewRiskEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.governance.transitionRisk(id, 'RESOLVE', dto, actor)
  }

  @Post('risk-events/:id/dismiss')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  dismissRisk(
    @Param('id') id: string,
    @Body() dto: ReviewRiskEventDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.governance.transitionRisk(id, 'DISMISS', dto, actor)
  }
}
