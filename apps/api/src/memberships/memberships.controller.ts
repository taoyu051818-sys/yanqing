import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js'
import type { AuthUser } from '../common/auth/auth-user.js'
import { AppRole } from '../generated/prisma/enums.js'
import {
  CreateMembershipProductDto,
  CreateMembershipProductVersionDto,
  CreateRechargeDto,
  CreateRechargePlanDto,
  PurchaseMembershipDto,
  SetMembershipProductStatusDto,
  SetRechargePlanStatusDto,
} from './memberships.dto.js'
import { MembershipsService } from './memberships.service.js'

@ApiTags('会员卡与充值')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('products')
  products() { return this.memberships.products() }

  @Get('products/manage')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  manageProducts(@CurrentUser() actor: AuthUser) {
    return this.memberships.manageProducts(actor)
  }

  @Post('products')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createProduct(
    @Body() dto: CreateMembershipProductDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.memberships.createProduct(dto, actor)
  }

  @Post('products/:id/versions')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createProductVersion(
    @Param('id') id: string,
    @Body() dto: CreateMembershipProductVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.memberships.createProductVersion(id, dto, actor)
  }

  @Post('products/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setProductStatus(
    @Param('id') id: string,
    @Body() dto: SetMembershipProductStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.memberships.setProductStatus(id, dto, actor)
  }

  @Get('recharge-plans')
  rechargePlans() { return this.memberships.rechargePlans() }

  @Get('recharge-plans/manage')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  manageRechargePlans(@CurrentUser() actor: AuthUser) {
    return this.memberships.manageRechargePlans(actor)
  }

  @Post('recharge-plans')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createRechargePlan(
    @Body() dto: CreateRechargePlanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.memberships.createRechargePlan(dto, actor)
  }

  @Post('recharge-plans/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setRechargePlanStatus(
    @Param('id') id: string,
    @Body() dto: SetRechargePlanStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.memberships.setRechargePlanStatus(id, dto, actor)
  }

  @Post('purchase')
  purchase(@Body() dto: PurchaseMembershipDto, @CurrentUser() actor: AuthUser) {
    return this.memberships.purchase(dto, actor)
  }

  @Post('recharge')
  recharge(@Body() dto: CreateRechargeDto, @CurrentUser() actor: AuthUser) {
    return this.memberships.recharge(dto, actor)
  }
}
