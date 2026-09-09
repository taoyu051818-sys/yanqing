import { Inject } from '@nestjs/common';
import { MembershipProductsService } from './products/memberships-products.service.js';
import { MembershipRechargePlansService } from './recharge-plans/memberships-recharge-plans.service.js';
import { MembershipPurchasesService } from './purchases/memberships-purchases.service.js';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Roles } from '../common/auth/auth.decorators.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';
import {
  CreateMembershipProductDto,
  CreateMembershipProductVersionDto,
  CreateRechargeDto,
  CreateRechargePlanDto,
  PurchaseMembershipDto,
  SetMembershipProductStatusDto,
  SetRechargePlanStatusDto,
} from './memberships.dto.js';

@ApiTags('会员卡与充值')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(
    @Inject(MembershipProductsService)
    private readonly membershipsMembershipProducts: MembershipProductsService,
    @Inject(MembershipRechargePlansService)
    private readonly membershipsMembershipRechargePlans: MembershipRechargePlansService,
    @Inject(MembershipPurchasesService)
    private readonly membershipsMembershipPurchases: MembershipPurchasesService,
  ) {}

  @Get('products')
  products() {
    return this.membershipsMembershipProducts.products();
  }

  @Get('products/manage')
  @Roles(AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  manageProducts(@CurrentUser() actor: AuthUser) {
    return this.membershipsMembershipProducts.manageProducts(actor);
  }

  @Post('products')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createProduct(
    @Body() dto: CreateMembershipProductDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membershipsMembershipProducts.createProduct(dto, actor);
  }

  @Post('products/:id/versions')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createProductVersion(
    @Param('id') id: string,
    @Body() dto: CreateMembershipProductVersionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membershipsMembershipProducts.createProductVersion(
      id,
      dto,
      actor,
    );
  }

  @Post('products/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setProductStatus(
    @Param('id') id: string,
    @Body() dto: SetMembershipProductStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membershipsMembershipProducts.setProductStatus(id, dto, actor);
  }

  @Get('recharge-plans')
  rechargePlans() {
    return this.membershipsMembershipRechargePlans.rechargePlans();
  }

  @Get('recharge-plans/manage')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  manageRechargePlans(@CurrentUser() actor: AuthUser) {
    return this.membershipsMembershipRechargePlans.manageRechargePlans(actor);
  }

  @Post('recharge-plans')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  createRechargePlan(
    @Body() dto: CreateRechargePlanDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membershipsMembershipRechargePlans.createRechargePlan(
      dto,
      actor,
    );
  }

  @Post('recharge-plans/:id/status')
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  setRechargePlanStatus(
    @Param('id') id: string,
    @Body() dto: SetRechargePlanStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.membershipsMembershipRechargePlans.setRechargePlanStatus(
      id,
      dto,
      actor,
    );
  }

  @Post('purchase')
  purchase(@Body() dto: PurchaseMembershipDto, @CurrentUser() actor: AuthUser) {
    return this.membershipsMembershipPurchases.purchase(dto, actor);
  }

  @Post('recharge')
  recharge(@Body() dto: CreateRechargeDto, @CurrentUser() actor: AuthUser) {
    return this.membershipsMembershipPurchases.recharge(dto, actor);
  }
}
