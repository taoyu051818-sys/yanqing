import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import {
  Global,
  Module,
  RequestMethod,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { YouthTrainingRulesService } from '../src/training/youth-training-rules.service.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../src/common/auth/auth.decorators.js';
import { AllianceModule } from '../src/alliance/alliance.module.js';
import { GamesModule } from '../src/games/games.module.js';
import { GovernanceModule } from '../src/governance/governance.module.js';
import { InventoryModule } from '../src/inventory/inventory.module.js';
import { MembersModule } from '../src/members/members.module.js';
import { MembershipsModule } from '../src/memberships/memberships.module.js';
import { OrdersModule } from '../src/orders/orders.module.js';
import { TrainingModule } from '../src/training/training.module.js';
import { VenuesModule } from '../src/venues/venues.module.js';
import { AllianceController } from '../src/alliance/alliance.controller.js';
import { GamesController } from '../src/games/games.controller.js';
import { GovernanceController } from '../src/governance/governance.controller.js';
import { ConsignmentSettlementController } from '../src/inventory/consignment-settlement.controller.js';
import { InventoryController } from '../src/inventory/inventory.controller.js';
import { MembersController } from '../src/members/members.controller.js';
import { MembershipsController } from '../src/memberships/memberships.controller.js';
import { OrdersController } from '../src/orders/orders.controller.js';
import { TrainingTrialsController } from '../src/training/training-operations.controller.js';
import { VenuesController } from '../src/venues/venues.controller.js';
import { InventorySuppliersService } from '../src/inventory/suppliers/inventory-operations-suppliers.service.js';
import { InventoryLocationsService } from '../src/inventory/locations/inventory-operations-locations.service.js';
import { InventoryPurchasingService } from '../src/inventory/purchasing/inventory-operations-purchasing.service.js';
import { InventoryStocktakingService } from '../src/inventory/stocktaking/inventory-operations-stocktaking.service.js';
import { InventoryMovementsService } from '../src/inventory/movements/inventory-operations-movements.service.js';
import { InventoryCatalogService } from '../src/inventory/catalog/inventory-catalog.service.js';
import { InventoryTransactionsService } from '../src/inventory/transactions/inventory-transactions.service.js';
import { ConsignmentLedgerService } from '../src/inventory/consignment/ledger/consignment-settlement-ledger.service.js';
import { ConsignmentQueriesService } from '../src/inventory/consignment/queries/consignment-settlement-queries.service.js';
import { ConsignmentStatementsService } from '../src/inventory/consignment/statements/consignment-settlement-statements.service.js';
import { ConsignmentWorkflowService } from '../src/inventory/consignment/workflow/consignment-settlement-workflow.service.js';
import { GameCatalogService } from '../src/games/catalog/games-catalog.service.js';
import { GameHostsService } from '../src/games/hosts/games-hosts.service.js';
import { GameCancellationService } from '../src/games/cancellation/games-cancellation.service.js';
import { GameRegistrationService } from '../src/games/registration/games-registration.service.js';
import { GameCompletionService } from '../src/games/completion/games-completion.service.js';
import { GameRewardsService } from '../src/games/rewards/games-rewards.service.js';
import { MemberDirectoryService } from '../src/members/directory/members-directory.service.js';
import { MemberLeadsService } from '../src/members/leads/members-leads.service.js';
import { MemberLeadReportingService } from '../src/members/lead-reporting/members-lead-reporting.service.js';
import { MemberAccountsService } from '../src/members/accounts/members-accounts.service.js';
import { MemberReferralsService } from '../src/members/referrals/members-referrals.service.js';
import { VenueAvailabilityService } from '../src/venues/availability/venues-availability.service.js';
import { VenueClosuresService } from '../src/venues/closures/venues-closures.service.js';
import { VenueBookingService } from '../src/venues/booking/venues-booking.service.js';
import { VenueFulfillmentService } from '../src/venues/fulfillment/venues-fulfillment.service.js';
import { VenuePricingService } from '../src/venues/pricing/venues-pricing.service.js';
import { GovernanceUsersService } from '../src/governance/users/governance-users.service.js';
import { GovernanceRisksService } from '../src/governance/risks/governance-risks.service.js';
import { MembershipProductsService } from '../src/memberships/products/memberships-products.service.js';
import { MembershipRechargePlansService } from '../src/memberships/recharge-plans/memberships-recharge-plans.service.js';
import { MembershipPurchasesService } from '../src/memberships/purchases/memberships-purchases.service.js';
import { AllianceMerchantsService } from '../src/alliance/merchants/alliance-merchants.service.js';
import { AllianceTemplatesService } from '../src/alliance/templates/alliance-templates.service.js';
import { AllianceCouponsService } from '../src/alliance/coupons/alliance-coupons.service.js';
import { AllianceSettlementsService } from '../src/alliance/settlements/alliance-settlements.service.js';
import { TrainingTrialBookingService } from '../src/training/trials/booking/training-trials-booking.service.js';
import { TrainingTrialFollowUpService } from '../src/training/trials/follow-up/training-trials-follow-up.service.js';
import { OrderQueriesService } from '../src/orders/queries/orders-queries.service.js';
import { OrderPaymentsService } from '../src/orders/payments/orders-payments.service.js';
import { OrderRefundRequestsService } from '../src/orders/refund-requests/orders-refund-requests.service.js';
import { OrderRefundReviewService } from '../src/orders/refund-review/orders-refund-review.service.js';
import { PendingOrdersService } from '../src/orders/pending/orders-pending.service.js';
const controllers: Record<string, Type> = {
  AllianceController,
  GamesController,
  GovernanceController,
  ConsignmentSettlementController,
  InventoryController,
  MembersController,
  MembershipsController,
  OrdersController,
  TrainingTrialsController,
  VenuesController,
};
const providers: Record<string, Type> = {
  InventorySuppliersService,
  InventoryLocationsService,
  InventoryPurchasingService,
  InventoryStocktakingService,
  InventoryMovementsService,
  InventoryCatalogService,
  InventoryTransactionsService,
  ConsignmentLedgerService,
  ConsignmentQueriesService,
  ConsignmentStatementsService,
  ConsignmentWorkflowService,
  GameCatalogService,
  GameHostsService,
  GameCancellationService,
  GameRegistrationService,
  GameCompletionService,
  GameRewardsService,
  MemberDirectoryService,
  MemberLeadsService,
  MemberLeadReportingService,
  MemberAccountsService,
  MemberReferralsService,
  VenueAvailabilityService,
  VenueClosuresService,
  VenueBookingService,
  VenueFulfillmentService,
  VenuePricingService,
  GovernanceUsersService,
  GovernanceRisksService,
  MembershipProductsService,
  MembershipRechargePlansService,
  MembershipPurchasesService,
  AllianceMerchantsService,
  AllianceTemplatesService,
  AllianceCouponsService,
  AllianceSettlementsService,
  TrainingTrialBookingService,
  TrainingTrialFollowUpService,
  OrderQueriesService,
  OrderPaymentsService,
  OrderRefundRequestsService,
  OrderRefundReviewService,
  PendingOrdersService,
};
interface RouteContract {
  controller: string;
  method: string;
  verb: string;
  path: string;
  roles: string[];
  isPublic: boolean;
  provider: string;
  serviceMethod: string;
}
// Captured from the pre-split controllers: changes require explicit API review.
const routes: RouteContract[] = JSON.parse(
  readFileSync(
    new URL('./fixtures/remaining-domain-routes.json', import.meta.url),
    'utf8',
  ),
);
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: ConfigService, useValue: { get: () => undefined } },
  ],
  exports: [PrismaService, ConfigService],
})
class TestDatabaseModule {}

describe('functional domain module wiring and HTTP contracts', () => {
  let app: INestApplication;
  const spies = new Map<string, ReturnType<typeof vi.spyOn>>();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TestDatabaseModule,
        AllianceModule,
        GamesModule,
        GovernanceModule,
        InventoryModule,
        MembersModule,
        MembershipsModule,
        OrdersModule,
        TrainingModule,
        VenuesModule,
      ],
    })
      .overrideProvider(YouthTrainingRulesService)
      .useValue({})
      .compile();
    // Keep real domain providers and controllers; stub only command execution.
    // Database integration suites cover the actual commands and transactions.
    for (const route of routes) {
      const key = `${route.provider}.${route.serviceMethod}`;
      if (spies.has(key)) continue;
      const provider = module.get<
        Record<string, (...args: unknown[]) => unknown>
      >(providers[route.provider]);
      spies.set(
        key,
        vi
          .spyOn(provider, route.serviceMethod)
          .mockImplementation(() => ({ handledBy: key })),
      );
    }
    vi.spyOn(
      module.get(PendingOrdersService),
      'onApplicationBootstrap',
    ).mockImplementation(() => {});
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(
      (
        req: Request & { user?: unknown },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = {
          sub: 'domain-test-actor',
          roles: [req.get('x-test-role') || 'SUPER_ADMIN'],
        };
        next();
      },
    );
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('preserves all 152 route, role and public-access declarations with no additions or omissions', () => {
    const actual: object[] = [];
    for (const [name, controller] of Object.entries(controllers)) {
      for (const method of Object.getOwnPropertyNames(controller.prototype)) {
        if (method === 'constructor') continue;
        const handler = controller.prototype[method];
        const verb = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue;
        actual.push({
          controller: name,
          method,
          verb: RequestMethod[verb],
          path: [
            '/api/v1',
            Reflect.getMetadata(PATH_METADATA, controller),
            Reflect.getMetadata(PATH_METADATA, handler),
          ]
            .join('/')
            .replace(/\/+/g, '/')
            .replace(/\/$/, ''),
          roles: Reflect.getMetadata(ROLES_KEY, handler) || [],
          isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        });
      }
    }
    const expected = routes.map(
      ({ controller, method, verb, path, roles, isPublic }) => ({
        controller,
        method,
        verb,
        path,
        roles,
        isPublic,
      }),
    );
    const sort = (items: object[]) =>
      items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(actual).toHaveLength(152);
    expect(sort(actual)).toEqual(sort(expected));
    expect(
      new Set(routes.map((route) => `${route.verb} ${route.path}`)).size,
    ).toBe(152);
  });

  it('dispatches every existing HTTP route to its owning domain provider, including static routes', async () => {
    for (const route of routes) {
      vi.clearAllMocks();
      const path = route.path
        .replace(/:round\b/g, '1')
        .replace(/:[a-zA-Z]+/g, 'fixture-id');
      const server = request(app.getHttpServer());
      const call =
        route.verb === 'GET'
          ? server.get(path)
          : route.verb === 'PATCH'
            ? server.patch(path)
            : server.post(path);
      const response = await call
        .set('x-test-role', route.roles[0] || 'SUPER_ADMIN')
        .send({
          partnerInviteCode: 'fixture-code',
          date: '2026-09-09',
        });
      const key = `${route.provider}.${route.serviceMethod}`;
      expect(response.status, `${route.verb} ${path}`).toBe(
        route.verb === 'POST' ? 201 : 200,
      );
      expect(response.body, `${route.verb} ${path}`).toEqual({
        handledBy: key,
      });
      expect(spies.get(key)).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects ordinary members before invoking protected domain commands', async () => {
    for (const route of routes.filter(
      (route) => route.roles.length && !route.roles.includes('MEMBER'),
    )) {
      vi.clearAllMocks();
      const path = route.path
        .replace(/:round\b/g, '1')
        .replace(/:[a-zA-Z]+/g, 'fixture-id');
      const server = request(app.getHttpServer());
      const call =
        route.verb === 'GET'
          ? server.get(path)
          : route.verb === 'PATCH'
            ? server.patch(path)
            : server.post(path);
      const response = await call.set('x-test-role', 'MEMBER').send({});
      expect(response.status, `${route.verb} ${path}`).toBe(403);
      expect(
        spies.get(`${route.provider}.${route.serviceMethod}`),
      ).not.toHaveBeenCalled();
    }
  });
});
