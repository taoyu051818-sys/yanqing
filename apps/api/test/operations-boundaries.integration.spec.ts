import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { TrainingService } from './support/training-service-fixture.js';
import { MembersService } from './support/members-fixture.js';
import { PrivacyService } from '../src/privacy/privacy.service.js';
import { InventoryOperationsService } from './support/inventory-operations-fixture.js';
import { OrdersService } from './support/orders-fixture.js';

import { syncTrainingEnrollmentRoster } from '../src/training/training-roster.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type {
  AppRole,
  TrainingSessionStatus,
} from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'operations-' + randomUUID();
const hour = 3600000;
describe.skipIf(!url)('operations boundaries on PostgreSQL', () => {
  let db: PrismaService, training: TrainingService, orders: OrdersService;
  let admin: AuthUser, coach: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Only an isolated local test database is allowed');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    training = new TrainingService(db);
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      createOrderFinalizerService({} as never),
      {} as never,
    );
    admin = await person('ADMIN');
    coach = await person('COACH');
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
  });
  async function person(
    role: AppRole = 'MEMBER',
    balance = 1000000,
  ): Promise<AuthUser> {
    const user = await db.user.create({
      data: {
        displayName: '第三轮隔离审查',
        primaryRole: role,
        memberProfile: { create: { tags: [] } },
        accounts: { create: { type: 'CASH_PRINCIPAL', balance } },
      },
    });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }
  async function course(priceCents = 10000, totalSessions = 10) {
    const product = await training.createProduct(
      {
        code: key(),
        name: '隔离成人课包',
        audience: 'ADULT',
        totalSessions,
        validityDays: 90,
        priceCents,
        refundRule: {},
      },
      admin,
    );
    const trainingClass = await training.createClass(
      {
        code: key(),
        productId: product.id,
        name: '隔离班级',
        coachId: coach.sub,
        schedule: {},
        capacity: 10,
        coachCostCents: 0,
        assistantCostCents: 0,
        materialCostCents: 0,
      },
      admin,
    );
    const court = await db.court.create({
      data: { code: key(), name: '隔离场地', zone: 'EAST', sortOrder: 1 },
    });
    return { product, trainingClass, court };
  }
  async function buy(c: Awaited<ReturnType<typeof course>>, buyer: AuthUser) {
    const order = await training.purchase(
      {
        productId: c.product.id,
        classId: c.trainingClass.id,
        sourceChannel: 'MINI_PROGRAM',
        creationIdempotencyKey: key(),
      },
      buyer,
    );
    await orders.pay(
      order.id,
      { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
      buyer,
    );
    const enrollment = await db.trainingEnrollment.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    return { order, enrollment };
  }
  async function session(c: Awaited<ReturnType<typeof course>>, offset = 0) {
    return training.createSession(
      {
        classId: c.trainingClass.id,
        courtIds: [c.court.id],
        startsAt: new Date(Date.now() + 2 * hour + offset).toISOString(),
        endsAt: new Date(Date.now() + 3 * hour + offset).toISOString(),
        reason: '隔离审查课次',
        creationIdempotencyKey: key(),
      },
      coach,
    );
  }
  async function consume(sessionId: string, enrollmentId: string) {
    const scheduled = await db.trainingSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scheduled.endsAt.getTime() + 1));
    try {
      await training.markAttendance(
        sessionId,
        { enrollmentId, status: 'ATTENDED' },
        coach,
      );
      await training.proposeConsume(sessionId, { enrollmentId }, coach);
      return await training.confirmConsume(
        sessionId,
        { enrollmentId, reason: '隔离审查核对签到', idempotencyKey: key() },
        admin,
      );
    } finally {
      vi.useRealTimers();
    }
  }

  it('control: enrollment before scheduling receives attendance and agreed unit revenue', async () => {
    const c = await course(),
      buyer = await person();
    const { enrollment } = await buy(c, buyer);
    const s = await session(c);
    await consume(s.id, enrollment.id);
    const updated = await db.trainingEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(updated).toMatchObject({
      consumedSessions: 1,
      prepaidBalanceCents: 9000,
      confirmedRevenueCents: 1000,
      status: 'ACTIVE',
    });
  });

  it.each([
    { priceCents: 100000 },
    { priceCents: 1000 },
    { totalSessions: 1 },
    { totalSessions: 20 },
  ])(
    'sold course keeps its contract after a product update: %j',
    async (change) => {
      const c = await course(),
        buyer = await person();
      const { order, enrollment } = await buy(c, buyer);
      await training.updateProduct(
        c.product.id,
        { ...change, reason: '新客课包调价', idempotencyKey: key() },
        admin,
      );
      const s = await session(c);
      await consume(s.id, enrollment.id);
      const updated = await db.trainingEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      ).toBe('PAID');
      expect(updated).toMatchObject({
        consumedSessions: 1,
        prepaidBalanceCents: 9000,
        confirmedRevenueCents: 1000,
        status: 'ACTIVE',
      });
    },
  );

  it('the last session absorbs rounding cents before the enrollment completes', async () => {
    const c = await course(10000, 3),
      buyer = await person();
    const { enrollment } = await buy(c, buyer);
    for (let i = 0; i < 3; i++) {
      const s = await session(c, (i * hour) / 4);
      // Independent courts avoid overlaps while all sessions remain in the attendance window.
      await consume(s.id, enrollment.id);
      if (i < 2)
        c.court = await db.court.create({
          data: { code: key(), name: '隔离场地', zone: 'EAST', sortOrder: 1 },
        });
    }
    const updated = await db.trainingEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(updated).toMatchObject({
      prepaidBalanceCents: 0,
      confirmedRevenueCents: 10000,
      status: 'COMPLETED',
    });
  });

  it('payment after scheduling adds the new learner to the existing future session', async () => {
    const c = await course(),
      buyer = await person();
    const s = await session(c, 26 * hour);
    const { enrollment } = await buy(c, buyer);
    const rows = await db.trainingAttendance.findMany({
      where: { sessionId: s.id, enrollmentId: enrollment.id },
    });
    expect(rows).toHaveLength(1);
  });

  it('erasure detects a pending adjustment for the member account', async () => {
    const member = await person('MEMBER', 0),
      finance = await person('FINANCE'),
      superAdmin = await person('SUPER_ADMIN');
    const members = new MembersService(db),
      privacy = new PrivacyService(db);
    const adjustment = await members.adjustAccount(
      member.sub,
      {
        accountType: 'CASH_PRINCIPAL',
        amount: 10000,
        reason: '隔离审查补记余额',
        idempotencyKey: key(),
      },
      finance,
    );
    const request = await privacy.create(
      { reason: '隔离审查注销', idempotencyKey: key() },
      member,
    );
    await db.user.update({
      where: { id: member.sub },
      data: { status: 'DISABLED' },
    });
    const blockers = await privacy.blockers(request.id, superAdmin);
    await expect(
      privacy.complete(
        request.id,
        { reason: '核对待处理业务', idempotencyKey: key() },
        superAdmin,
      ),
    ).rejects.toThrow('账号仍有未完成业务');
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: member.sub } })).status,
    ).toBe('DISABLED');
    expect(
      (
        await db.accountAdjustmentRequest.findUniqueOrThrow({
          where: { id: adjustment.id },
        })
      ).status,
    ).toBe('REQUESTED');
    expect(blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PENDING_ACCOUNT_ADJUSTMENT',
          count: 1,
        }),
      ]),
    );
  });

  it('control: a spendable account balance blocks erasure', async () => {
    const member = await person('MEMBER', 100),
      privacy = new PrivacyService(db);
    const request = await privacy.create(
      { reason: '隔离审查注销', idempotencyKey: key() },
      member,
    );
    await db.user.update({
      where: { id: member.sub },
      data: { status: 'DISABLED' },
    });
    expect(await privacy.blockers(request.id, admin)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SPENDABLE_ACCOUNT_BALANCE',
          count: 1,
        }),
      ]),
    );
  });

  it('rejects both new adjustments and pending approvals for an erased account', async () => {
    const member = await person('MEMBER', 0),
      finance = await person('FINANCE');
    const members = new MembersService(db);
    const dto = {
      accountType: 'CASH_PRINCIPAL' as const,
      amount: 10000,
      reason: '余额补记',
      idempotencyKey: key(),
    };
    const request = await members.adjustAccount(member.sub, dto, finance);
    // Simulate a legacy erased user with a pending adjustment left behind.
    await db.user.update({
      where: { id: member.sub },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
    await expect(
      members.adjustAccount(
        member.sub,
        { ...dto, idempotencyKey: key() },
        finance,
      ),
    ).rejects.toThrow('账号已注销');
    await expect(
      members.approveAccountAdjustment(
        request.id,
        { reason: '复核补记' },
        admin,
      ),
    ).rejects.toThrow('账号已注销');
    expect(
      await db.accountTransaction.count({
        where: { account: { userId: member.sub } },
      }),
    ).toBe(0);
    expect(
      (
        await db.accountAdjustmentRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).status,
    ).toBe('REQUESTED');
  });

  it('allows a disabled account to settle funds before erasure', async () => {
    const member = await person('MEMBER', 10000),
      finance = await person('FINANCE'),
      superAdmin = await person('SUPER_ADMIN');
    const members = new MembersService(db),
      privacy = new PrivacyService(db);
    const erasure = await privacy.create(
      { reason: '清理未完业务后注销', idempotencyKey: key() },
      member,
    );
    await db.user.update({
      where: { id: member.sub },
      data: { status: 'DISABLED' },
    });
    const request = await members.adjustAccount(
      member.sub,
      {
        accountType: 'CASH_PRINCIPAL',
        amount: -10000,
        reason: '完成账户善后',
        idempotencyKey: key(),
      },
      finance,
    );
    await members.approveAccountAdjustment(
      request.id,
      { reason: '核实账户善后' },
      admin,
    );
    await privacy.complete(
      erasure.id,
      { reason: '业务均已结清', idempotencyKey: key() },
      superAdmin,
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: member.sub } })).status,
    ).toBe('DELETED');
  });

  it('serializes erasure against a new adjustment that has already checked the owner', async () => {
    const member = await person('MEMBER', 0),
      finance = await person('FINANCE'),
      superAdmin = await person('SUPER_ADMIN');
    const privacy = new PrivacyService(db);
    const request = await privacy.create(
      { reason: '并发注销验证', idempotencyKey: key() },
      member,
    );
    await db.user.update({
      where: { id: member.sub },
      data: { status: 'DISABLED' },
    });
    let reached!: () => void, resume!: () => void;
    const read = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let paused = false;
    const instrumented = db.$extends({
      query: {
        user: {
          async findUnique({ args, query }) {
            const owner = await query(args);
            if (!paused && args.where.id === member.sub) {
              paused = true;
              reached();
              await gate;
            }
            return owner;
          },
        },
      },
    });
    const dto = {
      accountType: 'CASH_PRINCIPAL' as const,
      amount: 10000,
      reason: '并发余额补记',
      idempotencyKey: key(),
    };
    const adjusting = new MembersService(instrumented as never)
      .adjustAccount(member.sub, dto, finance)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await read;
    try {
      await privacy.complete(
        request.id,
        { reason: '核实业务已清理', idempotencyKey: key() },
        superAdmin,
      );
    } finally {
      resume();
    }
    expect(await adjusting).toHaveProperty('error');
    await expect(
      new MembersService(db).adjustAccount(member.sub, dto, finance),
    ).rejects.toThrow('账号已注销');
    expect(
      await db.accountAdjustmentRequest.count({
        where: { account: { userId: member.sub } },
      }),
    ).toBe(0);
    expect(
      (
        await db.account.findUniqueOrThrow({
          where: {
            userId_type: { userId: member.sub, type: 'CASH_PRINCIPAL' },
          },
        })
      ).balance,
    ).toBe(0);
  }, 15000);

  it('preserves the refunded balance and final cents after reversal and reconfirmation', async () => {
    const c = await course(10000, 3),
      buyer = await person();
    const { order, enrollment } = await buy(c, buyer);
    const first = await session(c);
    await consume(first.id, enrollment.id);
    const refund = await orders.requestRefund(
      order.id,
      { amountCents: 500, reason: '退还部分未消课费用', idempotencyKey: key() },
      buyer,
    );
    await orders.approveRefund(refund.id, { reason: '核对未消课余额' }, admin);
    for (let i = 1; i < 3; i++) {
      c.court = await db.court.create({
        data: { code: key(), name: '隔离场地', zone: 'EAST', sortOrder: 1 },
      });
      const s = await session(c, i * hour);
      const recognition = await consume(s.id, enrollment.id);
      if (i === 2) {
        const correction = await training.requestConsumeCorrection(
          {
            recognitionId: recognition.id,
            reason: '复核签到后重新确认',
            idempotencyKey: key(),
          },
          coach,
        );
        await training.approveConsumeCorrection(
          correction.id,
          { reason: '核实冲正原因', idempotencyKey: key() },
          admin,
        );
        await consume(s.id, enrollment.id);
      }
    }
    const updated = await db.trainingEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(updated).toMatchObject({
      consumedSessions: 3,
      confirmedRevenueCents: 9500,
      refundedCents: 500,
      prepaidBalanceCents: 0,
      status: 'COMPLETED',
    });
    const ledger = await db.trainingRevenueRecognition.aggregate({
      where: { enrollmentId: enrollment.id },
      _sum: { effectiveRevenueCents: true },
    });
    expect(ledger._sum.effectiveRevenueCents).toBe(9500);
  });

  it.each(['UTC', 'Asia/Shanghai'])(
    'syncs eligible future sessions and repairs missing rows in timezone %s',
    async (timezone) => {
      const c = await course(),
        buyer = await person();
      const { enrollment } = await buy(c, buyer);
      const other = await course();
      const row = (
        classId: string,
        startsAt: Date,
        endsAt: Date,
        status: TrainingSessionStatus = 'SCHEDULED',
      ) => ({
        classId,
        startsAt,
        endsAt,
        status,
        courtCount: 1,
        occupiedCourtHours: 1,
      });
      const future = await db.trainingSession.create({
        data: row(
          c.trainingClass.id,
          new Date(Date.now() + hour),
          new Date(Date.now() + 2 * hour),
        ),
      });
      const excluded = [
        row(
          c.trainingClass.id,
          new Date(Date.now() - hour),
          new Date(Date.now() + hour),
        ),
        row(
          c.trainingClass.id,
          new Date(enrollment.expiresAt.getTime() - hour),
          new Date(enrollment.expiresAt.getTime() + hour),
        ),
        row(
          c.trainingClass.id,
          new Date(Date.now() + 3 * hour),
          new Date(Date.now() + 4 * hour),
          'CANCELLED',
        ),
        row(
          other.trainingClass.id,
          new Date(Date.now() + hour),
          new Date(Date.now() + 2 * hour),
        ),
      ];
      for (const data of excluded) await db.trainingSession.create({ data });
      const sync = () =>
        db.$transaction(
          (tx) => syncTrainingEnrollmentRoster(tx, enrollment, new Date()),
          { isolationLevel: 'Serializable' },
        );
      await sync();
      await sync();
      expect(
        await db.trainingAttendance.findMany({
          where: { enrollmentId: enrollment.id },
          select: { sessionId: true },
        }),
      ).toEqual([{ sessionId: future.id }]);
      await db.trainingAttendance.deleteMany({
        where: { enrollmentId: enrollment.id },
      });
      const migration = readFileSync(
        new URL(
          '../prisma/migrations/20260908160000_training_future_roster/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
        await tx.$executeRawUnsafe(migration);
        await tx.$executeRawUnsafe(migration);
      });
      expect(
        await db.trainingAttendance.findMany({
          where: { enrollmentId: enrollment.id },
          select: { sessionId: true },
        }),
      ).toEqual([{ sessionId: future.id }]);
    },
  );

  it('does not enroll an expired contract when a new session is scheduled', async () => {
    const c = await course(),
      buyer = await person();
    const { enrollment } = await buy(c, buyer);
    await db.trainingEnrollment.update({
      where: { id: enrollment.id },
      data: { expiresAt: new Date(Date.now() + hour) },
    });
    const scheduled = await session(c);
    expect(
      await db.trainingAttendance.count({
        where: { sessionId: scheduled.id, enrollmentId: enrollment.id },
      }),
    ).toBe(0);
  });

  it('retries concurrent scheduling and payment without missing or duplicating attendance', async () => {
    const c = await course(),
      buyer = await person();
    const order = await training.purchase(
      {
        productId: c.product.id,
        classId: c.trainingClass.id,
        sourceChannel: 'MINI_PROGRAM',
        creationIdempotencyKey: key(),
      },
      buyer,
    );
    let reached!: () => void, resume!: () => void;
    const read = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let paused = false;
    const instrumented = db.$extends({
      query: {
        trainingSession: {
          async findMany({ args, query }) {
            const rows = await query(args);
            if (!paused && args.where?.classId === c.trainingClass.id) {
              paused = true;
              reached();
              await gate;
            }
            return rows;
          },
        },
      },
    });
    const service = new OrdersService(
      instrumented as never,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      createOrderFinalizerService({} as never),
      {} as never,
    );
    const payDto = {
      channel: 'CASH_PRINCIPAL' as const,
      idempotencyKey: key(),
    };
    const paying = service.pay(order.id, payDto, buyer).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await read;
    let scheduled: Awaited<ReturnType<typeof session>>;
    try {
      scheduled = await session(c);
    } finally {
      resume();
    }
    const result = await paying;
    if ('error' in result) await orders.pay(order.id, payDto, buyer);
    await orders.pay(order.id, payDto, buyer);
    const enrollment = await db.trainingEnrollment.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(
      await db.trainingAttendance.count({
        where: { sessionId: scheduled!.id, enrollmentId: enrollment.id },
      }),
    ).toBe(1);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(
      await db.accountTransaction.count({ where: { orderId: order.id } }),
    ).toBe(1);
  }, 15000);

  it.each([false, true])(
    'stocktake is independent of line order (default first: %s)',
    async (defaultFirst) => {
      const ops = new InventoryOperationsService(db),
        maker = await person('ADMIN');
      const location = await db.inventoryLocation.create({
        data: { code: key(), name: '隔离库位' },
      });
      const item = await db.inventoryItem.create({
        data: {
          sku: key(),
          name: '隔离羽球',
          category: '球类',
          mode: 'PURCHASE',
          supplier: '隔离供应商',
          stock: 20,
          purchasePriceCents: 100,
          salePriceCents: 200,
          defaultLocationId: location.id,
          batchCode: 'DEFAULT',
        },
      });
      await db.inventoryStockBalance.create({
        data: {
          itemId: item.id,
          locationId: location.id,
          batchCode: 'BATCH-B',
          quantity: 10,
        },
      });
      await db.inventoryStockBalance.create({
        data: {
          itemId: item.id,
          locationId: location.id,
          batchCode: 'DEFAULT',
          quantity: 10,
        },
      });
      const lines = [
        {
          itemId: item.id,
          batchCode: 'BATCH-B',
          bookQuantity: 10,
          countedQuantity: 9,
          difference: -1,
        },
        {
          itemId: item.id,
          batchCode: 'DEFAULT',
          bookQuantity: 10,
          countedQuantity: 10,
          difference: 0,
        },
      ];
      const stocktake = await db.stocktake.create({
        data: {
          stocktakeNo: key(),
          locationId: location.id,
          reason: '隔离盘点',
          createdById: maker.sub,
          submittedById: maker.sub,
          status: 'REVIEW',
          lines: { create: defaultFirst ? lines.reverse() : lines },
        },
      });
      let error: unknown;
      try {
        await ops.postStocktake(stocktake.id, { idempotencyKey: key() }, admin);
      } catch (caught) {
        error = caught;
      }
      const after = await db.inventoryItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(error).toBeUndefined();
      expect(after.stock).toBe(19);
    },
  );
});
