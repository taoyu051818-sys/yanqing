import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../src/common/auth/auth-user.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AppRole } from '../../src/generated/prisma/client.js';
import { OrderRefundReviewService } from '../../src/orders/refund-review/orders-refund-review.service.js';

export const connection = process.env.TEST_DATABASE_URL;
const url = new URL(connection || 'postgresql://mac@127.0.0.1/unused_test');
if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_test'))
  throw new Error(
    'Only an explicitly supplied local *_test database is allowed',
  );
export const database = () =>
  new PrismaService({ getOrThrow: () => url.toString() } as never);
export const key = (label: string) => `hardening-${label}-${randomUUID()}`;
export async function actor(
  prisma: PrismaService,
  role: AppRole = 'ADMIN',
): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      displayName: key(role),
      primaryRole: role,
      roles: { create: { role } },
      memberProfile: { create: { tags: [] } },
    },
  });
  return { sub: user.id, displayName: user.displayName, roles: [role] };
}

/** Only the external payment provider is simulated; all domain commands and DB writes are real. */
export function refundService(prisma: PrismaService) {
  const unexpectedExternalCall = new Proxy(
    {},
    {
      get() {
        throw new Error('Unexpected external payment or goods operation');
      },
    },
  );
  return new OrderRefundReviewService(
    prisma,
    {
      get: (name: string, fallback: unknown) =>
        name === 'PAYMENT_PROVIDER' ? 'mock' : fallback,
    } as never,
    unexpectedExternalCall as never,
    unexpectedExternalCall as never,
  );
}

/** Fault injection stays inside a real PostgreSQL transaction, after preceding writes. */
export function failAudit(prisma: PrismaService, action: string) {
  return prisma.$extends({
    query: {
      auditLog: {
        create: async ({ args, query }) => {
          if (args.data.action === action)
            throw new Error('Injected final audit failure');
          return query(args);
        },
      },
    },
  }) as unknown as PrismaService;
}

export async function paidActivity(
  prisma: PrismaService,
  type: 'GAME' | 'EVENT',
  manager: AuthUser,
) {
  const member = await actor(prisma, 'MEMBER');
  const order = await prisma.order.create({
    data: {
      orderNo: key('order'),
      memberId: member.sub,
      createdById: member.sub,
      businessType: type,
      subjectAccount: 'VENUE',
      sourceChannel: 'MINI_PROGRAM',
      status: 'PAID',
      title: 'Isolated cancellation test',
      listAmountCents: 6800,
      payableCents: 6800,
      paidCents: 6800,
      paidAt: new Date(),
      parameterSnapshot: {},
      payments: {
        create: {
          paymentNo: key('payment'),
          userId: member.sub,
          operatorId: member.sub,
          channel: 'WECHAT',
          status: 'SUCCEEDED',
          amountCents: 6800,
          paidAt: new Date(),
          idempotencyKey: key('payment-key'),
        },
      },
    },
  });
  if (type === 'GAME') {
    const game = await prisma.game.create({
      data: {
        code: key('game'),
        title: 'Isolated game',
        hostId: manager.sub,
        level: 'MIXED',
        status: 'OPEN',
        startsAt: new Date(Date.now() + 3600000),
        endsAt: new Date(Date.now() + 7200000),
        capacity: 4,
        feeCents: 6800,
      },
    });
    await prisma.gameRegistration.create({
      data: {
        gameId: game.id,
        userId: member.sub,
        orderId: order.id,
        status: 'PAID',
      },
    });
    return { id: game.id, order, member };
  }
  const event = await prisma.event.create({
    data: {
      code: key('event'),
      name: 'Isolated event',
      status: 'OPEN',
      startsAt: new Date(Date.now() + 10800000),
      registrationEndsAt: new Date(Date.now() + 7200000),
      capacityPeople: 24,
      minimumPeople: 24,
      totalRounds: 5,
      feeCents: 6800,
      rules: {},
    },
  });
  await prisma.eventTeam.create({
    data: {
      eventId: event.id,
      captainId: member.sub,
      orderId: order.id,
      name: 'Synthetic team',
      playerAName: 'Synthetic A',
      playerBName: 'Synthetic B',
      category: 'MIXED_DOUBLES',
      seed: 1,
      status: 'PAID',
      opponents: [],
      listAmountCents: 6800,
      payableCents: 6800,
    },
  });
  return { id: event.id, order, member };
}
