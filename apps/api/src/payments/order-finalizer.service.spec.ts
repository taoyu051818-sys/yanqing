import { describe, expect, it, vi } from 'vitest';

import { ConflictException } from '@nestjs/common';
import {
  AppRole,
  BusinessType,
  PaymentChannel,
  PaymentStatus,
  SubjectAccount,
} from '../generated/prisma/enums.js';
import { OrderFinalizerService } from './order-finalizer.service.js';

const consignmentHooks = () => ({
  recordCompletedGoodsSale: vi.fn().mockResolvedValue([]),
  recordSucceededGoodsRefund: vi.fn().mockResolvedValue([]),
});

const baseOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-1',
  orderNo: 'VN-1',
  memberId: 'member-1',
  businessType: BusinessType.VENUE,
  subjectAccount: SubjectAccount.VENUE,
  paymentChannel: null,
  sourceChannel: 'MINI_PROGRAM',
  status: 'PENDING',
  title: '3号场晚场',
  listAmountCents: 6800,
  discountCents: 2000,
  payableCents: 4800,
  paidCents: 0,
  refundedCents: 0,
  parameterSnapshot: {},
  consumedCouponCode: 'YQ-COUPON-1',
  items: [],
  membership: null,
  ...overrides,
});

const payment = {
  id: 'payment-1',
  paymentNo: 'PAY-1',
  channel: PaymentChannel.WECHAT,
  amountCents: 4800,
  status: PaymentStatus.SUCCEEDED,
};

function setup(coupon: Record<string, unknown>) {
  const tx = {
    order: {
      findUnique: vi.fn().mockResolvedValue({
        status: 'PENDING',
        paidCents: 0,
        paymentChannel: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    trainingEnrollment: { findUnique: vi.fn().mockResolvedValue(null) },
    gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    eventTeam: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    couponCode: {
      findUnique: vi.fn().mockResolvedValue(coupon),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    couponTemplate: { update: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    service: new OrderFinalizerService(consignmentHooks() as never),
  };
}

describe('OrderFinalizerService coupon invariants', () => {
  it('redeems a claimed coupon exactly once for the paid order', async () => {
    const coupon = {
      id: 'coupon-1',
      templateId: 'template-1',
      status: 'CLAIMED',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      attributionOrderId: null,
      template: { merchantId: 'merchant-1' },
    };
    const { tx, service } = setup(coupon);

    await service.finalize(
      tx as never,
      baseOrder() as never,
      payment,
      'member-1',
      AppRole.MEMBER,
      new Date('2026-08-29T00:00:00Z'),
    );

    expect(tx.couponCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: coupon.id,
          status: 'CLAIMED',
          OR: [{ attributionOrderId: null }, { attributionOrderId: 'order-1' }],
        }),
      }),
    );
    expect(tx.couponTemplate.update).toHaveBeenCalledOnce();
  });

  it('rejects a second order that tries to use an already redeemed coupon', async () => {
    const coupon = {
      id: 'coupon-1',
      templateId: 'template-1',
      status: 'REDEEMED',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      attributionOrderId: 'order-other',
      template: { merchantId: 'merchant-1' },
    };
    const { tx, service } = setup(coupon);

    await expect(
      service.finalize(
        tx as never,
        baseOrder() as never,
        payment,
        'member-1',
        AppRole.MEMBER,
        new Date('2026-08-29T00:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.couponCode.updateMany).not.toHaveBeenCalled();
    expect(tx.couponTemplate.update).not.toHaveBeenCalled();
  });

  it('rejects a claimed coupon reserved by another order', async () => {
    const coupon = {
      id: 'coupon-1',
      templateId: 'template-1',
      status: 'CLAIMED',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      attributionOrderId: 'order-other',
      template: { merchantId: 'merchant-1' },
    };
    const { tx, service } = setup(coupon);

    await expect(
      service.finalize(
        tx as never,
        baseOrder() as never,
        payment,
        'member-1',
        AppRole.MEMBER,
        new Date('2026-08-29T00:00:00Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.couponCode.updateMany).not.toHaveBeenCalled();
  });
});

describe('OrderFinalizerService referral reward invariants', () => {
  const referralOrder = () => baseOrder({ consumedCouponCode: null });

  function setupReferral(referralReward: { upsert: ReturnType<typeof vi.fn> }) {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'PENDING',
          paidCents: 0,
          paymentChannel: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      trainingEnrollment: { findUnique: vi.fn().mockResolvedValue(null) },
      gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      eventTeam: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: {
        findUnique: vi.fn().mockResolvedValue({ referrerId: 'referrer-1' }),
      },
      systemParameter: { findFirst: vi.fn().mockResolvedValue(null) },
      referralReward,
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return {
      tx,
      service: new OrderFinalizerService(consignmentHooks() as never),
    };
  }

  it('checks uniqueness by member and trigger type, regardless of trigger order', async () => {
    const referralReward = {
      upsert: vi.fn().mockResolvedValue({
        id: 'reward-existing',
        triggerOrderId: 'order-1',
      }),
    };
    const { tx, service } = setupReferral(referralReward);

    await service.finalize(
      tx as never,
      referralOrder() as never,
      payment,
      'member-1',
      AppRole.MEMBER,
      new Date('2026-08-29T00:00:00Z'),
    );

    expect(referralReward.upsert).toHaveBeenCalledWith({
      where: {
        newUserId_triggerType: {
          newUserId: 'member-1',
          triggerType: 'FIRST_PAYMENT',
        },
      },
      update: {},
      create: expect.objectContaining({
        newUserId: 'member-1',
        triggerType: 'FIRST_PAYMENT',
        triggerOrderId: 'order-1',
        rewardValue: 100,
        newUserRewardValue: 50,
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'REFERRAL_REWARD_SCHEDULED',
        objectType: 'ReferralReward',
        objectId: 'reward-existing',
      }),
    });
  });

  it('uses the atomic upsert on a concurrent first-payment retry', async () => {
    const referralReward = {
      upsert: vi.fn().mockResolvedValue({
        id: 'reward-winner',
        triggerOrderId: 'order-1',
      }),
    };
    const { tx, service } = setupReferral(referralReward);

    await expect(
      service.finalize(
        tx as never,
        referralOrder() as never,
        payment,
        'member-1',
        AppRole.MEMBER,
        new Date('2026-08-29T00:00:00Z'),
      ),
    ).resolves.toBeUndefined();
    expect(referralReward.upsert).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
  });
});

describe('OrderFinalizerService training seat activation', () => {
  const now = new Date('2026-08-30T08:00:00.000Z');
  const trainingOrder = () =>
    baseOrder({
      businessType: BusinessType.TRAINING,
      consumedCouponCode: null,
    });

  function setupTraining(seatReservedUntil: Date | null, occupiedSeats = 3) {
    const enrollment = {
      id: 'enrollment-1',
      orderId: 'order-1',
      classId: 'class-1',
      status: 'PENDING_PAYMENT',
      totalAmountCents: 4_800,
      prepaidBalanceCents: 0,
      seatReservedUntil,
      class: { id: 'class-1', active: true, capacity: 4 },
    };
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'PENDING',
          paidCents: 0,
          paymentChannel: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      trainingEnrollment: {
        findUnique: vi.fn().mockResolvedValue(enrollment),
        count: vi.fn().mockResolvedValue(occupiedSeats),
        update: vi.fn().mockResolvedValue({ ...enrollment, status: 'ACTIVE' }),
      },
      gameRegistration: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      eventTeam: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    return {
      tx,
      service: new OrderFinalizerService(consignmentHooks() as never),
    };
  }

  it('activates a paid enrollment once and clears its seat hold', async () => {
    const { tx, service } = setupTraining(new Date(now.getTime() + 60_000));

    await expect(
      service.finalize(
        tx as never,
        trainingOrder() as never,
        payment,
        'member-1',
        AppRole.MEMBER,
        now,
      ),
    ).resolves.toBeUndefined();

    expect(tx.trainingEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enrollment-1' },
      data: {
        status: 'ACTIVE',
        prepaidBalanceCents: 4_800,
        seatReservedUntil: null,
      },
    });
  });

  it('rejects an expired hold or a class filled before finalization', async () => {
    const expired = setupTraining(new Date(now.getTime() - 1));
    await expect(
      expired.service.finalize(
        expired.tx as never,
        trainingOrder() as never,
        payment,
        'member-1',
        AppRole.MEMBER,
        now,
      ),
    ).rejects.toThrow('名额保留已过期');
    expect(expired.tx.trainingEnrollment.update).not.toHaveBeenCalled();

    const full = setupTraining(new Date(now.getTime() + 60_000), 4);
    await expect(
      full.service.finalize(
        full.tx as never,
        trainingOrder() as never,
        payment,
        'member-1',
        AppRole.MEMBER,
        now,
      ),
    ).rejects.toThrow('名额已满');
    expect(full.tx.trainingEnrollment.update).not.toHaveBeenCalled();
  });
});
