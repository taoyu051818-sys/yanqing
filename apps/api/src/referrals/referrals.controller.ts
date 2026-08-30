import { Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import { ReferralsService } from './referrals.service.js'

@ApiTags('单层推荐')
@ApiBearerAuth()
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me/rewards')
  mine(@CurrentUser() actor: AuthUser) {
    return this.referrals.myRewards(actor)
  }

  @Post('rewards/grant-matured')
  @Roles(AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  grant(@CurrentUser() actor: AuthUser) {
    return this.referrals.grantMatured(actor)
  }
}
