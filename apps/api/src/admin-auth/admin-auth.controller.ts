import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common'
import { IsString, Matches } from 'class-validator'
import type { Request, Response } from 'express'
import { CurrentUser, Public, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { ADMIN_ROLES, AdminAuthService } from './admin-auth.service.js'

export class ScanKeyDto { @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) scanSecret: string }
@Controller('admin-auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}
  @Public() @Post('challenges')
  async create(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.createChallenge(request)
    response.cookie(this.auth.cookieName('login'), result.browserSecret, this.auth.cookieOptions(120000))
    response.setHeader('Cache-Control', 'no-store')
    return result.data
  }
  @Public() @Get('challenges/:id')
  status(@Param('id') id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store')
    return this.auth.challengeStatus(id, this.auth.cookie(request, 'login'))
  }
  @Public() @Post('challenges/:id/cancel')
  cancel(@Param('id') id: string, @Req() request: Request) {
    this.auth.assertOrigin(request)
    return this.auth.cancelChallenge(id, this.auth.cookie(request, 'login'))
  }
  @Public() @Post('challenges/:id/exchange')
  async exchange(@Param('id') id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.auth.assertOrigin(request)
    const result = await this.auth.exchange(id, this.auth.cookie(request, 'login'))
    response.cookie(this.auth.cookieName('session'), result.token, this.auth.cookieOptions(result.maxAge))
    response.clearCookie(this.auth.cookieName('login'), this.auth.cookieOptions(0))
    response.setHeader('Cache-Control', 'no-store')
    return result.data
  }
  @Post('requests/:id/inspect') @Roles(...ADMIN_ROLES)
  inspect(@Param('id') id: string, @Body() body: ScanKeyDto, @CurrentUser() actor: AuthUser) { return this.auth.inspectChallenge(id, body.scanSecret, actor) }
  @Post('requests/:id/approve') @Roles(...ADMIN_ROLES)
  approve(@Param('id') id: string, @Body() body: ScanKeyDto, @CurrentUser() actor: AuthUser) { return this.auth.decide(id, body.scanSecret, actor, true) }
  @Post('requests/:id/reject') @Roles(...ADMIN_ROLES)
  reject(@Param('id') id: string, @Body() body: ScanKeyDto, @CurrentUser() actor: AuthUser) { return this.auth.decide(id, body.scanSecret, actor, false) }
  @Get('me') @Roles(...ADMIN_ROLES)
  me(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store')
    return this.auth.sessionInfo(this.auth.cookie(request, 'session'))
  }
  @Get('sessions') @Roles(...ADMIN_ROLES)
  sessions(@CurrentUser() actor: AuthUser) { return this.auth.listSessions(actor) }
  @Post('sessions/:id/revoke') @Roles(...ADMIN_ROLES)
  revoke(@Param('id') id: string, @CurrentUser() actor: AuthUser) { return this.auth.revoke(id, actor) }
  @Post('logout') @Roles(...ADMIN_ROLES)
  async logout(@CurrentUser() actor: AuthUser, @Res({ passthrough: true }) response: Response) {
    if (actor.adminSessionId) await this.auth.revoke(actor.adminSessionId, actor)
    response.clearCookie(this.auth.cookieName('session'), this.auth.cookieOptions(0))
    return { loggedOut: true }
  }
}
