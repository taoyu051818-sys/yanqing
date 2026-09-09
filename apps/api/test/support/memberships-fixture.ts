import type { PrismaService } from '../../src/database/prisma.service.js';
import { MembershipProductsService } from '../../src/memberships/products/memberships-products.service.js';
import { MembershipRechargePlansService } from '../../src/memberships/recharge-plans/memberships-recharge-plans.service.js';
import { MembershipPurchasesService } from '../../src/memberships/purchases/memberships-purchases.service.js';
/** Test-only composition of domain services; never loaded in production. */
export class MembershipsService {
  private readonly domain0: MembershipProductsService;
  private readonly domain1: MembershipRechargePlansService;
  private readonly domain2: MembershipPurchasesService;
  constructor(prisma: PrismaService) {
    this.domain0 = new MembershipProductsService(prisma);
    this.domain1 = new MembershipRechargePlansService(prisma);
    this.domain2 = new MembershipPurchasesService(prisma);
  }
  products(...args: Parameters<MembershipProductsService['products']>) {
    return this.domain0.products(...args);
  }
  manageProducts(
    ...args: Parameters<MembershipProductsService['manageProducts']>
  ) {
    return this.domain0.manageProducts(...args);
  }
  createProduct(
    ...args: Parameters<MembershipProductsService['createProduct']>
  ) {
    return this.domain0.createProduct(...args);
  }
  createProductVersion(
    ...args: Parameters<MembershipProductsService['createProductVersion']>
  ) {
    return this.domain0.createProductVersion(...args);
  }
  setProductStatus(
    ...args: Parameters<MembershipProductsService['setProductStatus']>
  ) {
    return this.domain0.setProductStatus(...args);
  }
  rechargePlans(
    ...args: Parameters<MembershipRechargePlansService['rechargePlans']>
  ) {
    return this.domain1.rechargePlans(...args);
  }
  manageRechargePlans(
    ...args: Parameters<MembershipRechargePlansService['manageRechargePlans']>
  ) {
    return this.domain1.manageRechargePlans(...args);
  }
  createRechargePlan(
    ...args: Parameters<MembershipRechargePlansService['createRechargePlan']>
  ) {
    return this.domain1.createRechargePlan(...args);
  }
  setRechargePlanStatus(
    ...args: Parameters<MembershipRechargePlansService['setRechargePlanStatus']>
  ) {
    return this.domain1.setRechargePlanStatus(...args);
  }
  purchase(...args: Parameters<MembershipPurchasesService['purchase']>) {
    return this.domain2.purchase(...args);
  }
  recharge(...args: Parameters<MembershipPurchasesService['recharge']>) {
    return this.domain2.recharge(...args);
  }
}
