import 'reflect-metadata';
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { from, lastValueFrom } from 'rxjs';
import { PrismaService } from '../src/database/prisma.service.js';
import { cancel } from '../src/games/cancellation/games-cancellation.commands.js';
import { requestRefund } from '../src/orders/refund-requests/orders-refund-requests.commands.js';
import { rejectRefund } from '../src/orders/refund-review/orders-refund-review.commands.js';
import { EventCancellationService } from '../src/events/catalog/event-cancellation.service.js';
import { EventCatalogService } from '../src/events/catalog/event-catalog.service.js';
import { EventRegistrationService } from '../src/events/registration/event-registration.service.js';
import { EventWithdrawalService } from '../src/events/registration/event-withdrawal.service.js';
import { EventRegistrationController } from '../src/events/registration/event-registration.controller.js';
import { ApiResponseInterceptor } from '../src/common/http/api-response.interceptor.js';

// Only an explicitly supplied local *_test database is allowed. Schema migrations
// are applied separately; no generated ORM/source or production data is modified.
const connection = process.env.TEST_DATABASE_URL;

const url = new URL(connection || 'postgresql://mac@127.0.0.1/unused_test');
if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_test'))
  throw new Error('Only local test DB allowed');
const prisma = new PrismaService({ getOrThrow: () => url.toString() } as never);
const run = randomUUID().slice(0, 8);
let serial = 0;
const key = (label: string) => `audit-${run}-${label}-${++serial}`;
async function actor(role: string = 'MEMBER') {
  const user = await prisma.user.create({
    data: {
      displayName: key(role),
      primaryRole: role as any,
      memberProfile: { create: { tags: [] } },
      roles: { create: { role: role as any } },
    },
  });
  return { sub: user.id, displayName: user.displayName, roles: [role] } as any;
}
async function paidOrder(member: any, type: 'GAME' | 'EVENT' | 'VENUE') {
  return prisma.order.create({
    data: {
      orderNo: key('order'),
      memberId: member.sub,
      createdById: member.sub,
      businessType: type,
      subjectAccount: 'VENUE',
      sourceChannel: 'MINI_PROGRAM',
      status: 'PAID',
      title: 'Synthetic prior payment fixture',
      listAmountCents: 6800,
      payableCents: 6800,
      paidCents: 6800,
      paidAt: new Date(),
      parameterSnapshot: { audit: true },
      payments: {
        create: {
          paymentNo: key('pay'),
          userId: member.sub,
          operatorId: member.sub,
          channel: 'WECHAT',
          status: 'SUCCEEDED',
          amountCents: 6800,
          paidAt: new Date(),
          idempotencyKey: key('pay-key'),
        },
      },
    },
  });
}
async function event(manager: any) {
  const catalog = new EventCatalogService(prisma);
  const created = await catalog.create(
    {
      code: key('event'),
      name: 'Synthetic audit event',
      startsAt: new Date(Date.now() + 10800000).toISOString(),
      registrationEndsAt: new Date(Date.now() + 7200000).toISOString(),
      capacityPeople: 24,
      minimumPeople: 24,
      totalRounds: 5,
      feeCents: 6800,
    } as any,
    manager,
  );
  return catalog.publish(created.id, {}, manager);
}
afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!connection)(
  'Cancellation refund obligations with all PostgreSQL constraints',
  () => {
    for (const type of ['GAME', 'EVENT'] as const)
      for (const amount of [6800, 1000]) {
        it(`${type}: existing ordinary ${amount} request becomes mandatory after whole cancellation`, async () => {
          const member = await actor(),
            manager = await actor(type === 'GAME' ? 'HOST' : 'EVENT_MANAGER'),
            finance = await actor('FINANCE');
          const order = await paidOrder(member, type);
          let activityId: string;
          let registrationId: string;
          if (type === 'GAME') {
            const game = await prisma.game.create({
              data: {
                code: key('game'),
                title: 'Synthetic audit game',
                hostId: manager.sub,
                level: 'MIXED',
                status: 'OPEN',
                startsAt: new Date(Date.now() + 3600000),
                endsAt: new Date(Date.now() + 7200000),
                capacity: 4,
                feeCents: 6800,
              },
            });
            activityId = game.id;
            registrationId = (
              await prisma.gameRegistration.create({
                data: {
                  gameId: game.id,
                  userId: member.sub,
                  orderId: order.id,
                  status: 'PAID',
                },
              })
            ).id;
          } else {
            activityId = (await event(manager)).id;
            registrationId = (
              await prisma.eventTeam.create({
                data: {
                  eventId: activityId,
                  captainId: member.sub,
                  orderId: order.id,
                  name: 'Synthetic paid team',
                  playerAName: 'Synthetic A',
                  playerBName: 'Synthetic B',
                  category: 'MIXED_DOUBLES',
                  seed: 1,
                  status: 'PAID',
                  opponents: [],
                  listAmountCents: 6800,
                  payableCents: 6800,
                },
              })
            ).id;
          }
          const ordinaryKey = key('ordinary-refund');
          const refund = await requestRefund(
            prisma,
            order.id,
            {
              amountCents: amount,
              reason: 'Synthetic ordinary refund',
              idempotencyKey: ordinaryKey,
            },
            member,
          );
          const dto = {
            reason: 'Synthetic venue closure',
            idempotencyKey: key('cancel'),
          };
          const cancelActivity = () =>
            type === 'GAME'
              ? cancel(prisma, activityId, dto, manager)
              : new EventCancellationService(prisma).cancel(
                  activityId,
                  dto,
                  manager,
                );
          let signalRead!: () => void, resumeRead!: () => void;
          const read = new Promise<void>((resolve) => {
            signalRead = resolve;
          });
          const resume = new Promise<void>((resolve) => {
            resumeRead = resolve;
          });
          const staleReviewer = prisma.$extends({
            query: {
              refund: {
                findUnique: async ({ args, query }) => {
                  const value = await query(args);
                  if (args.where.id === refund.id) {
                    signalRead();
                    await resume;
                  }
                  return value;
                },
              },
            },
          });
          // Pause the real reviewer after reading cancellationRequired=false. The
          // cancellation commits first; its flag must also defeat the reviewer's CAS.
          const staleRejection = rejectRefund(
            staleReviewer as never,
            refund.id,
            {},
            finance,
          ).then(
            () => null,
            (error: unknown) => error,
          );
          await read;
          let cancelled;
          try {
            cancelled = await cancelActivity();
          } finally {
            resumeRead();
          }
          expect(await staleRejection).toMatchObject({ status: 409 });
          expect(cancelled.refundRequestedCents).toBe(6800 - amount);
          await expect(
            rejectRefund(
              prisma,
              refund.id,
              { reason: 'Synthetic ordinary request rejection' },
              finance,
            ),
          ).rejects.toMatchObject({ status: 409 });
          const persisted = await prisma.order.findUniqueOrThrow({
            where: { id: order.id },
            include: { refunds: true },
          });
          const activity =
            type === 'GAME'
              ? await prisma.game.findUniqueOrThrow({
                  where: { id: activityId },
                })
              : await prisma.event.findUniqueOrThrow({
                  where: { id: activityId },
                });
          const registration =
            type === 'GAME'
              ? await prisma.gameRegistration.findUniqueOrThrow({
                  where: { id: registrationId },
                })
              : await prisma.eventTeam.findUniqueOrThrow({
                  where: { id: registrationId },
                });
          const active = persisted.refunds.filter((r) =>
            ['REQUESTED', 'APPROVED', 'PROCESSING'].includes(r.status),
          );
          const coverage = active.reduce((s, r) => s + r.amountCents, 0);
          expect(activity.status).toBe('CANCELLED');
          expect(registration.status).toBe('CANCELLED');
          expect(coverage).toBe(6800);
          expect(active.every((refund) => refund.cancellationRequired)).toBe(
            true,
          );
          expect(
            persisted.refunds.find((row) => row.id === refund.id)
              ?.idempotencyKey,
          ).toBe(ordinaryKey);
          expect(persisted.status).toBe('REFUND_PENDING');
          expect(persisted.refundedCents).toBe(0);
          expect((await cancelActivity()).idempotent).toBe(true);
          expect(
            await prisma.refund.count({ where: { orderId: order.id } }),
          ).toBe(persisted.refunds.length);
          for (const obligation of active) {
            let deferred = true;
            const provider = {
              createRefund: async () => {
                if (deferred) {
                  deferred = false;
                  throw new Error('Synthetic provider timeout');
                }
                return { status: 'SUCCESS', refundId: key('provider-refund') };
              },
            };
            const wechatConfig = new ConfigService({
              PAYMENT_PROVIDER: 'wechat',
            });
            await approveRefund(
              prisma,
              wechatConfig,
              finalizer,
              provider as never,
              obligation.id,
              {},
              finance,
            );
            expect(
              await prisma.refund.findUniqueOrThrow({
                where: { id: obligation.id },
              }),
            ).toMatchObject({ status: 'APPROVED', cancellationRequired: true });
            await expect(
              rejectRefund(prisma, obligation.id, {}, finance),
            ).rejects.toMatchObject({ status: 409 });
            await approveRefund(
              prisma,
              wechatConfig,
              finalizer,
              provider as never,
              obligation.id,
              {},
              finance,
            );
          }
          const completed = await prisma.order.findUniqueOrThrow({
            where: { id: order.id },
            include: { refunds: true },
          });
          expect(completed).toMatchObject({
            status: 'REFUNDED',
            refundedCents: 6800,
          });
          expect(
            completed.refunds.every(
              (row) => row.status === 'SUCCEEDED' && row.cancellationRequired,
            ),
          ).toBe(true);
          expect((await cancelActivity()).idempotent).toBe(true);
          expect(
            await prisma.refund.count({ where: { orderId: order.id } }),
          ).toBe(persisted.refunds.length);
        });
      }
  },
);

it.skipIf(!connection)(
  'EVENT-001: actual signup/cancel response hides the promoted stranger',
  async () => {
    const manager = await actor('EVENT_MANAGER');
    const e = await event(manager);
    const registrationService = new EventRegistrationService(prisma);
    const members: any[] = [];
    for (let i = 0; i < 13; i++) {
      const member = await actor();
      members.push(member);
      const result: any = await registrationService.register(
        e.id,
        {
          registrationMode: 'MANUAL',
          captainPlays: true,
          consent: true,
          name: `Synthetic team ${i}`,
          playerAName: `Synthetic A ${i}`,
          playerBName: `Synthetic B ${i}`,
          playerAPhone: `1389900${String(i * 2 + 1).padStart(4, '0')}`,
          playerBPhone: `1389900${String(i * 2 + 2).padStart(4, '0')}`,
          category: 'MIXED_DOUBLES',
          sourceChannel: 'MINI_PROGRAM',
          creationIdempotencyKey: key('signup'),
        } as any,
        member,
      );
      expect(i === 12 ? result.status : result.businessType).toBe(
        i === 12 ? 'WAITLISTED' : 'EVENT',
      );
    }
    const before = await prisma.eventTeam.findFirstOrThrow({
      where: { eventId: e.id, captainId: members[12].sub },
    });
    const withdrawal = new EventWithdrawalService(prisma);
    const controller = new EventRegistrationController(
      {} as any,
      registrationService,
      withdrawal,
    );
    const payloadPromise = controller.cancelRegistration(
      e.id,
      {
        reason: 'Synthetic member withdrawal',
        idempotencyKey: key('withdrawal'),
      },
      members[0],
    );
    const wrapped: any = await lastValueFrom(
      new ApiResponseInterceptor().intercept(
        {
          switchToHttp: () => ({ getRequest: () => ({ requestId: 'audit' }) }),
        } as any,
        { handle: () => from(payloadPromise) },
      ),
    );
    const json = JSON.parse(JSON.stringify(wrapped));
    expect(json.data).not.toHaveProperty('promotion');
    expect(json.data.registration.status).toBe('CANCELLED');
    const serialized = JSON.stringify(json);
    for (const foreign of [
      before.playerAPhone,
      before.playerBPhone,
      before.playerAName,
      before.playerBName,
      members[12].sub,
    ])
      expect(serialized).not.toContain(foreign);
    expect(serialized).not.toMatch(
      /parameterSnapshot|creationCommandHash|cancelCommandHash|cancelIdempotencyKey/,
    );
    expect(
      (await prisma.eventTeam.findUniqueOrThrow({ where: { id: before.id } }))
        .status,
    ).toBe('REGISTERED');
  },
);

import { ConfigService } from '@nestjs/config';
import { approveRefund } from '../src/orders/refund-review/orders-refund-review.commands.js';
import { OrderFinalizerService } from '../src/payments/order-finalizer.service.js';
import {
  checkIn,
  completeBooking,
} from '../src/venues/fulfillment/venues-fulfillment.commands.js';
import { reviseSettlement } from '../src/alliance/settlements/alliance-settlement-revision.js';
import {
  createSettlement,
  submitSettlement,
  disputeSettlement,
  confirmSettlement,
  settleSettlement,
} from '../src/alliance/settlements/alliance-settlements.commands.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { loadAllianceSettlements } from '../src/dashboard/domains/marketing-queries.js';

// Synthetic pre-existing payment evidence; the mock payment provider never moves money.
const finalizer = new OrderFinalizerService({} as never);
const mockConfig = new ConfigService({ PAYMENT_PROVIDER: 'mock' });

describe.skipIf(!connection)(
  'venue fulfillment and settlement corrections on PostgreSQL',
  () => {
    it('preserves partial refund through check-in, repeat scan and completion; blocks full refund', async () => {
      const buyer = await actor(),
        admin = await actor('ADMIN'),
        finance = await actor('FINANCE');
      for (const amount of [1000, 6800]) {
        const order = await paidOrder(buyer, 'VENUE');
        const court = await prisma.court.create({
          data: {
            code: key('court'),
            name: 'Synthetic court',
            zone: 'EAST',
            usage: 'RETAIL',
            sortOrder: 99,
          },
        });
        const startsAt = new Date(Date.now() - 20 * 60000),
          endsAt = new Date(Date.now() - 10 * 60000);
        const booking = await prisma.courtBooking.create({
          data: {
            courtId: court.id,
            orderId: order.id,
            memberId: buyer.sub,
            startsAt,
            endsAt,
            status: 'CONFIRMED',
          },
        });
        const refund = await requestRefund(
          prisma,
          order.id,
          {
            amountCents: amount,
            reason: 'Synthetic partial refund',
            idempotencyKey: key('refund'),
          },
          buyer,
        );
        await approveRefund(
          prisma,
          mockConfig,
          finalizer,
          {} as never,
          refund.id,
          {},
          finance,
        );
        if (amount === 6800) {
          await expect(checkIn(prisma, order.id, admin)).rejects.toMatchObject({
            status: 409,
          });
          expect(
            (
              await prisma.courtBooking.findUniqueOrThrow({
                where: { id: booking.id },
              })
            ).status,
          ).toBe('CANCELLED');
          continue;
        }
        expect((await checkIn(prisma, order.id, admin)).status).toBe(
          'PARTIALLY_REFUNDED',
        );
        expect((await checkIn(prisma, order.id, admin)).status).toBe(
          'PARTIALLY_REFUNDED',
        );
        expect(
          await prisma.auditLog.count({
            where: { objectId: order.id, action: 'VENUE_CHECK_IN' },
          }),
        ).toBe(1);
        expect(
          (
            await prisma.courtBooking.findUniqueOrThrow({
              where: { id: booking.id },
            })
          ).status,
        ).toBe('CHECKED_IN');
        const result = await completeBooking(
          prisma,
          order.id,
          {
            outcome: 'COMPLETED',
            reason: 'Synthetic inspection complete',
            evidence: {
              source: 'COURT_INSPECTION',
              observedAt: endsAt.toISOString(),
            },
            idempotencyKey: key('complete'),
          },
          admin,
        );
        expect(result).toMatchObject({
          status: 'PARTIALLY_REFUNDED',
          refundedCents: 1000,
          bookings: [{ status: 'COMPLETED' }],
        });
        expect(result.completedAt).not.toBeNull();
      }
    });

    it('revises a disputed draft with history, safely replays, and settles the same redemption only once', async () => {
      const finance = await actor('FINANCE'),
        admin = await actor('ADMIN'),
        member = await actor();
      const merchant = await prisma.merchant.create({
        data: {
          code: key('merchant'),
          name: 'Synthetic merchant',
          category: '餐饮',
          level: 'TRAFFIC_PARTNER',
          settlementRule: { mode: 'FIXED', amountCents: 1000 },
        },
      });
      const dto = {
        merchantId: merchant.id,
        periodStart: '2090-09-01T00:00:00+08:00',
        periodEnd: '2090-10-01T00:00:00+08:00',
        attributedGrossProfitCents: 10000,
      };
      const template = await prisma.couponTemplate.create({
        data: {
          code: key('template'),
          merchantId: merchant.id,
          name: 'Synthetic voucher',
          activityName: 'Synthetic campaign',
          benefitDescription: 'Synthetic benefit',
          validFrom: new Date(dto.periodStart),
          validTo: new Date(dto.periodEnd),
          issueLimit: 1,
          issuedCount: 1,
        },
      });
      const coupon = await prisma.couponCode.create({
        data: {
          templateId: template.id,
          code: key('coupon'),
          holderId: member.sub,
          status: 'REDEEMED',
          redeemedById: admin.sub,
          redeemedMerchantId: merchant.id,
          claimedAt: new Date('2090-09-10T00:00:00Z'),
          redeemedAt: new Date('2090-09-11T00:00:00Z'),
          createdAt: new Date('2090-09-09T00:00:00Z'),
          expiresAt: new Date(dto.periodEnd),
          attributedAmountCents: 20000,
        },
      });
      const created = await createSettlement(prisma, dto, finance);
      await submitSettlement(prisma, created.id, finance);
      await disputeSettlement(
        prisma,
        created.id,
        { reason: 'Synthetic profit dispute' },
        admin,
      );
      const correction = {
        attributedGrossProfitCents: 9000,
        reason: 'Synthetic source correction',
        idempotencyKey: key('revise'),
      };
      await expect(
        reviseSettlement(prisma, created.id, correction, member),
      ).rejects.toMatchObject({ status: 403 });
      const revised = await reviseSettlement(
        prisma,
        created.id,
        correction,
        finance,
      );
      expect(revised).toMatchObject({
        status: 'DRAFT',
        attributedGrossProfitCents: 9000,
        cooperationFeeCents: 1000,
      });
      expect(revised.detail.revisionHistory).toHaveLength(1);
      expect(revised.detail.revisionHistory[0]).toMatchObject({
        before: { attributedGrossProfitCents: 10000 },
        after: { attributedGrossProfitCents: 9000 },
      });
      expect(JSON.stringify(revised)).not.toMatch(
        /idempotencyKey|commandHash|actorId/,
      );
      await reviseSettlement(prisma, created.id, correction, finance);
      await expect(
        reviseSettlement(
          prisma,
          created.id,
          { ...correction, attributedGrossProfitCents: 8000 },
          finance,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        await prisma.auditLog.count({
          where: {
            action: 'ALLIANCE_SETTLEMENT_REVISED',
            objectId: created.id,
          },
        }),
      ).toBe(1);
      await submitSettlement(prisma, created.id, finance);
      await confirmSettlement(prisma, created.id, admin);
      await settleSettlement(prisma, created.id, finance);
      await expect(
        reviseSettlement(
          prisma,
          created.id,
          { ...correction, idempotencyKey: key('new-revise') },
          finance,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await createSettlement(
            prisma,
            { ...dto, attributedGrossProfitCents: 9000 },
            finance,
          )
        ).id,
      ).toBe(created.id);
      expect(
        await prisma.allianceSettlement.count({
          where: { merchantId: merchant.id },
        }),
      ).toBe(1);
      const persisted = await prisma.allianceSettlement.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(persisted.detail).toMatchObject({ codeIds: [coupon.id] });
      expect(persisted.redeemedCount).toBe(1);
    });

    it('counts a monthly statement on its settlement day, independently of redemption activity', async () => {
      const merchant = await prisma.merchant.create({
        data: {
          code: key('merchant'),
          name: 'Synthetic statement merchant',
          category: '餐饮',
          level: 'TRAFFIC_PARTNER',
          settlementRule: {},
        },
      });
      const start = new Date('2091-09-01T00:00:00Z'),
        end = new Date('2091-10-01T00:00:00Z');
      const postingDay = new Date('2091-10-02T00:00:00Z');
      const priorFee =
        (
          await loadAllianceSettlements(
            prisma,
            postingDay,
            new Date(postingDay.getTime() + 86400000),
          )
        )._sum.cooperationFeeCents ?? 0;
      await prisma.allianceSettlement.create({
        data: {
          merchantId: merchant.id,
          periodStart: start,
          periodEnd: end,
          status: 'SETTLED',
          settledAt: new Date('2091-10-02T00:00:00Z'),
          issuedCount: 31,
          claimedCount: 31,
          redeemedCount: 31,
          effectiveNewCustomers: 1,
          attributedGmvCents: 310000,
          attributedGrossProfitCents: 62000,
          cooperationFeeCents: 31000,
          detail: {},
        },
      });
      for (const date of [
        '2091-09-12',
        '2091-09-13',
        '2091-10-01',
        '2091-10-03',
      ]) {
        const day = new Date(date + 'T00:00:00Z');
        const result = await loadAllianceSettlements(
          prisma,
          day,
          new Date(day.getTime() + 86400000),
        );
        expect(result._sum.cooperationFeeCents ?? 0).toBe(0);
      }
      const day = new Date('2091-10-02T00:00:00Z');
      expect(
        (
          await loadAllianceSettlements(
            prisma,
            day,
            new Date(day.getTime() + 86400000),
          )
        )._sum.cooperationFeeCents,
      ).toBe(priorFee + 31000);
    });

    it('excludes cancelled, unpaid, waitlisted and withdrawal-pending registrations from participants', async () => {
      const manager = await actor('EVENT_MANAGER'),
        buyer = await actor();
      const date = new Date('2092-09-12T00:00:00Z');
      const prior = (
        await new DashboardService(prisma).overview(
          date,
          new Date(date.getTime() + 86400000),
        )
      ).events;
      const events = [];
      for (let idx = 0; idx < 4; idx++) events.push(await event(manager));
      for (const [idx, status] of [
        'CANCELLED',
        'REGISTERED',
        'WAITLISTED',
        'CHECKED_IN',
        'PAID',
      ].entries()) {
        const order = ['REGISTERED', 'PAID', 'CHECKED_IN'].includes(status)
          ? await paidOrder(buyer, 'EVENT')
          : null;
        if (status === 'REGISTERED' && order) {
          await prisma.payment.deleteMany({ where: { orderId: order.id } });
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'PENDING', paidCents: 0, paidAt: null },
          });
        }
        await prisma.eventTeam.create({
          data: {
            eventId: events[[0, 1, 2, 0, 3][idx]].id,
            captainId: buyer.sub,
            orderId: order?.id,
            paymentDueAt:
              status === 'REGISTERED'
                ? new Date(date.getTime() + 900000)
                : null,
            waitlistedAt: status === 'WAITLISTED' ? date : null,
            checkedInAt: status === 'CHECKED_IN' ? date : null,
            name: key('stat-team'),
            playerAName: 'Synthetic player',
            playerBName: 'Synthetic partner',
            category: 'MIXED_DOUBLES',
            seed: idx + 1,
            status: status as any,
            cancelledAt: status === 'CANCELLED' ? date : null,
            cancellationPending: idx === 4,
            opponents: [],
            createdAt: date,
            ...(idx === 4
              ? {
                  cancelRequestedAt: date,
                  cancelReason: 'Synthetic withdrawal pending',
                  cancelIdempotencyKey: key('withdrawal-key'),
                  cancelCommandHash: 'a'.repeat(64),
                  cancelledById: buyer.sub,
                }
              : {}),
          },
        });
      }
      const result = await new DashboardService(prisma).overview(
        date,
        new Date(date.getTime() + 86400000),
      );
      expect(result.events).toMatchObject({
        createdRegistrations: prior.createdRegistrations + 5,
        registrations: prior.registrations + 1,
        unpaidRegistrations: prior.unpaidRegistrations + 1,
        waitlistedRegistrations: prior.waitlistedRegistrations + 1,
        checkedInRegistrations: prior.checkedInRegistrations + 1,
        participantCount: prior.participantCount + 1,
        repeatedParticipantCount: prior.repeatedParticipantCount,
      });
    });
  },
);
