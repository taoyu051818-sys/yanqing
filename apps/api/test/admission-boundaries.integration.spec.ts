import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { GamesService } from './support/games-fixture.js';
import { EventsService } from './support/events-service-fixture.js';
import { OrdersService } from './support/orders-fixture.js';

import { ConsignmentSettlementService } from './support/consignment-settlement-fixture.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/client.js';

const url = process.env.TEST_DATABASE_URL,
  key = () => 'r8-' + randomUUID();
const minute = 60000;
const capture = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ value, error: undefined }),
    (error) => ({ value: undefined, error }),
  );
function latch() {
  let signal!: () => void;
  const promise = new Promise<void>((resolve) => {
    signal = resolve;
  });
  return { promise, signal };
}
describe.skipIf(!url)('admission and host state transitions', () => {
  let db: PrismaService,
    games: GamesService,
    events: EventsService,
    orders: OrdersService;
  let admin: AuthUser, finance: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Local test database only');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    games = new GamesService(db);
    events = new EventsService(db);
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
      createOrderFinalizerService(new ConsignmentSettlementService(db)),
      {} as never,
    );
    admin = await person('ADMIN');
    finance = await person('FINANCE');
  });
  afterAll(async () => {
    vi.useRealTimers();
    if (db) await db.$disconnect();
  });
  async function person(
    role: AppRole = 'MEMBER',
    referrerId?: string,
  ): Promise<AuthUser> {
    const u = await db.user.create({
      data: {
        displayName: '第八轮隔离用户',
        primaryRole: role,
        referrerId,
        memberProfile: { create: { tags: [] } },
        accounts: { create: { type: 'CASH_PRINCIPAL', balance: 100000 } },
      },
    });
    return { sub: u.id, displayName: u.displayName, roles: [role] };
  }
  async function gameFixture(full = false) {
    const host = await person('HOST'),
      buyer = await person();
    const game = await db.game.create({
      data: {
        code: key(),
        title: '隔离签到球局',
        hostId: host.sub,
        level: 'BEGINNER',
        status: 'OPEN',
        capacity: 4,
        feeCents: 1000,
        startsAt: new Date(Date.now() + 15 * minute),
        endsAt: new Date(Date.now() + 75 * minute),
      },
    });
    const order: any = await games.register(
      game.id,
      { sourceChannel: 'MINI_PROGRAM' },
      buyer,
    );
    await orders.pay(
      order.id,
      { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
      buyer,
    );
    if (full)
      for (let i = 0; i < 3; i++) {
        const p = await person();
        const o: any = await games.register(
          game.id,
          { sourceChannel: 'MINI_PROGRAM' },
          p,
        );
        await orders.pay(
          o.id,
          { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
          p,
        );
      }
    const registration = await db.gameRegistration.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    return { game, buyer, order, registration };
  }
  async function eventFixture() {
    const buyer = await person();
    const event = await db.event.create({
      data: {
        code: key(),
        name: '隔离签到赛事',
        rules: [],
        status: 'OPEN',
        capacityPeople: 24,
        minimumPeople: 24,
        totalRounds: 5,
        startsAt: new Date(Date.now() + 15 * minute),
        registrationEndsAt: new Date(Date.now() + 10 * minute),
        feeCents: 1000,
      },
    });
    await events.register(
      event.id,
      {
        name: '隔离双打队',
        playerAName: '测试甲',
        playerBName: '测试乙',
        playerAPhone: '13900000001',
        playerBPhone: '13900000002',
        category: 'MIXED_DOUBLES',
        sourceChannel: 'MINI_PROGRAM',
        registrationMode: 'MANUAL',
        consent: true,
        creationIdempotencyKey: key(),
      },
      buyer,
    );
    const team = await db.eventTeam.findFirstOrThrow({
      where: { eventId: event.id, captainId: buyer.sub },
    });
    await orders.pay(
      team.orderId!,
      { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
      buyer,
    );
    return { buyer, event, team };
  }
  async function refund(orderId: string, buyer: AuthUser) {
    const requested = await orders.requestRefund(
      orderId,
      { amountCents: 1000, reason: '会员申请全额退款', idempotencyKey: key() },
      buyer,
    );
    return orders.approveRefund(
      requested.id,
      { reason: '核实并同意退款' },
      finance,
    );
  }
  it('sequential host rejection prevents later approval', async () => {
    const applicant = await person();
    await games.applyHost(applicant);
    await games.rejectHost(applicant.sub, { reason: '尚不符合要求' }, admin);
    await expect(
      games.approveHost(applicant.sub, { reason: '尝试批准' }, admin),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db.userRole.count({
        where: { userId: applicant.sub, role: 'HOST' },
      }),
    ).toBe(0);
  });
  it('stale host approval cannot overwrite rejection or grant HOST', async () => {
    const applicant = await person();
    const profile = await games.applyHost(applicant);
    const read = latch(),
      resume = latch();
    const gated = db.$extends({
      query: {
        hostProfile: {
          findUnique: async ({ args, query }) => {
            const row = await query(args);
            if (args.where.userId === applicant.sub) {
              read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const approving = capture(
      new GamesService(gated as never).approveHost(
        applicant.sub,
        { reason: '旧页面点击批准' },
        admin,
      ),
    );
    await read.promise;
    try {
      await games.rejectHost(applicant.sub, { reason: '已经决定驳回' }, admin);
    } finally {
      resume.signal();
    }
    expect((await approving).error).toMatchObject({ status: 409 });
    expect(
      (
        await db.hostProfile.findUniqueOrThrow({
          where: { userId: applicant.sub },
        })
      ).status,
    ).toBe('REJECTED');
    expect(
      await db.userRole.count({
        where: { userId: applicant.sub, role: 'HOST' },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: {
          objectId: profile.id,
          action: { in: ['HOST_APPROVED', 'HOST_REJECTED'] },
        },
      }),
    ).toBe(1);
  });
  it('sequential refunded game registration cannot check in', async () => {
    const f = await gameFixture();
    await refund(f.order.id, f.buyer);
    await expect(
      games.checkIn(f.game.id, f.buyer.sub, admin),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await db.gameRegistration.findUniqueOrThrow({
          where: { id: f.registration.id },
        })
      ).status,
    ).toBe('REFUNDED');
  });
  it('stale game check-in cannot resurrect refunded admission after waitlist promotion', async () => {
    const f = await gameFixture(true),
      waiter = await person();
    expect(
      (
        await games.register(
          f.game.id,
          { sourceChannel: 'MINI_PROGRAM' },
          waiter,
        )
      ).status,
    ).toBe('WAITLISTED');
    const read = latch(),
      resume = latch();
    const gated = db.$extends({
      query: {
        gameRegistration: {
          findFirst: async ({ args, query }) => {
            const row = await query(args);
            if (row?.id === f.registration.id) {
              read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const checking = capture(
      new GamesService(gated as never).checkIn(f.game.id, f.buyer.sub, admin),
    );
    await read.promise;
    try {
      await refund(f.order.id, f.buyer);
      const promoted = await db.gameRegistration.findUniqueOrThrow({
        where: { gameId_userId: { gameId: f.game.id, userId: waiter.sub } },
      });
      await orders.pay(
        promoted.orderId!,
        { channel: 'CASH_PRINCIPAL', idempotencyKey: key() },
        waiter,
      );
    } finally {
      resume.signal();
    }
    expect((await checking).error).toMatchObject({ status: 409 });
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status,
    ).toBe('REFUNDED');
    expect(
      (
        await db.gameRegistration.findUniqueOrThrow({
          where: { id: f.registration.id },
        })
      ).status,
    ).toBe('REFUNDED');
    expect(
      (
        await db.gameRegistration.findUniqueOrThrow({
          where: { gameId_userId: { gameId: f.game.id, userId: waiter.sub } },
        })
      ).status,
    ).toBe('PAID');
    expect(
      await db.gameRegistration.count({
        where: {
          gameId: f.game.id,
          status: { in: ['REGISTERED', 'PAID', 'CHECKED_IN'] },
        },
      }),
    ).toBe(4);
  });
  it('stale event check-in cannot resurrect a refunded team', async () => {
    const { buyer, event, team } = await eventFixture();
    const read = latch(),
      resume = latch();
    const gated = db.$extends({
      query: {
        eventTeam: {
          findFirst: async ({ args, query }) => {
            const row = await query(args);
            if (row?.id === team.id) {
              read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const checking = capture(
      new EventsService(gated as never).checkIn(event.id, team.id, admin),
    );
    await read.promise;
    try {
      await refund(team.orderId!, buyer);
    } finally {
      resume.signal();
    }
    expect((await checking).error).toMatchObject({ status: 409 });
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: team.orderId! } }))
        .status,
    ).toBe('REFUNDED');
    expect(
      (await db.eventTeam.findUniqueOrThrow({ where: { id: team.id } })).status,
    ).toBe('REFUNDED');
  });
  for (const kind of ['game', 'event'] as const) {
    async function fixture() {
      if (kind === 'game') {
        const f = await gameFixture();
        return {
          buyer: f.buyer,
          orderId: f.order.id,
          id: f.registration.id,
          check: (client = db) =>
            new GamesService(client).checkIn(f.game.id, f.buyer.sub, admin),
          row: () =>
            db.gameRegistration.findUniqueOrThrow({
              where: { id: f.registration.id },
            }),
          action: 'GAME_CHECKED_IN',
          model: 'gameRegistration',
        };
      }
      const f = await eventFixture();
      return {
        buyer: f.buyer,
        orderId: f.team.orderId!,
        id: f.team.id,
        check: (client = db) =>
          new EventsService(client).checkIn(f.event.id, f.team.id, admin),
        row: () => db.eventTeam.findUniqueOrThrow({ where: { id: f.team.id } }),
        action: 'EVENT_TEAM_CHECKED_IN',
        model: 'eventTeam',
      };
    }
    it(`${kind}: pending refund committed after admission read blocks check-in`, async () => {
      const f = await fixture(),
        read = latch(),
        resume = latch();
      const gated = db.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              const row: any = await query(args);
              if (
                model.toLowerCase() === f.model.toLowerCase() &&
                operation === 'findFirst' &&
                row?.id === f.id
              ) {
                read.signal();
                await resume.promise;
              }
              return row;
            },
          },
        },
      });
      const checking = capture(f.check(gated as never));
      await read.promise;
      try {
        await orders.requestRefund(
          f.orderId,
          {
            amountCents: 1000,
            reason: '请求退款暂未审批',
            idempotencyKey: key(),
          },
          f.buyer,
        );
      } finally {
        resume.signal();
      }
      expect((await checking).error).toMatchObject({ status: 409 });
      expect((await f.row()).status).toBe('PAID');
      expect(
        await db.auditLog.count({
          where: { objectId: f.id, action: f.action },
        }),
      ).toBe(0);
    });
    it(`${kind}: check-in that holds the order lock commits before a refund request`, async () => {
      const f = await fixture(),
        locked = latch(),
        release = latch(),
        reserving = latch();
      const gated = db.$extends({
        query: {
          $queryRaw: async ({ args, query }) => {
            const result = await query(args);
            locked.signal();
            await release.promise;
            return result;
          },
        },
      });
      const refundDb = db.$extends({
        query: {
          order: {
            updateMany: async ({ args, query }) => {
              if (
                args.where?.id === f.orderId &&
                args.data.status === 'REFUND_PENDING'
              )
                reserving.signal();
              return query(args);
            },
          },
        },
      });
      const refundService = new OrdersService(
        refundDb as never,
        new ConfigService({ PAYMENT_PROVIDER: 'wechat' }),
        createOrderFinalizerService(
          new ConsignmentSettlementService(refundDb as never),
        ),
        {} as never,
      );
      const checking = capture(f.check(gated as never));
      await locked.promise;
      const requesting = capture(
        refundService.requestRefund(
          f.orderId,
          {
            amountCents: 1000,
            reason: '签到后申请退款',
            idempotencyKey: key(),
          },
          f.buyer,
        ),
      );
      try {
        await reserving.promise;
      } finally {
        release.signal();
      }
      expect((await checking).error).toBeUndefined();
      const result = await requesting;
      expect(result.error).toBeUndefined();
      expect((await f.row()).status).toBe('CHECKED_IN');
      await expect(f.check()).rejects.toMatchObject({ status: 409 });
      await orders.approveRefund(
        result.value!.id,
        { reason: '同意退款' },
        finance,
      );
      expect((await f.row()).status).toBe('REFUNDED');
      await expect(f.check()).rejects.toMatchObject({ status: 409 });
      expect(
        await db.auditLog.count({
          where: { objectId: f.id, action: f.action },
        }),
      ).toBe(1);
    });
    it(`${kind}: concurrent scans leave one audit and one stable timestamp`, async () => {
      const f = await fixture(),
        read = latch(),
        resume = latch();
      let arrivals = 0;
      const gated = db.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              const row: any = await query(args);
              if (
                model.toLowerCase() === f.model.toLowerCase() &&
                operation === 'findFirst' &&
                row?.id === f.id &&
                ++arrivals <= 2
              ) {
                if (arrivals === 2) read.signal();
                await resume.promise;
              }
              return row;
            },
          },
        },
      });
      const a = capture(f.check(gated as never)),
        b = capture(f.check(gated as never));
      await read.promise;
      resume.signal();
      const results = await Promise.all([a, b]);
      expect(results.filter((x) => !x.error)).toHaveLength(1);
      expect(results.find((x) => x.error)?.error).toMatchObject({
        status: 409,
      });
      const saved = await f.row();
      await f.check();
      expect((await f.row()).checkedInAt).toEqual(saved.checkedInAt);
      expect(
        await db.auditLog.count({
          where: { objectId: f.id, action: f.action },
        }),
      ).toBe(1);
    });
  }
  it('stale rejection cannot revoke a newly approved HOST role', async () => {
    const applicant = await person(),
      profile = await games.applyHost(applicant),
      read = latch(),
      resume = latch();
    const gated = db.$extends({
      query: {
        hostProfile: {
          findUnique: async ({ args, query }) => {
            const row = await query(args);
            if (args.where.userId === applicant.sub) {
              read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const rejecting = capture(
      new GamesService(gated as never).rejectHost(
        applicant.sub,
        { reason: '旧页面驳回' },
        admin,
      ),
    );
    await read.promise;
    try {
      await games.approveHost(applicant.sub, {}, admin);
    } finally {
      resume.signal();
    }
    expect((await rejecting).error).toMatchObject({ status: 409 });
    expect(
      (
        await db.hostProfile.findUniqueOrThrow({
          where: { userId: applicant.sub },
        })
      ).status,
    ).toBe('APPROVED');
    expect(
      await db.userRole.count({
        where: { userId: applicant.sub, role: 'HOST' },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { objectId: profile.id, action: 'HOST_REJECTED' },
      }),
    ).toBe(0);
  });
  it('old approval cannot consume a resubmitted APPLIED application (ABA)', async () => {
    const applicant = await person(),
      profile = await games.applyHost(applicant),
      read = latch(),
      resume = latch();
    const gated = db.$extends({
      query: {
        hostProfile: {
          findUnique: async ({ args, query }) => {
            const row = await query(args);
            if (args.where.userId === applicant.sub) {
              read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const approving = capture(
      new GamesService(gated as never).approveHost(applicant.sub, {}, admin),
    );
    await read.promise;
    try {
      await games.rejectHost(applicant.sub, { reason: '材料不完整' }, admin);
      await games.applyHost(applicant);
    } finally {
      resume.signal();
    }
    expect((await approving).error).toMatchObject({ status: 409 });
    expect(
      (
        await db.hostProfile.findUniqueOrThrow({
          where: { userId: applicant.sub },
        })
      ).status,
    ).toBe('APPLIED');
    expect(
      await db.userRole.count({
        where: { userId: applicant.sub, role: 'HOST' },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { objectId: profile.id, action: 'HOST_APPROVED' },
      }),
    ).toBe(0);
    await games.approveHost(applicant.sub, {}, admin);
    await games.approveHost(applicant.sub, {}, admin);
    expect(
      await db.auditLog.count({
        where: { objectId: profile.id, action: 'HOST_APPROVED' },
      }),
    ).toBe(1);
  });
  it('stale reapplication cannot reset a later approved application', async () => {
    const applicant = await person(),
      profile = await games.applyHost(applicant);
    await games.rejectHost(applicant.sub, { reason: '材料不完整' }, admin);
    const read = latch(),
      resume = latch();
    const gated = db.$extends({
      query: {
        hostProfile: {
          findUnique: async ({ args, query }) => {
            const row = await query(args);
            if (args.where.userId === applicant.sub) {
              read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const applying = capture(
      new GamesService(gated as never).applyHost(applicant),
    );
    await read.promise;
    try {
      await games.applyHost(applicant);
      await games.approveHost(applicant.sub, {}, admin);
    } finally {
      resume.signal();
    }
    expect((await applying).error).toMatchObject({ status: 409 });
    expect(
      (
        await db.hostProfile.findUniqueOrThrow({
          where: { userId: applicant.sub },
        })
      ).status,
    ).toBe('APPROVED');
    expect(
      await db.userRole.count({
        where: { userId: applicant.sub, role: 'HOST' },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { objectId: profile.id, action: 'HOST_APPLIED' },
      }),
    ).toBe(2);
  });
  it('concurrent first applications produce one profile and one application audit', async () => {
    const applicant = await person(),
      read = latch(),
      resume = latch();
    let arrivals = 0;
    const gated = db.$extends({
      query: {
        hostProfile: {
          findUnique: async ({ args, query }) => {
            const row = await query(args);
            if (args.where.userId === applicant.sub && ++arrivals <= 2) {
              if (arrivals === 2) read.signal();
              await resume.promise;
            }
            return row;
          },
        },
      },
    });
    const service = new GamesService(gated as never);
    const a = capture(service.applyHost(applicant)),
      b = capture(service.applyHost(applicant));
    await read.promise;
    resume.signal();
    const results = await Promise.all([a, b]);
    expect(results.filter((x) => !x.error)).toHaveLength(1);
    expect(results.find((x) => x.error)?.error).toMatchObject({ status: 409 });
    const profile = await games.applyHost(applicant);
    expect(
      await db.auditLog.count({
        where: { objectId: profile.id, action: 'HOST_APPLIED' },
      }),
    ).toBe(1);
  });
  for (const decision of ['approve', 'reject'] as const) {
    it(`concurrent host ${decision} records one decision and stable roles`, async () => {
      const applicant = await person(),
        profile = await games.applyHost(applicant),
        read = latch(),
        resume = latch();
      let arrivals = 0;
      const gated = db.$extends({
        query: {
          hostProfile: {
            findUnique: async ({ args, query }) => {
              const row = await query(args);
              if (args.where.userId === applicant.sub && ++arrivals <= 2) {
                if (arrivals === 2) read.signal();
                await resume.promise;
              }
              return row;
            },
          },
        },
      });
      const decide = (service: GamesService) =>
        decision === 'approve'
          ? service.approveHost(applicant.sub, {}, admin)
          : service.rejectHost(
              applicant.sub,
              { reason: '材料不足请补充' },
              admin,
            );
      const service = new GamesService(gated as never);
      const a = capture(decide(service)),
        b = capture(decide(service));
      await read.promise;
      resume.signal();
      const results = await Promise.all([a, b]);
      expect(results.filter((x) => !x.error)).toHaveLength(1);
      expect(results.find((x) => x.error)?.error).toMatchObject({
        status: 409,
      });
      await decide(games);
      expect(
        await db.userRole.count({
          where: { userId: applicant.sub, role: 'HOST' },
        }),
      ).toBe(decision === 'approve' ? 1 : 0);
      expect(
        await db.auditLog.count({
          where: {
            objectId: profile.id,
            action: decision === 'approve' ? 'HOST_APPROVED' : 'HOST_REJECTED',
          },
        }),
      ).toBe(1);
    });
  }
});
