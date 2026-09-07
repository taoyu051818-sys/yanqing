import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { IsOptional, IsString, Matches } from 'class-validator'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Roles } from '../common/auth/auth.decorators.js'
import { AppRole } from '../generated/prisma/enums.js'
import { BossService } from './boss.service.js'
import { BossBriefingService } from './briefing.service.js'
class DateQuery {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string
}
@ApiTags('老板经营摘要')
@ApiBearerAuth()
@Roles(AppRole.ADMIN,AppRole.SUPER_ADMIN,AppRole.FINANCE)
@Controller('boss')
export class BossController {
  constructor(private readonly boss:BossService,private readonly briefings:BossBriefingService) {}
  @Get('summary') summary(@Query() query:DateQuery) { return this.boss.summary(query.date) }
  @Get('briefing') briefing(@Query() query:DateQuery) { return this.briefings.cached(query.date) }
  @Post('briefing') generate(@Body() body:DateQuery) { return this.briefings.generate(body.date) }
}
