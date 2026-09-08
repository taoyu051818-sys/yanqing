import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { ConfigurationService } from '../src/configuration/configuration.service.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { BossService } from '../src/boss/boss.service.js';
import { GovernanceService } from '../src/governance/governance.service.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { VenuesService } from '../src/venues/venues.service.js';
import { MembershipsService } from '../src/memberships/memberships.service.js';
import { TrainingService } from '../src/training/training.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import { dayRange } from '../src/boss/boss.logic.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'r6-' + randomUUID();
const day = 86400000;
// Run this suite on a fresh, isolated database: reporting spans all records.
describe.skipIf(!url)('reporting boundaries on PostgreSQL', () => {
  let db: PrismaService, admin: AuthUser, buyer: AuthUser;
  let memberships: MembershipsService, orders: OrdersService;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Local test database only');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    const a = await db.user.create({
      data: { displayName: '第六轮隔离管理员', primaryRole: 'SUPER_ADMIN' },
    });
    admin = { sub: a.id, displayName: a.displayName, roles: ['SUPER_ADMIN'] };
    const b = await db.user.create({
      data: {
        displayName: '第六轮隔离会员',
        primaryRole: 'MEMBER',
        memberProfile: { create: { tags: [] } },
        accounts: { create: { type: 'CASH_PRINCIPAL', balance: 1000000 } },
      },
    });
    buyer = { sub: b.id, displayName: b.displayName, roles: ['MEMBER'] };
    memberships = new MembershipsService(db);
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      new OrderFinalizerService({} as never),
      {} as never,
    );
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  it('serializes concurrent parameter versions and keeps list and resolution consistent', async () => {
    const parameterKey = key();
    const configuration = new ConfigurationService(db);
    const dto = (value: number, at: string) => ({
      key: parameterKey,
      value,
      effectiveFrom: at,
      type: 'INTEGER' as const,
      description: '并发分成参数测试',
      reason: '本地隔离复现',
      locked: false,
    });
    await configuration.createVersion(dto(1500, '2026-01-01T00:00:00Z'), admin);
    let arrivals = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const concurrentDb = db.$extends({
      query: {
        $allOperations: async ({ operation, args, query }) => {
          if (operation === '$executeRaw') {
            if (++arrivals === 2) release();
            await gate;
          }
          return query(args);
        },
      },
    });
    const service = new ConfigurationService(concurrentDb as never);
    const created = await Promise.allSettled([
      service.createVersion(dto(1800, '2026-02-01T00:00:00Z'), admin),
      service.createVersion(dto(2000, '2026-03-01T00:00:00Z'), admin),
    ]);
    expect(created.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of created)
      if (r.status === 'rejected') expect(r.reason.getStatus()).toBe(409);
    const at = new Date('2026-04-01T00:00:00Z');
    const active = await db.systemParameter.findMany({
      where: {
        key: parameterKey,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
    });
    expect(active).toHaveLength(1);
    const list = await configuration.list({
      prefix: parameterKey,
      at: at.toISOString(),
    });
    const resolved = await configuration.resolve(parameterKey, at);
    expect(list[0].value).toBe(2000);
    expect(resolved.value).toBe(2000);
  });

  it('sequential parameter creation has one active version', async () => {
    const configuration = new ConfigurationService(db),
      parameterKey = key();
    for (const [value, effectiveFrom] of [
      [1500, '2026-01-01T00:00:00Z'],
      [2000, '2026-02-01T00:00:00Z'],
    ] as const)
      await configuration.createVersion(
        {
          key: parameterKey,
          value,
          effectiveFrom,
          type: 'INTEGER',
          description: '顺序版本',
          reason: '本地隔离复现',
          locked: false,
        },
        admin,
      );
    const list = await configuration.list({
      prefix: parameterKey,
      at: '2026-04-01T00:00:00Z',
    });
    expect(list).toHaveLength(1);
    expect(list[0].value).toBe(2000);
  });

  it('counts one weekly statement only on its actual settlement date', async () => {
    // Synthetic valid settled statement. This projection does not read its
    // underlying attendance ledger; the same statement ID must count once.
    const start = new Date('2026-08-17T00:00:00+08:00');
    await db.trainingSettlement.create({
      data: {
        periodStart: start,
        periodEnd: new Date(+start + 7 * day),
        effectiveRevenueCents: 100000,
        venueContributionCents: 20000,
        cashContributionMarginCents: 100000,
        status: 'SETTLED',
        settledAt: new Date('2026-08-20T00:00:00+08:00'),
      },
    });
    const reconciliation = new ReconciliationService(db);
    const snapshots = [];
    for (let i = 0; i < 7; i++) {
      const date = '2026-08-' + (17 + i);
      const view = await reconciliation.close(
        date,
        { reason: '隔离日结' },
        admin,
      );
      expect(view.status).toBe('LOCKED');
      snapshots.push(
        Number(view.totals.trainingSettlementVenueContributionCents),
      );
    }
    expect(snapshots).toEqual([0, 0, 0, 20000, 0, 0, 0]);
    expect(snapshots.reduce((a, b) => a + b, 0)).toBe(20000);
  });

  it('replays identical parameter creation once and rejects altered payloads', async () => {
    const service = new ConfigurationService(db);
    const dto = {
      key: key(),
      value: 1500,
      type: 'INTEGER' as const,
      locked: true,
      description: '版本重放',
      reason: '本地验证',
      effectiveFrom: '2026-01-01T00:00:00Z',
    };
    const [a, b] = await Promise.all([
      service.createVersion(dto, admin),
      service.createVersion(dto, admin),
    ]);
    expect(a.id).toBe(b.id);
    expect(
      await db.auditLog.count({
        where: { objectId: a.id, action: 'PARAMETER_VERSION_CREATED' },
      }),
    ).toBe(1);
    await expect(
      service.createVersion({ ...dto, value: 2000 }, admin),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.createVersion(
        { ...dto, effectiveFrom: '2026-02-01T00:00:00Z' },
        { ...admin, roles: ['ADMIN'] },
      ),
    ).rejects.toMatchObject({ status: 409 });
    const next = await service.createVersion(
      { ...dto, effectiveFrom: '2026-02-01T00:00:00Z' },
      admin,
    );
    expect((await service.createVersion(dto, admin)).id).toBe(a.id);
    expect(next.id).not.toBe(a.id);
  });

  it('rejects overlapping parameter intervals even with direct SQL writes', async () => {
    const data = {
      key: key(),
      value: 10,
      type: 'INTEGER' as const,
      description: '约束验证',
      effectiveFrom: new Date('2026-01-01'),
    };
    await db.systemParameter.create({ data });
    await expect(
      db.systemParameter.create({
        data: { ...data, effectiveFrom: new Date('2026-02-01') },
      }),
    ).rejects.toThrow();
    expect(await db.systemParameter.count({ where: { key: data.key } })).toBe(
      1,
    );
  });

  it('records training posting time once through the real workflow', async () => {
    const creatorUser = await db.user.create({
      data: { displayName: '隔离财务制单', primaryRole: 'FINANCE' },
    });
    const creator = {
      sub: creatorUser.id,
      displayName: creatorUser.displayName,
      roles: ['FINANCE'] as const,
    };
    const training = new TrainingService(db);
    const statement = await training.createSettlement(
      {
        periodStart: '2030-01-01T00:00:00Z',
        periodEnd: '2030-01-02T00:00:00Z',
        acquisitionCostCents: 0,
        marketingCostCents: 0,
      },
      { ...creator, roles: [...creator.roles] },
    );
    await training.submitSettlement(
      statement.id,
      {},
      { ...creator, roles: [...creator.roles] },
    );
    await training.confirmSettlement(statement.id, {}, admin);
    const posted = await training.settleSettlement(statement.id, {}, admin);
    expect(posted.settledAt).toBeInstanceOf(Date);
    const replay = await training.settleSettlement(statement.id, {}, admin);
    expect(replay.settledAt).toEqual(posted.settledAt);
    expect(
      await db.auditLog.count({
        where: {
          objectId: statement.id,
          action: 'TRAINING_SETTLEMENT_SETTLED',
        },
      }),
    ).toBe(1);
    await expect(
      db.trainingSettlement.update({
        where: { id: statement.id },
        data: { settledAt: null },
      }),
    ).rejects.toThrow();
  });

  it('attributes alliance settlement to its posting day, outside the covered week', async () => {
    const merchant = await db.merchant.create({
      data: {
        code: key(),
        name: '隔离商户',
        category: '餐饮',
        level: 'TRAFFIC_PARTNER',
        settlementRule: {},
      },
    });
    await db.allianceSettlement.create({
      data: {
        merchantId: merchant.id,
        periodStart: new Date('2026-08-01T00:00:00+08:00'),
        periodEnd: new Date('2026-08-08T00:00:00+08:00'),
        status: 'SETTLED',
        settledAt: new Date('2026-08-09T00:00:00+08:00'),
        issuedCount: 1,
        claimedCount: 1,
        redeemedCount: 1,
        effectiveNewCustomers: 1,
        attributedGmvCents: 10000,
        attributedGrossProfitCents: 3000,
        cooperationFeeCents: 1000,
        detail: {},
      },
    });
    const service = new ReconciliationService(db);
    expect(
      (await service.get('2026-08-07', admin)).totals
        .allianceCooperationFeeCents,
    ).toBe(0);
    expect(
      (await service.get('2026-08-08', admin)).totals
        .allianceCooperationFeeCents,
    ).toBe(0);
    const posted = await service.close('2026-08-09', {}, admin);
    expect(posted.totals).toMatchObject({
      allianceCooperationFeeCents: 1000,
      allianceAttributedGmvCents: 10000,
    });
    expect(
      (await service.get('2026-08-10', admin)).totals
        .allianceCooperationFeeCents,
    ).toBe(0);
    expect((await service.close('2026-08-09', {}, admin)).totals).toEqual(
      posted.totals,
    );
  });

  async function pendingMembership() {
    const product = await memberships.createProduct(
      {
        code: 'R6_' + randomUUID().replaceAll('-', '').toUpperCase(),
        name: '第六轮隔离会员产品',
        level: 'GOLD',
        priceCents: 100000,
        durationDays: 30,
        benefits: {},
        effectiveFrom: new Date(Date.now() - day).toISOString(),
        reason: '本地隔离产品',
        idempotencyKey: key(),
      },
      admin,
    );
    await memberships.setProductStatus(
      product.id,
      { enabled: true, reason: '本地上架', idempotencyKey: key() },
      admin,
    );
    return memberships.purchase(
      { productId: product.id, creationIdempotencyKey: key() },
      buyer,
    );
  }
  function sheetRow(sheet: ExcelJS.Worksheet, id: string) {
    const keys = sheet.getRow(1).values as string[];
    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, n) => {
      if (n > 1)
        rows.push(
          Object.fromEntries(
            keys.slice(1).map((k, i) => [k, row.getCell(i + 1).value]),
          ),
        );
    });
    return rows.find((r) => r.id === id)!;
  }

  it.each(['SUPER_ADMIN', 'FINANCE'] as const)(
    'exports a consistent snapshot during payment for %s',
    async (role) => {
      const order = await pendingMembership();
      let orderRead!: () => void, continuePayments!: () => void;
      const read = new Promise<void>((resolve) => {
        orderRead = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        continuePayments = resolve;
      });
      const exportDb = db.$extends({
        query: {
          order: {
            async findMany({ args, query }) {
              const rows = await query(args);
              orderRead();
              return rows;
            },
          },
          payment: {
            async findMany({ args, query }) {
              await gate;
              return query(args);
            },
          },
        },
      });
      const exporting = new ReportsService(exportDb as never).workbook(
        'orders',
        { ...admin, roles: [role] },
      );
      await read;
      try {
        await orders.pay(
          order.id,
          { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
          buyer,
        );
      } finally {
        continuePayments();
      }
      const result = await exporting;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(result.buffer as never);
      const payment = await db.payment.findFirstOrThrow({
        where: { orderId: order.id, status: 'SUCCEEDED' },
      });
      const exportedOrder = sheetRow(
        workbook.getWorksheet('Orders')!,
        order.id,
      );
      const exportedPayment = sheetRow(
        workbook.getWorksheet('Payments')!,
        payment.id,
      );
      expect(exportedOrder.status).toBe('PENDING');
      expect(exportedOrder.paidCents).toBe(0);
      expect(exportedPayment).toBeUndefined();
      const fresh = await new ReportsService(db).workbook('orders', {
        ...admin,
        roles: [role],
      });
      await workbook.xlsx.load(fresh.buffer as never);
      expect(
        sheetRow(workbook.getWorksheet('Payments')!, payment.id).status,
      ).toBe('SUCCEEDED');
      expect(
        sheetRow(workbook.getWorksheet('Orders')!, order.id).paidCents,
      ).toBe(100000);
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
          .paidCents,
      ).toBe(100000);
    },
  );

  for (const action of ['REVIEW', 'RESOLVE'] as const) {
    it('scanner preserves ' + action + ' reason and status', async () => {
      const order = await db.order.findFirstOrThrow({
        where: { memberId: buyer.sub, paidCents: { gte: 100000 } },
      });
      const boss = new BossService(db, new ConfigService({ NODE_ENV: 'test' }));
      const governance = new GovernanceService(db);
      await boss.scan();
      let risk = await db.riskEvent.findUniqueOrThrow({
        where: { dedupKey: 'large:' + order.id },
      });
      const reason =
        action === 'REVIEW' ? '已电话核对，等待凭证' : '凭证匹配，确认无异常';
      const updated = await governance.transitionRisk(
        risk.id,
        action,
        { reason, idempotencyKey: key() },
        admin,
      );
      expect((updated.evidence as Record<string, unknown>).lastReason).toBe(
        reason,
      );
      await boss.scan();
      risk = await db.riskEvent.findUniqueOrThrow({ where: { id: risk.id } });
      expect(risk.status).toBe(action === 'REVIEW' ? 'REVIEWING' : 'RESOLVED');
      expect(
        (risk.evidence as Record<string, unknown>).lastReason,
      ).toBeUndefined();
      expect((risk.handling as Record<string, unknown>).lastReason).toBe(
        reason,
      );
      const summary = await boss.summary();
      expect(
        (
          summary.events.find((e) => e.id === risk.id)!.evidence as Record<
            string,
            unknown
          >
        ).lastReason,
      ).toBe(reason);
      const listed = await governance.riskEvents(
        { page: 1, pageSize: 100 },
        admin,
      );
      expect(
        (
          listed.items.find((e) => e.id === risk.id)!.evidence as Record<
            string,
            unknown
          >
        ).lastReason,
      ).toBe(reason);
      expect(
        await db.auditLog.count({ where: { objectId: risk.id, reason } }),
      ).toBe(1);
    });
  }

  it('keeps handling and observations when a scan races with a review', async () => {
    const order = await pendingMembership();
    await orders.pay(
      order.id,
      { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
      buyer,
    );
    const boss = new BossService(db, new ConfigService({ NODE_ENV: 'test' }));
    await boss.scan();
    const risk = await db.riskEvent.findUniqueOrThrow({
      where: { dedupKey: 'large:' + order.id },
    });
    let reached!: () => void, resume!: () => void;
    const arrived = new Promise<void>((r) => {
        reached = r;
      }),
      gate = new Promise<void>((r) => {
        resume = r;
      });
    const scannerDb = db.$extends({
      query: {
        riskEvent: {
          async upsert({ args, query }) {
            if (args.where.dedupKey === 'large:' + order.id) {
              reached();
              await gate;
            }
            return query(args);
          },
        },
      },
    });
    const scanning = new BossService(
      scannerDb as never,
      new ConfigService({ NODE_ENV: 'test' }),
    ).scan();
    await arrived;
    try {
      await new GovernanceService(db).transitionRisk(
        risk.id,
        'REVIEW',
        { reason: '并发复核记录', idempotencyKey: key() },
        admin,
      );
    } finally {
      resume();
    }
    await scanning;
    const after = await db.riskEvent.findUniqueOrThrow({
      where: { id: risk.id },
    });
    expect(after.handling).toMatchObject({
      lastReason: '并发复核记录',
      lastActorId: admin.sub,
    });
    expect(after.evidence).toMatchObject({ paidCents: 100000 });
    expect(after.status).toBe('REVIEWING');
  });

  it('uses the same enabled court set in dashboard and boss summary', async () => {
    const today = dayRange();
    const courts = [];
    for (let i = 0; i < 2; i++) {
      const court = await db.court.create({
        data: {
          code: key(),
          name: '隔离报表场地',
          zone: 'EAST',
          sortOrder: i,
          createdAt: new Date(+today.start - day),
        },
      });
      courts.push(court);
      await db.courtBooking.create({
        data: {
          courtId: court.id,
          status: 'CONFIRMED',
          startsAt: new Date(+today.start + 10 * 3600000),
          endsAt: new Date(+today.start + 11 * 3600000),
        },
      });
    }
    await db.timeSlot.create({
      data: {
        code: key(),
        label: '10:00-11:00',
        startMinutes: 600,
        endMinutes: 660,
        period: 'DAYTIME',
        sortOrder: 1,
      },
    });
    await new VenuesService(db).updateCourt(
      courts[1].id,
      { enabled: false },
      admin,
    );
    const dashboard = await new DashboardService(db).overview(
      today.start,
      today.end,
    );
    const boss = await new BossService(
      db,
      new ConfigService({ NODE_ENV: 'test' }),
    ).summary(today.date);
    expect(dashboard.venue.courtCount).toBe(1);
    expect(dashboard.venue.bookedCourtHours).toBe(1);
    expect(dashboard.venue.availableCourtHours).toBe(1);
    expect(dashboard.venue.utilizationRate).toBe(100);
    expect(boss.venue.utilizationRate).toBe(100);
  });
});
