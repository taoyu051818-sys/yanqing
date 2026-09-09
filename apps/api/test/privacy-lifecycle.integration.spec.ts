import { createOrderFinalizerService } from './support/domain-consumer-fixtures.js';
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
import { PrivacyService } from '../src/privacy/privacy.service.js';
import { OrdersService } from './support/orders-fixture.js';

import { MembershipsService } from './support/memberships-fixture.js';
import { VenuesService } from './support/venues-fixture.js';
import { AllianceService } from './support/alliance-fixture.js';
import { membershipEligibility } from '../src/memberships/membership-eligibility.js';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import type { AppRole } from '../src/generated/prisma/enums.js';

const url = process.env.TEST_DATABASE_URL;
const key = () => 'privacy-boundary-' + randomUUID();
const day = 86400000;
describe.skipIf(!url)('privacy fulfillment and entitlement boundaries', () => {
  let db: PrismaService, privacy: PrivacyService, orders: OrdersService;
  let admin: AuthUser, finance: AuthUser;
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) ||
      !target.pathname.endsWith('_test')
    )
      throw new Error('Local test database ending in _test required');
    db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
    await db.$connect();
    privacy = new PrivacyService(db);
    orders = new OrdersService(
      db,
      new ConfigService({ PAYMENT_PROVIDER: 'mock' }),
      createOrderFinalizerService({} as never),
      {} as never,
    );
    admin = await person('SUPER_ADMIN');
    finance = await person('FINANCE');
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await db?.$disconnect();
  });
  async function person(role: AppRole = 'MEMBER'): Promise<AuthUser> {
    const user = await db.user.create({
      data: {
        displayName: '隔离注销边界用户',
        openId: key(),
        primaryRole: role,
        memberProfile: { create: { tags: [] } },
      },
    });
    return { sub: user.id, displayName: user.displayName, roles: [role] };
  }
  async function request(buyer: AuthUser) {
    const result = await privacy.create(
      { reason: '隔离测试注销申请', idempotencyKey: key() },
      buyer,
    );
    await db.user.update({
      where: { id: buyer.sub },
      data: { status: 'DISABLED' },
    });
    return result;
  }
  const decision = () => ({
    reason: '隔离超级管理员复核',
    idempotencyKey: key(),
  });
  async function venue() {
    const buyer = await person();
    const court = await db.court.create({
      data: { code: key(), name: '隔离测试场地', zone: 'EAST', sortOrder: 1 },
    });
    const order = await db.order.create({
      data: {
        orderNo: key(),
        memberId: buyer.sub,
        businessType: 'VENUE',
        subjectAccount: 'VENUE',
        sourceChannel: 'MINI_PROGRAM',
        title: '未来场次',
        listAmountCents: 1000,
        payableCents: 1000,
        parameterSnapshot: {},
        bookings: {
          create: {
            courtId: court.id,
            memberId: buyer.sub,
            startsAt: new Date(Date.now() + day),
            endsAt: new Date(Date.now() + day + 3600000),
            holdExpiresAt: new Date(Date.now() + 600000),
          },
        },
      },
    });
    await orders.pay(
      order.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );
    return { buyer, order };
  }
  async function partialRefund(orderId: string, buyer: AuthUser) {
    const refund = await orders.requestRefund(
      orderId,
      { amountCents: 100, reason: '隔离部分退款', idempotencyKey: key() },
      buyer,
    );
    await orders.approveRefund(refund.id, { reason: '隔离财务复核' }, finance);
  }
  it('blocks anonymization until the partially refunded booking is fulfilled', async () => {
    const { buyer, order } = await venue();
    await partialRefund(order.id, buyer);
    const erasure = await request(buyer);
    expect(
      await db.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      paidCents: 1000,
      refundedCents: 100,
      completedAt: null,
    });
    expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
      expect.objectContaining({ code: 'ACTIVE_ORDER' }),
    );
    await expect(
      privacy.complete(erasure.id, decision(), admin),
    ).rejects.toThrow('未完成业务');
    expect(
      await db.user.findUniqueOrThrow({ where: { id: buyer.sub } }),
    ).toMatchObject({
      status: 'DISABLED',
      deletedAt: null,
      openId: expect.any(String),
    });
    expect(
      (
        await db.dataErasureRequest.findUniqueOrThrow({
          where: { id: erasure.id },
        })
      ).status,
    ).toBe('REQUESTED');
    expect(
      await db.courtBooking.findUniqueOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({ status: 'CONFIRMED', memberId: buyer.sub });
  });
  it('blocks the same future booking before a partial refund (control)', async () => {
    const { buyer } = await venue();
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
      expect.objectContaining({ code: 'ACTIVE_ORDER' }),
    );
    await expect(
      privacy.complete(erasure.id, decision(), admin),
    ).rejects.toThrow('未完成业务');
  });
  it('allows a fully refunded cancelled booking (control)', async () => {
    const { buyer, order } = await venue();
    const refund = await orders.requestRefund(
      order.id,
      { amountCents: 1000, reason: '隔离全额退款', idempotencyKey: key() },
      buyer,
    );
    await orders.approveRefund(refund.id, { reason: '隔离财务复核' }, finance);
    const erasure = await request(buyer);
    expect(
      await db.courtBooking.findUniqueOrThrow({ where: { orderId: order.id } }),
    ).toMatchObject({ status: 'CANCELLED' });
    expect(await privacy.blockers(erasure.id, admin)).toEqual([]);
    await privacy.complete(erasure.id, decision(), admin);
  });
  it('allows a membership to expire naturally without a status cleanup job', async () => {
    const buyer = await person();
    const product = await db.membershipProduct.create({
      data: {
        code: ('R13-' + randomUUID().slice(0, 8)).toUpperCase(),
        version: 1,
        name: '隔离一天会员',
        level: 'GOLD',
        priceCents: 1000,
        durationDays: 1,
        benefits: {},
        effectiveFrom: new Date(Date.now() - day),
        enabled: true,
        creationIdempotencyKey: key(),
        creationCommandHash: 'a'.repeat(64),
        createdById: admin.sub,
      },
    });
    const order = await new MembershipsService(db).purchase(
      { productId: product.id, creationIdempotencyKey: key() },
      buyer,
    );
    await orders.pay(
      order.id,
      { channel: 'WECHAT', idempotencyKey: key() },
      buyer,
    );
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
      expect.objectContaining({ code: 'ACTIVE_MEMBERSHIP' }),
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    const subscription = await db.memberSubscription.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    vi.setSystemTime(subscription.endsAt);
    const profile = await db.memberProfile.findUniqueOrThrow({
      where: { userId: buyer.sub },
    });
    expect(membershipEligibility(profile).reason).toBe('EXPIRED');
    expect(await privacy.blockers(erasure.id, admin)).toEqual([]);
    await privacy.complete(erasure.id, decision(), admin);
    expect(
      (
        await db.memberSubscription.findUniqueOrThrow({
          where: { id: subscription.id },
        })
      ).status,
    ).toBe('ACTIVE');
  });
  it('allows a naturally expired coupon without deleting its claim history', async () => {
    const buyer = await person();
    const merchant = await db.merchant.create({
      data: {
        code: key(),
        name: '隔离商户',
        category: '测试',
        level: 'MEMBER_BENEFIT',
        settlementRule: {},
      },
    });
    const template = await db.couponTemplate.create({
      data: {
        code: key(),
        merchantId: merchant.id,
        name: '隔离一天券',
        activityName: '隔离活动',
        benefitDescription: '隔离权益',
        validFrom: new Date(Date.now() - day),
        validTo: new Date(Date.now() + day),
        issueLimit: 1,
      },
    });
    const alliance = new AllianceService(db);
    const codes = await alliance.generateCodes(
      template.id,
      { count: 1, idempotencyKey: key() },
      admin,
    );
    await alliance.claim(codes.codes[0], buyer);
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
      expect.objectContaining({ code: 'CLAIMED_COUPON' }),
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(template.validTo);
    await expect(
      alliance.redeem(
        {
          code: codes.codes[0],
          merchantId: merchant.id,
          attributedAmountCents: 0,
          idempotencyKey: key(),
        },
        admin,
      ),
    ).rejects.toThrow('券码已过期');
    expect(await privacy.blockers(erasure.id, admin)).toEqual([]);
    await privacy.complete(erasure.id, decision(), admin);
    expect(
      (
        await db.couponCode.findUniqueOrThrow({
          where: { code: codes.codes[0] },
        })
      ).status,
    ).toBe('CLAIMED');
  });
  it('allows an account with no outstanding business (control)', async () => {
    const buyer = await person();
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toEqual([]);
    await privacy.complete(erasure.id, decision(), admin);
    expect(
      await db.user.findUniqueOrThrow({ where: { id: buyer.sub } }),
    ).toMatchObject({ status: 'DELETED' });
  });
  it('allows a partially refunded order after its booking has been fulfilled', async () => {
    const { buyer, order } = await venue();
    await partialRefund(order.id, buyer);
    const booking = await db.courtBooking.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(booking.endsAt.getTime() + 1000);
    await new VenuesService(db).completeBooking(
      order.id,
      {
        outcome: 'NO_SHOW',
        reason: '预约结束且会员未到场',
        idempotencyKey: key(),
        evidence: {
          source: 'COURT_INSPECTION',
          observedAt: booking.endsAt.toISOString(),
        },
      },
      admin,
    );
    const completed = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(completed.status).toBe('PARTIALLY_REFUNDED');
    expect(completed.completedAt).not.toBeNull();
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toEqual([]);
    await privacy.complete(erasure.id, decision(), admin);
  });

  it('does not trust completion timestamps while a booking is still confirmed', async () => {
    const { buyer, order } = await venue();
    await partialRefund(order.id, buyer);
    // A legacy inconsistent order must not erase a still-active reservation.
    await db.order.update({
      where: { id: order.id },
      data: { completedAt: new Date() },
    });
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
      expect.objectContaining({ code: 'ACTIVE_ORDER' }),
    );
    await expect(
      privacy.complete(erasure.id, decision(), admin),
    ).rejects.toThrow('未完成业务');
  });

  it('protects prepaid memberships whose validity has not started yet', async () => {
    const buyer = await person();
    const profile = await db.memberProfile.findUniqueOrThrow({
      where: { userId: buyer.sub },
    });
    const product = await db.membershipProduct.create({
      data: {
        code: ('R13-' + randomUUID().slice(0, 8)).toUpperCase(),
        version: 1,
        name: '隔离未来会员',
        level: 'GOLD',
        priceCents: 1000,
        durationDays: 1,
        benefits: {},
        effectiveFrom: new Date(Date.now() - day),
        enabled: true,
        creationIdempotencyKey: key(),
        creationCommandHash: 'a'.repeat(64),
        createdById: admin.sub,
      },
    });
    await db.memberSubscription.create({
      data: {
        memberId: profile.id,
        productId: product.id,
        startsAt: new Date(Date.now() + day),
        endsAt: new Date(Date.now() + 2 * day),
        status: 'ACTIVE',
      },
    });
    const erasure = await request(buyer);
    expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
      expect.objectContaining({ code: 'ACTIVE_MEMBERSHIP' }),
    );
    await expect(
      privacy.complete(erasure.id, decision(), admin),
    ).rejects.toThrow('未完成业务');
  });

  it.each(['CODE_EXPIRED', 'TEMPLATE_EXPIRED', 'PAUSED', 'FUTURE'] as const)(
    'uses expiry rather than temporary availability for coupons: %s',
    async (variant) => {
      const buyer = await person();
      const merchant = await db.merchant.create({
        data: {
          code: key(),
          name: '隔离商户',
          category: '测试',
          level: 'MEMBER_BENEFIT',
          settlementRule: {},
          status: variant === 'PAUSED' ? 'DISABLED' : 'ACTIVE',
        },
      });
      const now = new Date();
      const template = await db.couponTemplate.create({
        data: {
          code: key(),
          merchantId: merchant.id,
          name: '隔离有效期券',
          activityName: '隔离活动',
          benefitDescription: '隔离权益',
          validFrom: new Date(+now + (variant === 'FUTURE' ? day : -day)),
          validTo: new Date(
            +now + (variant === 'TEMPLATE_EXPIRED' ? 0 : 2 * day),
          ),
          issueLimit: 1,
          enabled: variant !== 'PAUSED',
        },
      });
      await db.couponCode.create({
        data: {
          templateId: template.id,
          code: key(),
          holderId: buyer.sub,
          status: 'CLAIMED',
          claimedAt: new Date(+now - day),
          expiresAt: new Date(
            +now + (variant === 'CODE_EXPIRED' ? 0 : 2 * day),
          ),
        },
      });
      const erasure = await request(buyer);
      if (variant === 'CODE_EXPIRED' || variant === 'TEMPLATE_EXPIRED') {
        expect(await privacy.blockers(erasure.id, admin)).toEqual([]);
        await privacy.complete(erasure.id, decision(), admin);
      } else {
        expect(await privacy.blockers(erasure.id, admin)).toContainEqual(
          expect.objectContaining({ code: 'CLAIMED_COUPON' }),
        );
        await expect(
          privacy.complete(erasure.id, decision(), admin),
        ).rejects.toThrow('未完成业务');
      }
    },
  );
});
