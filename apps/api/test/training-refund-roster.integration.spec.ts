import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { TrainingService } from '../src/training/training.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { WechatPayService } from '../src/payments/wechat-pay.service.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'training-refund-' + randomUUID();
const hour = 3600000;
const day = 24 * hour;
const channels = ['CASH_PRINCIPAL', 'WECHAT'] as const;
type Channel = (typeof channels)[number];
describe.skipIf(!url)('training refund operational closeout', () => {
  let db: PrismaService, training: TrainingService, orders: OrdersService;
  let admin: AuthUser, coach: AuthUser, finance: AuthUser;
  const provider = {
    createJsapiPayment: vi
      .fn()
      .mockResolvedValue({ package: 'prepay_id=local' }),
    createRefund: vi
      .fn()
      .mockResolvedValue({ refundId: 'local-refund', status: 'PROCESSING' }),
  };
  let wechat: WechatPayService;
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || !target.pathname.endsWith('_test'))
      throw new Error('Isolated local test database required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    training = new TrainingService(db);
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      new OrderFinalizerService({} as never),
      provider as never,
    );
    wechat = new WechatPayService(
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      db,
      new OrderFinalizerService({} as never),
    );
    vi.spyOn(
      wechat as unknown as { verifyWechatSignature: () => void },
      'verifyWechatSignature',
    ).mockImplementation(() => {});
    admin = await person('ADMIN');
    coach = await person('COACH');
    finance = await person('FINANCE');
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await db?.$disconnect();
  });
  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const u = await db.user.create({
      data: {
        displayName: '第十五轮隔离用户',
        primaryRole: role,
        openId: key(),
        memberProfile: { create: { tags: [] } },
        accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
      },
    });
    return { sub: u.id, displayName: u.displayName, roles: [role] };
  }
  async function sendNotice(
    eventType: string,
    notice: Record<string, unknown>,
  ) {
    vi.spyOn(
      wechat as unknown as { decrypt: () => unknown },
      'decrypt',
    ).mockReturnValue(notice);
    return wechat.handleNotification(
      Buffer.from(JSON.stringify({ event_type: eventType, resource: {} })),
      {
        'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
        'wechatpay-nonce': 'local',
        'wechatpay-signature': 'local',
        'wechatpay-serial': 'local',
      },
    );
  }
  async function pay(
    order: { id: string; orderNo: string },
    buyer: AuthUser,
    channel: Channel,
  ) {
    await orders.pay(order.id, { channel, idempotencyKey: key() }, buyer);
    if (channel === 'WECHAT')
      await sendNotice('TRANSACTION.SUCCESS', {
        out_trade_no: order.orderNo,
        transaction_id: key(),
        trade_state: 'SUCCESS',
        amount: { total: 10000 },
      });
  }
  async function fixture(channel: Channel = 'CASH_PRINCIPAL') {
    const product = await training.createProduct(
      {
        code: key(),
        name: '隔离成人课包',
        audience: 'ADULT',
        totalSessions: 10,
        validityDays: 90,
        priceCents: 10000,
        refundRule: {},
      },
      admin,
    );
    const cls = await training.createClass(
      {
        code: key(),
        productId: product.id,
        name: '隔离单人班',
        coachId: coach.sub,
        schedule: {},
        capacity: 1,
        coachCostCents: 0,
        assistantCostCents: 0,
        materialCostCents: 0,
      },
      admin,
    );
    const buyer = await person();
    const order = await purchase(product.id, cls.id, buyer);
    await pay(order, buyer, channel);
    const enrollment = await db.trainingEnrollment.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    const court = await db.court.create({
      data: { code: key(), name: '隔离排课场地', zone: 'EAST', sortOrder: 1 },
    });
    const start = Date.now() + 2 * day;
    return { product, cls, buyer, order, enrollment, court, start, channel };
  }
  const purchase = (productId: string, classId: string, buyer: AuthUser) =>
    training.purchase(
      {
        productId,
        classId,
        sourceChannel: 'MINI_PROGRAM',
        creationIdempotencyKey: key(),
      },
      buyer,
    );
  async function session(f: Awaited<ReturnType<typeof fixture>>, offset = 0) {
    return training.createSession(
      {
        classId: f.cls.id,
        courtIds: [f.court.id],
        startsAt: new Date(f.start + offset).toISOString(),
        endsAt: new Date(f.start + offset + hour).toISOString(),
        reason: '隔离排课',
        creationIdempotencyKey: key(),
      },
      coach,
    );
  }
  async function refund(
    f: Awaited<ReturnType<typeof fixture>>,
    amountCents: number,
  ) {
    const r = await orders.requestRefund(
      f.order.id,
      { amountCents, reason: '退回未消费课费', idempotencyKey: key() },
      f.buyer,
    );
    await orders.approveRefund(r.id, { reason: '财务核对退费' }, finance);
    if (f.channel === 'WECHAT') {
      expect(
        (
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { id: f.enrollment.id },
          })
        ).prepaidBalanceCents,
      ).toBeGreaterThan(0);
      const notice = {
        out_refund_no: (
          await db.refund.findUniqueOrThrow({ where: { id: r.id } })
        ).refundNo,
        refund_id: key(),
        refund_status: 'SUCCESS',
        amount: { total: 10000, refund: amountCents },
      };
      await sendNotice('REFUND.SUCCESS', notice);
      await sendNotice('REFUND.SUCCESS', notice);
    } else {
      await orders.approveRefund(r.id, { reason: '财务核对退费' }, finance);
    }
    expect(
      (await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status,
    ).toBe('SUCCEEDED');
  }
  it.each(channels)(
    '%s: refunding the unused remainder releases the seat and preserves consumed revenue',
    async (channel) => {
      const f = await fixture(channel);
      const s = await session(f);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start + hour + 1);
      await training.markAttendance(
        s.id,
        { enrollmentId: f.enrollment.id, status: 'ATTENDED' },
        coach,
      );
      await training.proposeConsume(
        s.id,
        { enrollmentId: f.enrollment.id },
        coach,
      );
      await training.confirmConsume(
        s.id,
        {
          enrollmentId: f.enrollment.id,
          reason: '核对消课',
          idempotencyKey: key(),
        },
        admin,
      );
      await training.completeSession(s.id, coach, { reason: '核对结课' });
      await refund(f, 9000);
      expect(
        await db.trainingEnrollment.findUniqueOrThrow({
          where: { id: f.enrollment.id },
        }),
      ).toMatchObject({
        status: 'PARTIALLY_REFUNDED',
        consumedSessions: 1,
        confirmedRevenueCents: 1000,
        prepaidBalanceCents: 0,
        refundedCents: 9000,
      });
      const rebuy = await purchase(f.product.id, f.cls.id, f.buyer);
      await orders.cancelPending(rebuy.id, { idempotencyKey: key() }, f.buyer);
      const newcomer = await person();
      const replacement = await purchase(f.product.id, f.cls.id, newcomer);
      await pay(replacement, newcomer, channel);
      expect(
        (
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { orderId: replacement.id },
          })
        ).status,
      ).toBe('ACTIVE');
      expect(
        await db.trainingAttendance.findUniqueOrThrow({
          where: {
            sessionId_enrollmentId: {
              sessionId: s.id,
              enrollmentId: f.enrollment.id,
            },
          },
        }),
      ).toMatchObject({
        status: 'ATTENDED',
        consumedSessions: 1,
        confirmedRevenueCents: 1000,
      });
    },
  );
  it.each(channels)(
    '%s: full refund cancels pending attendance and allows session completion',
    async (channel) => {
      const f = await fixture(channel);
      const s = await session(f);
      await refund(f, 10000);
      expect(
        (
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { id: f.enrollment.id },
          })
        ).status,
      ).toBe('REFUNDED');
      expect(
        await db.trainingAttendance.findUniqueOrThrow({
          where: {
            sessionId_enrollmentId: {
              sessionId: s.id,
              enrollmentId: f.enrollment.id,
            },
          },
        }),
      ).toMatchObject({ status: 'CANCELLED', consumedSessions: 0 });
      expect(
        await db.auditLog.count({
          where: {
            action: 'TRAINING_REFUND_ROSTER_RELEASED',
            objectId: f.enrollment.id,
          },
        }),
      ).toBe(1);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start + hour + 1);
      expect(
        await training.completeSession(s.id, coach, {
          reason: '退课后正常结课',
        }),
      ).toMatchObject({ status: 'COMPLETED' });
    },
  );
  it.each(channels)(
    '%s: partial refund with usable balance retains seat and attendance',
    async (channel) => {
      const f = await fixture(channel);
      const s = await session(f);
      await refund(f, 1000);
      expect(
        (
          await db.trainingAttendance.findUniqueOrThrow({
            where: {
              sessionId_enrollmentId: {
                sessionId: s.id,
                enrollmentId: f.enrollment.id,
              },
            },
          })
        ).status,
      ).toBe('PENDING');
      expect(
        (
          await db.trainingEnrollment.findUniqueOrThrow({
            where: { id: f.enrollment.id },
          })
        ).prepaidBalanceCents,
      ).toBe(9000);
      await expect(
        purchase(f.product.id, f.cls.id, await person()),
      ).rejects.toThrow('班级名额已满');
    },
  );
  it.each(channels)(
    '%s: full unused refund releases the class seat',
    async (channel) => {
      const f = await fixture(channel);
      await refund(f, 10000);
      expect(
        await purchase(f.product.id, f.cls.id, await person()),
      ).toMatchObject({ status: 'PENDING' });
    },
  );
  it.each(channels)(
    '%s: exhausted refund cancels both the outstanding leave and its makeup slot',
    async (channel) => {
      const f = await fixture(channel);
      const original = await session(f);
      const target = await session(f, day);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start + 1);
      await training.markAttendance(
        original.id,
        {
          enrollmentId: f.enrollment.id,
          status: 'LEAVE',
          reason: '请假安排补课',
        },
        coach,
      );
      await training.scheduleMakeup(
        original.id,
        {
          enrollmentId: f.enrollment.id,
          makeupSessionId: target.id,
          reason: '同班补课',
        },
        coach,
      );
      expect(
        await db.trainingAttendance.findUniqueOrThrow({
          where: {
            sessionId_enrollmentId: {
              sessionId: original.id,
              enrollmentId: f.enrollment.id,
            },
          },
        }),
      ).toMatchObject({
        status: 'MADE_UP',
        makeupTargetId: expect.any(String),
      });
      await refund(f, 10000);
      const rows = await db.trainingAttendance.findMany({
        where: { enrollmentId: f.enrollment.id },
      });
      expect(rows).toHaveLength(2);
      expect(
        rows.every(
          (row) =>
            row.status === 'CANCELLED' &&
            row.makeupTargetId === null &&
            row.consumedSessions === 0,
        ),
      ).toBe(true);
      expect(
        await db.auditLog.count({
          where: {
            action: 'TRAINING_REFUND_ROSTER_RELEASED',
            objectId: f.enrollment.id,
          },
        }),
      ).toBe(1);
    },
  );
  it.each(channels)(
    '%s: refund preserves already recorded arrival evidence',
    async (channel) => {
      const f = await fixture(channel);
      const s = await session(f);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(f.start + 1);
      await training.markAttendance(
        s.id,
        { enrollmentId: f.enrollment.id, status: 'ATTENDED' },
        coach,
      );
      const before = await db.trainingAttendance.findUniqueOrThrow({
        where: {
          sessionId_enrollmentId: {
            sessionId: s.id,
            enrollmentId: f.enrollment.id,
          },
        },
      });
      await refund(f, 10000);
      expect(
        await db.trainingAttendance.findUniqueOrThrow({
          where: { id: before.id },
        }),
      ).toMatchObject({
        status: 'ATTENDED',
        checkedInAt: before.checkedInAt,
        consumedSessions: 0,
      });
      expect(
        await db.auditLog.count({
          where: {
            action: 'TRAINING_REFUND_ROSTER_RELEASED',
            objectId: f.enrollment.id,
          },
        }),
      ).toBe(0);
    },
  );
  it('rolls back money and attendance together when the closeout audit fails', async () => {
    const f = await fixture();
    const s = await session(f);
    const r = await orders.requestRefund(
      f.order.id,
      { amountCents: 10000, reason: '测试事务回滚', idempotencyKey: key() },
      f.buyer,
    );
    const before = await db.account.findUniqueOrThrow({
      where: { userId_type: { userId: f.buyer.sub, type: 'CASH_PRINCIPAL' } },
    });
    const failing = new OrdersService(
      {
        $transaction: (
          work: (tx: unknown) => Promise<unknown>,
          options: unknown,
        ) =>
          db.$transaction(
            (tx) =>
              work(
                new Proxy(tx, {
                  get(target, property) {
                    if (property === 'auditLog')
                      return {
                        create: (args: { data: { action: string } }) => {
                          if (
                            args.data.action ===
                            'TRAINING_REFUND_ROSTER_RELEASED'
                          )
                            throw new Error('isolated closeout audit failure');
                          return tx.auditLog.create(args as never);
                        },
                      };
                    return Reflect.get(target, property);
                  },
                }),
              ),
            options as never,
          ),
      } as never,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      new OrderFinalizerService({} as never),
      provider as never,
    );
    await expect(
      failing.approveRefund(r.id, { reason: '核对退费' }, finance),
    ).rejects.toThrow('isolated closeout audit failure');
    expect(
      (await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status,
    ).toBe('REQUESTED');
    expect(
      (
        await db.trainingEnrollment.findUniqueOrThrow({
          where: { id: f.enrollment.id },
        })
      ).prepaidBalanceCents,
    ).toBe(10000);
    expect(
      (
        await db.trainingAttendance.findUniqueOrThrow({
          where: {
            sessionId_enrollmentId: {
              sessionId: s.id,
              enrollmentId: f.enrollment.id,
            },
          },
        })
      ).status,
    ).toBe('PENDING');
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: before.id } }))
        .balance,
    ).toBe(before.balance);
    expect(
      await db.auditLog.count({
        where: {
          action: 'TRAINING_REFUND_ROSTER_RELEASED',
          objectId: f.enrollment.id,
        },
      }),
    ).toBe(0);
  });
});
