import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { CreateRechargeDto, PurchaseMembershipDto } from './memberships.dto.js'
import { MembershipsService } from './memberships.service.js'

@ApiTags('会员卡与充值')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('products')
  products() { return this.memberships.products() }

  @Post('purchase')
  purchase(@Body() dto: PurchaseMembershipDto, @CurrentUser() actor: AuthUser) {
    return this.memberships.purchase(dto, actor)
  }

  @Post('recharge')
  recharge(@Body() dto: CreateRechargeDto, @CurrentUser() actor: AuthUser) {
    return this.memberships.recharge(dto, actor)
  }
}
