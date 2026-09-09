import { MembershipProductsService } from './products/memberships-products.service.js';
import { MembershipRechargePlansService } from './recharge-plans/memberships-recharge-plans.service.js';
import { MembershipPurchasesService } from './purchases/memberships-purchases.service.js';
import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller.js';

@Module({
  controllers: [MembershipsController],
  providers: [
    MembershipProductsService,
    MembershipRechargePlansService,
    MembershipPurchasesService,
  ],
})
export class MembershipsModule {}
