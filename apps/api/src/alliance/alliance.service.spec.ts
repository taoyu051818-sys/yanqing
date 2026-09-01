import { describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  AppRole,
  CouponStatus,
  MerchantLevel,
  SettlementStatus,
  UserStatus,
} from '../generated/prisma/enums.js';
import { AllianceService } from './alliance.service.js';

const finance: AuthUser = {
  sub: 'finance-1',
  displayName: '财务',
  roles: [AppRole.FINANCE],
};
const merchant: AuthUser = {
  sub: 'merchant-user',
  displayName: '商户',
  roles: [AppRole.MERCHANT],
};
const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
};
const admin: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};
const frontDesk: AuthUser = {
  sub: 'frontdesk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
};

const statement = (status: SettlementStatus = SettlementStatus.DRAFT) => ({
  id: 'statement-1',
  merchantId: 'merchant-1',
  status,
  detail: { codeIds: ['coupon-1'] },
  cooperationFeeCents: 1200,
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
});

describe('AllianceService redemption shift gate', () => {
  const command = {
    code: 'YQ-COFFEE-1',
    merchantId: 'merchant-1',
    attributedAmountCents: 2_800,
    idempotencyKey: 'redeem-shift-gate-1',
  };

  it('rejects a front-desk redemption when the operator has no open shift', async () => {
    const setup = makeRedemptionPrisma(null);
    const service = new AllianceService(setup.prisma as never);

    await expect(service.redeem(command, frontDesk)).rejects.toThrow(
      '当前前台未开班或今日班次已关闭',
    );
    expect(setup.shiftLookup).toHaveBeenCalledOnce();
    expect(setup.updateMany).not.toHaveBeenCalled();
    expect(setup.auditCreate).not.toHaveBeenCalled();
  });

  it('binds a front-desk redemption to the open shift in the business audit', async () => {
    const setup = makeRedemptionPrisma('shift-open-1');
    const service = new AllianceService(setup.prisma as never);

    const result = await service.redeem(command, frontDesk);
    expect(result).toMatchObject({
      id: 'coupon-1',
      status: CouponStatus.REDEEMED,
    });
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(setup.updateMany).toHaveBeenCalledOnce();
    expect(setup.auditCreate).toHaveBeenCalledTimes(1);
    expect(setup.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ALLIANCE_COUPON_REDEEMED',
          newValue: expect.objectContaining({
            frontDeskShiftId: 'shift-open-1',
            adminEmergencyBypass: false,
          }),
        }),
      }),
    );
  });

  it('records a separate emergency-bypass audit for an administrator', async () => {
    const setup = makeRedemptionPrisma(null);
    const service = new AllianceService(setup.prisma as never);

    await expect(service.redeem(command, admin)).resolves.toMatchObject({
      id: 'coupon-1',
    });
    expect(setup.shiftLookup).not.toHaveBeenCalled();
    expect(setup.auditCreate).toHaveBeenCalledTimes(2);
    expect(setup.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'FRONT_DESK_SHIFT_GATE_BYPASSED',
          newValue: expect.objectContaining({
            operation: 'ALLIANCE_COUPON_REDEEM',
          }),
        }),
      }),
    );
  });

  it('does not impose the venue shift lifecycle on a merchant-owned till', async () => {
    const setup = makeRedemptionPrisma(null);
    const service = new AllianceService(setup.prisma as never);

    await expect(service.redeem(command, merchant)).resolves.toMatchObject({
      id: 'coupon-1',
    });
    expect(setup.shiftLookup).not.toHaveBeenCalled();
    expect(setup.auditCreate).toHaveBeenCalledTimes(1);
  });
});

const makeTransitionPrisma = (initial: ReturnType<typeof statement>) => {
  let current = { ...initial };
  const findUnique = vi.fn().mockImplementation(async () => ({ ...current }));
  const updateMany = vi
    .fn()
    .mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { status: SettlementStatus };
        data: Record<string, unknown>;
      }) => {
        if (current.status !== where.status) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      },
    );
  const findUniqueOrThrow = vi
    .fn()
    .mockImplementation(async () => ({ ...current }));
  const tx = {
    allianceSettlement: { findUnique, updateMany, findUniqueOrThrow },
    reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (value: typeof tx) => unknown) =>
      work(tx),
    ),
    userRole: {
      findFirst: vi.fn().mockResolvedValue({ merchantId: 'merchant-1' }),
    },
    allianceSettlement: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, tx, current: () => current };
};

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

const makeRedemptionPrisma = (shiftId: string | null = 'shift-1') => {
  const coupon = {
    id: 'coupon-1',
    code: 'YQ-COFFEE-1',
    templateId: 'template-1',
    template: { merchantId: 'merchant-1' },
    status: CouponStatus.CLAIMED,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  };
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const auditCreate = vi.fn().mockResolvedValue({});
  const shiftLookup = vi
    .fn()
    .mockResolvedValue(shiftId ? { id: shiftId } : null);
  const tx = {
    couponCode: {
      findUnique: vi.fn().mockResolvedValue(coupon),
      updateMany,
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({
          ...coupon,
          status: CouponStatus.REDEEMED,
          idempotencyKey: 'private-redeem-key',
        }),
    },
    couponTemplate: { update: vi.fn().mockResolvedValue({}) },
    frontDeskShift: { findFirst: shiftLookup },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    couponCode: {
      findUnique: vi
        .fn()
        .mockImplementation(
          async ({ where }: { where: Record<string, unknown> }) =>
            'idempotencyKey' in where ? null : coupon,
        ),
    },
    merchant: {
      findUnique: vi.fn().mockResolvedValue({ status: UserStatus.ACTIVE }),
    },
    userRole: {
      findFirst: vi.fn().mockResolvedValue({ merchantId: 'merchant-1' }),
    },
    $transaction: runner(tx),
  };
  return { prisma, tx, updateMany, auditCreate, shiftLookup };
};

describe('AllianceService redemption response privacy', () => {
  it('redacts the persisted key from an exact replay', async () => {
    const command = {
      code: 'YQ-COFFEE-1', merchantId: 'merchant-1',
      attributedAmountCents: 2_800, idempotencyKey: 'redeem-replay-key-1',
    };
    const replay = {
      id: 'coupon-1', code: command.code, status: CouponStatus.REDEEMED,
      redeemedMerchantId: command.merchantId,
      attributedAmountCents: command.attributedAmountCents,
      idempotencyKey: command.idempotencyKey,
    };
    const service = new AllianceService({
      userRole: { findFirst: vi.fn().mockResolvedValue({ merchantId: command.merchantId }) },
      couponCode: { findUnique: vi.fn().mockResolvedValue(replay) },
    } as never);

    const result = await service.redeem(command, merchant);
    expect(result).toMatchObject({ id: replay.id, status: CouponStatus.REDEEMED });
    expect(result).not.toHaveProperty('idempotencyKey');
  });

  it('redacts the persisted key from concurrent unique-key recovery', async () => {
    const command = {
      code: 'YQ-COFFEE-1', merchantId: 'merchant-1',
      attributedAmountCents: 2_800, idempotencyKey: 'redeem-concurrent-key-1',
    };
    const claimed = {
      id: 'coupon-1', code: command.code, templateId: 'template-1',
      template: { merchantId: command.merchantId }, status: CouponStatus.CLAIMED,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };
    const duplicate = {
      ...claimed, status: CouponStatus.REDEEMED,
      redeemedMerchantId: command.merchantId,
      attributedAmountCents: command.attributedAmountCents,
      idempotencyKey: command.idempotencyKey,
    };
    let keyLookups = 0;
    const service = new AllianceService({
      userRole: { findFirst: vi.fn().mockResolvedValue({ merchantId: command.merchantId }) },
      merchant: { findUnique: vi.fn().mockResolvedValue({ status: UserStatus.ACTIVE }) },
      couponCode: { findUnique: vi.fn(async ({ where }: any) => {
        if ('idempotencyKey' in where) return keyLookups++ === 0 ? null : duplicate;
        return claimed;
      }) },
      $transaction: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002', clientVersion: 'test',
        }),
      ),
    } as never);

    const result = await service.redeem(command, merchant);
    expect(result).toMatchObject({ id: duplicate.id, status: CouponStatus.REDEEMED });
    expect(result).not.toHaveProperty('idempotencyKey');
  });
});

describe('AllianceService settlement workflow', () => {
  it('moves a statement through submit, merchant confirmation and finance settlement', async () => {
    const setup = makeTransitionPrisma(statement());
    // The conditional update uses the current status as a guard.  The test
    // adapter adds that marker so the in-memory mock behaves like Prisma.
    setup.tx.allianceSettlement.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { status: SettlementStatus };
        data: Record<string, unknown>;
      }) => {
        if (setup.current().status !== where.status) return { count: 0 };
        Object.assign(setup.current(), data);
        return { count: 1 };
      },
    );
    const service = new AllianceService(setup.prisma as never);

    await service.submitSettlement('statement-1', finance);
    expect(setup.current().status).toBe(SettlementStatus.PENDING_CONFIRMATION);

    await service.confirmSettlement('statement-1', merchant);
    expect(setup.current().status).toBe(SettlementStatus.CONFIRMED);
    expect(setup.current().confirmedAt).toBeInstanceOf(Date);

    await service.settleSettlement('statement-1', finance);
    expect(setup.current().status).toBe(SettlementStatus.SETTLED);
    expect(setup.current().settledAt).toBeInstanceOf(Date);
    expect(setup.tx.auditLog.create).toHaveBeenCalledTimes(3);
  });

  it('is idempotent on a repeated action and rejects an out-of-order action', async () => {
    const setup = makeTransitionPrisma(
      statement(SettlementStatus.PENDING_CONFIRMATION),
    );
    setup.tx.allianceSettlement.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { status: SettlementStatus };
        data: Record<string, unknown>;
      }) => {
        if (setup.current().status !== where.status) return { count: 0 };
        Object.assign(setup.current(), data);
        return { count: 1 };
      },
    );
    const service = new AllianceService(setup.prisma as never);
    const first = await service.confirmSettlement('statement-1', merchant);
    const second = await service.confirmSettlement('statement-1', merchant);
    expect(first.status).toBe(SettlementStatus.CONFIRMED);
    expect(second.status).toBe(SettlementStatus.CONFIRMED);
    expect(setup.tx.auditLog.create).toHaveBeenCalledTimes(1);
    await expect(
      service.settleSettlement('statement-1', finance),
    ).resolves.toMatchObject({
      status: SettlementStatus.SETTLED,
    });
    await expect(
      service.submitSettlement('statement-1', finance),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires a reason for disputes and keeps merchant data scoped', async () => {
    const setup = makeTransitionPrisma(
      statement(SettlementStatus.PENDING_CONFIRMATION),
    );
    const service = new AllianceService(setup.prisma as never);
    await expect(
      service.disputeSettlement('statement-1', {}, merchant),
    ).rejects.toBeInstanceOf(BadRequestException);

    setup.prisma.userRole.findFirst.mockResolvedValue(null);
    await expect(
      service.confirmSettlement('statement-1', merchant),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('treats the merchant-period tuple as an idempotency key', async () => {
    const periodStart = new Date('2026-08-01T00:00:00.000Z');
    const periodEnd = new Date('2026-09-01T00:00:00.000Z');
    const created = {
      id: 'statement-1',
      merchantId: 'merchant-1',
      periodStart,
      periodEnd,
      attributedGrossProfitCents: 5000,
      status: SettlementStatus.DRAFT,
      detail: { codeIds: ['coupon-secret'], settlementRule: { mode: 'FIXED' } },
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    const tx = {
      allianceSettlement: { create: vi.fn().mockResolvedValue(created) },
      reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      merchant: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'merchant-1',
            settlementRule: { mode: 'FIXED', feeCents: 100 },
          }),
      },
      couponCode: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findUnique },
      $transaction: runner(tx),
    };
    const service = new AllianceService(prisma as never);
    const dto = {
      merchantId: 'merchant-1',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      attributedGrossProfitCents: 5000,
    };
    const first = await service.createSettlement(dto, finance);
    const second = await service.createSettlement(dto, finance);
    expect(first).toMatchObject({ id: created.id, status: created.status });
    expect(second).toEqual(first);
    expect(JSON.stringify({ first, second })).not.toMatch(/codeIds|settlementRule/);
    expect(tx.allianceSettlement.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('allows periodic settlement after its source business days are locked', async () => {
    const locked = { businessDate: new Date('2026-08-14T16:00:00.000Z') };
    const setup = makeTransitionPrisma(statement());
    setup.tx.reconciliationPeriod.findFirst.mockResolvedValue(locked);
    const service = new AllianceService(setup.prisma as never);

    await expect(
      service.submitSettlement('statement-1', finance),
    ).resolves.toMatchObject({
      status: SettlementStatus.PENDING_CONFIRMATION,
    });
    expect(setup.tx.reconciliationPeriod.findFirst).not.toHaveBeenCalled();

    const periodStart = new Date('2026-08-01T00:00:00.000Z');
    const periodEnd = new Date('2026-09-01T00:00:00.000Z');
    const tx = {
      reconciliationPeriod: { findFirst: vi.fn().mockResolvedValue(locked) },
      allianceSettlement: {
        create: vi.fn().mockResolvedValue({
          id: 'statement-new',
          merchantId: 'merchant-1',
          periodStart,
          periodEnd,
          status: SettlementStatus.DRAFT,
        }),
      },
      auditLog: { create: vi.fn() },
    };
    const createService = new AllianceService({
      merchant: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'merchant-1', settlementRule: {} }),
      },
      couponCode: { findMany: vi.fn().mockResolvedValue([]) },
      allianceSettlement: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: runner(tx),
    } as never);
    await expect(
      createService.createSettlement(
        {
          merchantId: 'merchant-1',
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          attributedGrossProfitCents: 0,
        },
        finance,
      ),
    ).resolves.toMatchObject({ status: SettlementStatus.DRAFT });
    expect(tx.allianceSettlement.create).toHaveBeenCalledOnce();
    expect(tx.reconciliationPeriod.findFirst).not.toHaveBeenCalled();
  });

  it('does not expose merchant contacts or settlement rules to public/merchant views', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      merchant: { findMany },
      userRole: {
        findMany: vi.fn().mockResolvedValue([{ merchantId: 'merchant-1' }]),
      },
    };
    const service = new AllianceService(prisma as never);
    await service.listMerchants(member);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: UserStatus.ACTIVE },
        select: expect.not.objectContaining({
          contactPhone: true,
          settlementRule: true,
        }),
      }),
    );
    await service.listMerchants(merchant);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: { in: ['merchant-1'] } },
        select: expect.not.objectContaining({ settlementRule: true }),
      }),
    );
  });

  it('projects settlement lists without source coupon ids or raw settlement rules', async () => {
    const raw = {
      ...statement(),
      detail: {
        codeIds: ['coupon-secret'],
        settlementRule: { mode: 'PER_REDEMPTION', amountCents: 1000 },
        workflowState: SettlementStatus.DRAFT,
        workflowHistory: [{ action: 'CREATED', state: SettlementStatus.DRAFT, actorId: finance.sub, at: '2026-09-01T00:00:00.000Z' }],
      },
      merchant: { id: 'merchant-1', code: 'M-1', name: '联盟商户' },
    };
    const service = new AllianceService({
      allianceSettlement: { findMany: vi.fn().mockResolvedValue([raw]) },
    } as never);

    const [result] = await service.listSettlements(finance);
    expect(result).toMatchObject({ id: raw.id, merchant: { name: '联盟商户' } });
    expect(result.detail.workflowHistory[0]).toEqual({
      action: 'CREATED', state: SettlementStatus.DRAFT, reason: null,
      at: '2026-09-01T00:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toMatch(/codeIds|settlementRule|actorId/);
  });

  it('returns member coupons with only the public merchant catalogue fields', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new AllianceService({ couponCode: { findMany } } as never);

    await service.listMyCoupons(member);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { holderId: member.sub },
        select: expect.objectContaining({
          template: {
            select: expect.objectContaining({
              merchant: {
                select: expect.not.objectContaining({
                  contactName: true,
                  contactPhone: true,
                  settlementRule: true,
                }),
              },
            }),
          },
        }),
      }),
    );
  });
});

describe('AllianceService coupon claim workflow', () => {
  const couponFixture = (holderId: string | null = null) => ({
    id: 'coupon-1',
    code: 'YQ-COFFEE-1',
    templateId: 'template-1',
    status: holderId ? CouponStatus.CLAIMED : CouponStatus.ISSUED,
    holderId,
    claimedAt: holderId ? new Date() : null,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    template: {
      id: 'template-1',
      code: 'COFFEE-AFTER-GAME',
      enabled: true,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      claimLimitPerUser: 1,
      merchant: { status: UserStatus.ACTIVE },
    },
  });

  it('increments the claim counter only for the winning transition', async () => {
    const coupon = couponFixture();
    const templateUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      couponCode: {
        findUnique: vi.fn().mockImplementation(async () => coupon),
        count: vi.fn().mockResolvedValue(0),
        updateMany: vi
          .fn()
          .mockImplementation(
            async ({ data }: { data: Record<string, unknown> }) => {
              Object.assign(coupon, data);
              return { count: 1 };
            },
          ),
        findUniqueOrThrow: vi.fn().mockResolvedValue(coupon),
      },
      couponTemplate: { update: templateUpdate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: runner(tx) };
    const service = new AllianceService(prisma as never);

    await expect(service.claim(coupon.code, member)).resolves.toMatchObject({
      status: CouponStatus.CLAIMED,
      holderId: member.sub,
    });
    expect(templateUpdate).toHaveBeenCalledOnce();
  });

  it('returns the same claim on retry without a second counter increment', async () => {
    const coupon = couponFixture(member.sub);
    const templateUpdate = vi.fn();
    const tx = {
      couponCode: {
        findUnique: vi.fn().mockResolvedValue(coupon),
        count: vi.fn().mockResolvedValue(1),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      couponTemplate: { update: templateUpdate },
      auditLog: { create: vi.fn() },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);

    await expect(service.claim(coupon.code, member)).resolves.toMatchObject({
      status: CouponStatus.CLAIMED,
      holderId: member.sub,
    });
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it('blocks claims after the partner is disabled', async () => {
    const coupon = couponFixture();
    coupon.template.merchant.status = UserStatus.DISABLED;
    const tx = {
      couponCode: { findUnique: vi.fn().mockResolvedValue(coupon) },
      couponTemplate: { update: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);

    await expect(service.claim(coupon.code, member)).rejects.toThrow(
      '券活动未开始或已结束',
    );
    expect(tx.couponTemplate.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('enforces one newcomer experience per member and caps validity at the effective seven-day rule', async () => {
    const coupon = {
      ...couponFixture(),
      code: 'YQ-NEWCOMER-1',
      template: {
        ...couponFixture().template,
        code: 'NEWCOMER-COURT-EXPERIENCE',
      },
    };
    const updateMany = vi
      .fn()
      .mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(coupon, data);
          return { count: 1 };
        },
      );
    const tx = {
      couponCode: {
        findUnique: vi.fn().mockImplementation(async () => coupon),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        updateMany,
        findUniqueOrThrow: vi.fn().mockImplementation(async () => coupon),
      },
      memberProfile: {
        findUnique: vi.fn().mockResolvedValue({ isNewCustomer: true }),
      },
      systemParameter: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'parameter-newcomer-days-v1', value: 7 }),
      },
      couponTemplate: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);
    const before = Date.now();

    await expect(service.claim(coupon.code, member)).resolves.toMatchObject({
      status: CouponStatus.CLAIMED,
      holderId: member.sub,
    });

    const updatedExpiry = (updateMany.mock.calls[0][0] as any).data
      .expiresAt as Date;
    expect(updatedExpiry.getTime()).toBeGreaterThanOrEqual(
      before + 7 * 86_400_000 - 1_000,
    );
    expect(updatedExpiry.getTime()).toBeLessThanOrEqual(
      Date.now() + 7 * 86_400_000 + 1_000,
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ALLIANCE_COUPON_CLAIMED',
          newValue: expect.objectContaining({
            newcomer: true,
            validityParameterId: 'parameter-newcomer-days-v1',
            validityDays: 7,
          }),
        }),
      }),
    );

    const secondCoupon = {
      ...couponFixture(),
      id: 'coupon-2',
      code: 'YQ-NEWCOMER-2',
      template: {
        ...coupon.template,
        id: 'template-2',
        code: 'NEWCOMER-COURT-SECOND',
      },
    };
    tx.couponCode.findUnique.mockResolvedValue(secondCoupon as never);
    tx.couponCode.findFirst.mockResolvedValue({ id: coupon.id } as never);
    await expect(service.claim(secondCoupon.code, member)).rejects.toThrow(
      '新客体验权益每人仅限一次',
    );
  });
});

describe('AllianceService merchant campaign operations', () => {
  it('scopes coupon-template listings to the merchant assignment and rejects unrelated roles', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      userRole: {
        findMany: vi.fn().mockResolvedValue([{ merchantId: 'merchant-1' }]),
      },
      couponTemplate: { findMany },
    };
    const service = new AllianceService(prisma as never);

    await service.listTemplates(merchant);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantId: { in: ['merchant-1'] } },
        include: {
          merchant: {
            select: { id: true, code: true, name: true, status: true },
          },
        },
      }),
    );

    await service.listTemplates(admin);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: undefined }),
    );
    await expect(service.listTemplates(member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('normalizes and audits merchant creation', async () => {
    const created = {
      id: 'merchant-new',
      code: 'CAFE-NEW',
      name: '新咖啡',
      category: '餐饮',
      level: MerchantLevel.MEMBER_BENEFIT,
    };
    const tx = {
      merchant: { create: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);

    await expect(
      service.createMerchant(
        {
          code: ' cafe-new ',
          name: ' 新咖啡 ',
          category: ' 餐饮 ',
          level: MerchantLevel.MEMBER_BENEFIT,
          settlementRule: { mode: 'PER_REDEMPTION', amountCents: 1000 },
        },
        admin,
      ),
    ).resolves.toEqual(created);
    expect(tx.merchant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'CAFE-NEW',
          name: '新咖啡',
          category: '餐饮',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ALLIANCE_MERCHANT_CREATED',
          objectId: created.id,
        }),
      }),
    );
  });

  it('creates an audited template only for an active merchant', async () => {
    const created = {
      id: 'template-new',
      merchantId: 'merchant-1',
      code: 'COFFEE-NEW',
      name: '咖啡权益',
      issueLimit: 100,
      validFrom: new Date('2026-08-01T00:00:00.000Z'),
      validTo: new Date('2026-09-01T00:00:00.000Z'),
    };
    const tx = {
      couponTemplate: { create: vi.fn().mockResolvedValue(created) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const merchantFind = vi
      .fn()
      .mockResolvedValue({ id: 'merchant-1', status: UserStatus.ACTIVE });
    const service = new AllianceService({
      merchant: { findUnique: merchantFind },
      $transaction: runner(tx),
    } as never);
    const dto = {
      code: 'coffee-new',
      merchantId: 'merchant-1',
      name: '咖啡权益',
      activityName: '秋季联盟',
      benefitDescription: '会员咖啡立减',
      faceValueCents: 2000,
      validFrom: '2026-08-01T00:00:00.000Z',
      validTo: '2026-09-01T00:00:00.000Z',
      claimLimitPerUser: 1,
      issueLimit: 100,
    };

    await expect(service.createTemplate(dto, admin)).resolves.toEqual(created);
    expect(tx.couponTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'COFFEE-NEW',
          merchantId: 'merchant-1',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledOnce();

    merchantFind.mockResolvedValue({
      id: 'merchant-1',
      status: UserStatus.DISABLED,
    });
    await expect(service.createTemplate(dto, admin)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects code generation for another merchant, a disabled template, or an expired campaign', async () => {
    const futureTemplate = {
      merchantId: 'merchant-1',
      enabled: true,
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      merchant: { status: UserStatus.ACTIVE },
    };
    const findUnique = vi.fn().mockResolvedValue(futureTemplate);
    const userRoleFind = vi.fn().mockResolvedValue(null);
    const service = new AllianceService({
      couponTemplate: { findUnique },
      userRole: { findFirst: userRoleFind },
      auditLog: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);

    const command = { count: 2, idempotencyKey: 'coupon-batch-command-1' };
    await expect(
      service.generateCodes('template-1', command, merchant),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.generateCodes('template-1', command, {
        ...merchant,
        roles: [AppRole.MERCHANT, AppRole.FRONT_DESK],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    userRoleFind.mockResolvedValue({ merchantId: 'merchant-1' });
    findUnique.mockResolvedValue({ ...futureTemplate, enabled: false });
    await expect(
      service.generateCodes('template-1', command, merchant),
    ).rejects.toThrow('券模板已下线');
    findUnique.mockResolvedValue({
      ...futureTemplate,
      validTo: new Date('2020-01-01T00:00:00.000Z'),
    });
    await expect(
      service.generateCodes('template-1', command, merchant),
    ).rejects.toThrow('券模板已过期');
    findUnique.mockResolvedValue({
      ...futureTemplate,
      merchant: { status: UserStatus.DISABLED },
    });
    await expect(
      service.generateCodes('template-1', command, merchant),
    ).rejects.toThrow('商户已停用');
  });

  it('precisely replays one coupon batch and does not double-issue under a concurrent retry', async () => {
    const template = {
      id: 'template-1',
      merchantId: 'merchant-1',
      code: 'COFFEE',
      enabled: true,
      issuedCount: 0,
      issueLimit: 100,
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-30T00:00:00.000Z'),
      merchant: { status: UserStatus.ACTIVE },
    };
    let committedAudit: any = null;
    let releaseAudit!: () => void;
    const auditReady = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });
    let releaseReplayReads!: () => void;
    const replayReadsReady = new Promise<void>((resolve) => {
      releaseReplayReads = resolve;
    });
    let replayReads = 0;
    let createdBatch = false;
    const createMany = vi.fn().mockImplementation(async () => {
      if (!createdBatch) {
        createdBatch = true;
        return { count: 3 };
      }
      await auditReady;
      throw new Prisma.PrismaClientKnownRequestError(
        'deterministic batch collision',
        {
          code: 'P2002',
          clientVersion: 'test',
        },
      );
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockImplementation(async ({ data }) => {
      committedAudit = data;
      releaseAudit();
      return { id: 'audit-batch-1', ...data };
    });
    const tx = {
      auditLog: {
        findFirst: vi.fn().mockImplementation(async () => {
          replayReads += 1;
          if (replayReads === 2) releaseReplayReads();
          await replayReadsReady;
          return null;
        }),
        create: auditCreate,
      },
      couponTemplate: {
        findUnique: vi.fn().mockResolvedValue(template),
        updateMany,
      },
      couponCode: { createMany },
    };
    const prisma = {
      couponTemplate: { findUnique: vi.fn().mockResolvedValue(template) },
      auditLog: {
        findFirst: vi.fn().mockImplementation(async () => committedAudit),
      },
      $transaction: vi.fn(async (work: (value: typeof tx) => unknown) =>
        work(tx),
      ),
    };
    const service = new AllianceService(prisma as never);
    const command = { count: 3, idempotencyKey: 'coupon-batch-concurrent-1' };

    const [first, retry] = await Promise.all([
      service.generateCodes('template-1', command, admin),
      service.generateCodes('template-1', command, admin),
    ]);
    expect(first).toEqual(retry);
    expect(first.codes).toHaveLength(3);
    expect(new Set(first.codes).size).toBe(3);
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    expect(committedAudit).toMatchObject({
      requestId: command.idempotencyKey,
      newValue: { count: 3, codes: first.codes },
    });

    await expect(
      service.generateCodes(
        'template-1',
        {
          count: 2,
          idempotencyKey: command.idempotencyKey,
        },
        admin,
      ),
    ).rejects.toThrow('幂等键已用于其他联盟操作');
    expect(updateMany).toHaveBeenCalledOnce();
  });
});

describe('AllianceService merchant lifecycle operations', () => {
  it('changes merchant status with an in-transaction audit and precisely replays one command', async () => {
    let current = {
      id: 'merchant-1',
      status: UserStatus.ACTIVE,
      updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    };
    let audit: any = null;
    const updateMany = vi.fn().mockImplementation(async ({ where, data }) => {
      if (
        where.status !== current.status ||
        where.updatedAt !== current.updatedAt
      )
        return { count: 0 };
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    });
    const auditCreate = vi.fn().mockImplementation(async ({ data }) => {
      audit = data;
      return { id: 'audit-1', ...data };
    });
    const tx = {
      merchant: {
        findUnique: vi.fn().mockImplementation(async () => ({ ...current })),
        findUniqueOrThrow: vi
          .fn()
          .mockImplementation(async () => ({ ...current })),
        updateMany,
      },
      auditLog: {
        findFirst: vi
          .fn()
          .mockImplementation(async ({ where }) =>
            audit?.requestId === where.requestId ? audit : null,
          ),
        create: auditCreate,
      },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);
    const command = {
      status: UserStatus.DISABLED,
      reason: '合作协议到期',
      idempotencyKey: 'merchant-status-command-1',
    };

    await expect(
      service.setMerchantStatus('merchant-1', command, admin),
    ).resolves.toMatchObject({
      status: UserStatus.DISABLED,
    });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ALLIANCE_MERCHANT_STATUS_SET',
          objectId: 'merchant-1',
          oldValue: { status: UserStatus.ACTIVE },
          newValue: expect.objectContaining({ status: UserStatus.DISABLED }),
          reason: '合作协议到期',
          requestId: command.idempotencyKey,
        }),
      }),
    );

    await expect(
      service.setMerchantStatus('merchant-1', command, admin),
    ).resolves.toMatchObject({
      status: UserStatus.DISABLED,
    });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
    await expect(
      service.setMerchantStatus(
        'merchant-1',
        {
          ...command,
          reason: '同一幂等键更换原因',
        },
        admin,
      ),
    ).rejects.toThrow('幂等键已用于其他联盟操作');
  });

  it('requires an administrator and does not enable a template under a disabled merchant', async () => {
    const serviceWithoutDb = new AllianceService({} as never);
    await expect(
      serviceWithoutDb.setMerchantStatus(
        'merchant-1',
        {
          status: UserStatus.DISABLED,
          reason: '无权操作',
          idempotencyKey: 'merchant-status-denied',
        },
        merchant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      serviceWithoutDb.setTemplateStatus(
        'template-1',
        {
          enabled: false,
          reason: '无权操作',
          idempotencyKey: 'template-status-denied',
        },
        merchant,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const tx = {
      auditLog: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      couponTemplate: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'template-1',
          enabled: false,
          updatedAt: new Date(),
          merchant: { status: UserStatus.DISABLED },
        }),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);
    await expect(
      service.setTemplateStatus(
        'template-1',
        {
          enabled: true,
          reason: '计划重新上线',
          idempotencyKey: 'template-status-enable-1',
        },
        admin,
      ),
    ).rejects.toThrow('停用商户的券模板不能启用');
    expect(tx.couponTemplate.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('disables a coupon template and audits old and new state in the same transaction', async () => {
    let current = {
      id: 'template-1',
      enabled: true,
      updatedAt: new Date('2026-08-30T00:00:00.000Z'),
      merchant: { status: UserStatus.ACTIVE },
    };
    const updateMany = vi.fn().mockImplementation(async ({ data }) => {
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    });
    const auditCreate = vi.fn().mockResolvedValue({});
    const tx = {
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: auditCreate,
      },
      couponTemplate: {
        findUnique: vi.fn().mockImplementation(async () => ({ ...current })),
        updateMany,
        findUniqueOrThrow: vi
          .fn()
          .mockImplementation(async () => ({ ...current })),
      },
    };
    const service = new AllianceService({ $transaction: runner(tx) } as never);
    await expect(
      service.setTemplateStatus(
        'template-1',
        {
          enabled: false,
          reason: '活动已经结束',
          idempotencyKey: 'template-status-disable-1',
        },
        admin,
      ),
    ).resolves.toMatchObject({ enabled: false });
    expect(updateMany).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ALLIANCE_COUPON_TEMPLATE_STATUS_SET',
          oldValue: { enabled: true },
          newValue: expect.objectContaining({ enabled: false }),
          reason: '活动已经结束',
        }),
      }),
    );
  });

  it('rejects a new redemption after the merchant is disabled', async () => {
    const couponFind = vi.fn().mockResolvedValue(null);
    const service = new AllianceService({
      userRole: {
        findFirst: vi.fn().mockResolvedValue({ merchantId: 'merchant-1' }),
      },
      couponCode: { findUnique: couponFind },
      merchant: {
        findUnique: vi.fn().mockResolvedValue({ status: UserStatus.DISABLED }),
      },
    } as never);
    await expect(
      service.redeem(
        {
          code: 'YQ-COFFEE-1',
          merchantId: 'merchant-1',
          attributedAmountCents: 0,
          idempotencyKey: 'redeem-disabled-merchant',
        },
        merchant,
      ),
    ).rejects.toThrow('商户已停用，不能核销券码');
    expect(couponFind).toHaveBeenCalledOnce();
  });
});
