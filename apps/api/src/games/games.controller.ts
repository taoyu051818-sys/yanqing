import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  CancelGameDto,
  CreateGameDto,
  GameCheckInDto,
  PublishGameDto,
  RegisterGameDto,
  RejectHostDto,
  ReviewHostDto,
} from './games.dto.js'
import { GamesService } from './games.service.js'

@ApiTags('球局与主理人')
@ApiBearerAuth()
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get()
  list() {
    return this.games.list()
  }

  @Get('managed')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  managed(@CurrentUser() actor: AuthUser) {
    return this.games.managed(actor)
  }

  @Post('hosts/apply')
  @Roles(AppRole.MEMBER)
  apply(@CurrentUser() actor: AuthUser) {
    return this.games.applyHost(actor)
  }

  @Get('host-applications')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  hostApplications() {
    return this.games.hostApplications()
  }

  @Post('hosts/:userId/approve')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  approve(
    @Param('userId') userId: string,
    @Body() dto: ReviewHostDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.games.approveHost(userId, dto, actor)
  }

  @Post('hosts/:userId/reject')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  reject(
    @Param('userId') userId: string,
    @Body() dto: RejectHostDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.games.rejectHost(userId, dto, actor)
  }

  @Post('rewards/grant-matured')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  grantMaturedRewards(@CurrentUser() actor: AuthUser) {
    return this.games.grantMatured(actor)
  }

  @Post()
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  create(@Body() dto: CreateGameDto, @CurrentUser() actor: AuthUser) {
    return this.games.create(dto, actor)
  }

  @Post(':id/publish')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  publish(
    @Param('id') id: string,
    @Body() dto: PublishGameDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.games.publish(id, dto, actor)
  }

  @Post(':id/cancel')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelGameDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.games.cancel(id, dto, actor)
  }

  @Post(':id/register')
  register(
    @Param('id') id: string,
    @Body() dto: RegisterGameDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.games.register(id, dto, actor)
  }

  @Post(':id/promote-waitlist')
  @Roles(AppRole.HOST, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  promoteWaitlist(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.games.promoteWaitlist(id, actor)
  }

  @Post(':id/check-in/:userId')
  @Roles(AppRole.HOST, AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  checkIn(
    @Param('id') id: string,
    @Param('userId') registrationId: string,
    @Body() dto: GameCheckInDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.games.checkIn(id, registrationId, actor, dto)
  }

  @Post(':id/complete')
  @Roles(AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  complete(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.games.complete(id, actor)
  }
}
