import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/auth/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/auth/roles.guard.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GoodsController } from '../src/goods/goods.controller.js';
import { GoodsService } from '../src/goods/goods.service.js';
import { MembershipsController } from '../src/memberships/memberships.controller.js';
import { MembershipProductsService } from '../src/memberships/products/memberships-products.service.js';
import { MembershipRechargePlansService } from '../src/memberships/recharge-plans/memberships-recharge-plans.service.js';
import { MembershipPurchasesService } from '../src/memberships/purchases/memberships-purchases.service.js';
import { TrainingCatalogController } from '../src/training/catalog/training-catalog.controller.js';
import { TrainingCatalogService } from '../src/training/catalog/training-catalog.service.js';

// Real catalog services, controllers and guards. Only SQL transport is replaced;
// fixtures retain private fields unless the real query/projection removes them.
function catalogQuery() {
  const rows = [
    { id: 'public', name: '在售方案', enabled: true, effectiveFrom: new Date(0), effectiveTo: null, internalNote: 'private-note', costPriceCents: 'private-cost' },
    { id: 'disabled', enabled: false, effectiveFrom: new Date(0), effectiveTo: null },
    { id: 'future', enabled: true, effectiveFrom: new Date('2099-01-01'), effectiveTo: null },
    { id: 'expired', enabled: true, effectiveFrom: new Date(0), effectiveTo: new Date(1) },
  ];
  return vi.fn(async ({ where, select }: any) => rows.filter(row =>
    (!where.enabled || row.enabled) &&
    (!where.effectiveFrom || row.effectiveFrom <= where.effectiveFrom.lte) &&
    (!where.OR || !row.effectiveTo || row.effectiveTo > where.OR[1].effectiveTo.gt),
  ).map(row => Object.fromEntries(Object.keys(select).map(key => [key, (row as any)[key]]))));
}
const prisma = {
  user: { findUnique: vi.fn() },
  membershipProduct: { findMany: catalogQuery() },
  rechargePlan: { findMany: catalogQuery() },
  inventoryItem: { findMany: catalogQuery() },
  trainingProduct: { findMany: vi.fn(async ({ where, include }: any) => [
    { id: 'public-course', enabled: true, priceCents: 12000 },
    { id: 'disabled-course', enabled: false, priceCents: 12000 },
  ].filter(row => !where.enabled || row.enabled).map(row => ({
    ...row, internalNote: 'private-note',
    classes: [
      { id: 'active-class', active: true, name: '周末班', coachId: 'private-coach', assistantId: 'private-assistant', coachCostCents: 'private-cost' },
      { id: 'inactive-class', active: false },
    ].filter(c => !include.classes.where.active || c.active),
  }))) },
};
const commands = { purchase: vi.fn(), recharge: vi.fn() };
let app: INestApplication;
describe('guest catalogs through real authentication guards', () => {
  beforeAll(async () => {
    // Vitest does not emit constructor parameter metadata for this older controller.
    Reflect.defineMetadata('design:paramtypes', [GoodsService], GoodsController);
    const module = await Test.createTestingModule({
      controllers: [GoodsController, MembershipsController, TrainingCatalogController],
      providers: [
        TrainingCatalogService, MembershipProductsService, MembershipRechargePlansService,
        { provide: GoodsService, useValue: new GoodsService(prisma as unknown as PrismaService) },
        { provide: MembershipPurchasesService, useValue: commands },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(new JwtService(), reflector, prisma as unknown as PrismaService, new ConfigService()), new RolesGuard(reflector));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  it.each(['/memberships/products', '/memberships/recharge-plans', '/goods', '/training/products/public'])('serves %s to guests and expired sessions without private fields', async path => {
    for (const token of ['', 'expired']) {
      const req = request(app.getHttpServer()).get('/api/v1' + path);
      if (token) req.set('Authorization', 'Bearer ' + token);
      const response = await req.expect(200);
      expect(response.body.length).toBeGreaterThan(0);
      expect(JSON.stringify(response.body)).not.toMatch(/private-|disabled|inactive-class/);
      if (path.startsWith('/memberships')) {
        expect(response.body.map((row: any) => row.id)).toEqual(['public']);
      }
      if (path.startsWith('/training')) {
        expect(response.body[0].classes).toEqual([{ id: 'active-class', name: '周末班', active: true }]);
      }
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    }
  });
  it.each(['/training/products', '/memberships/products/manage', '/memberships/recharge-plans/manage'])('keeps staff GET %s authenticated', async path => {
    await request(app.getHttpServer()).get('/api/v1' + path).expect(401);
  });
  it.each(['/goods/orders', '/memberships/purchase', '/memberships/recharge', '/training/products', '/training/classes'])('requires authentication before POST %s', async path => {
    await request(app.getHttpServer()).post('/api/v1' + path).send({}).expect(401);
    expect(commands.purchase).not.toHaveBeenCalled(); expect(commands.recharge).not.toHaveBeenCalled();
  });
});
