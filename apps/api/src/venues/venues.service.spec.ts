import { describe, expect, it, vi } from 'vitest';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../common/auth/auth-user.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  AppRole,
  BookingStatus,
  BusinessType,
  CouponStatus,
  CourtClosureStatus,
  CourtUsage,
  OrderStatus,
  SlotPeriod,
  SourceChannel,
  UserStatus,
} from '../generated/prisma/enums.js';
import { orderCreationCommandHash } from '../orders/order-creation-idempotency.js';
import { VenuesService } from './venues.service.js';

const frontDesk: AuthUser = {
  sub: 'front-desk-1',
  displayName: '前台',
  roles: [AppRole.FRONT_DESK],
};
const member: AuthUser = {
  sub: 'member-1',
  displayName: '会员',
  roles: [AppRole.MEMBER],
};
const administrator: AuthUser = {
  sub: 'admin-1',
  displayName: '管理员',
  roles: [AppRole.ADMIN],
};

const runner = (tx: Record<string, unknown>) =>
  vi.fn(async (work: (value: Record<string, unknown>) => unknown) => work(tx));

const bookingDto = {
  date: '2099-01-01',
  courtId: 'court-1',
  slotId: 'slot-1',
  sourceChannel: SourceChannel.MINI_PROGRAM,
};

const priceRuleFixture = (priceCents: number, newcomerPriceCents: number) => ({
  id: 'price-1',
  code: 'PRICE_S01',
  version: 1,
  name: '上午场基础价',
  timeSlotId: 'slot-1',
  weekdayMask: 127,
  priceCents,
  newcomerPriceCents,
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: new Date('2099-01-01T00:00:00.000Z'),
});

describe('VenuesService public availability projection', () => {
  it('returns only occupancy and business-price fields even when database rows are wider', async () => {
    const startsAt = new Date('2099-01-01T01:00:00.000Z');
    const endsAt = new Date('2099-01-01T03:00:00.000Z');
    const priceRule = {
      ...priceRuleFixture(6_800, 4_800),
      creationIdempotencyKey: 'private-price-key',
      creationCommandHash: 'private-price-hash',
      createdById: 'admin-private',
      enabled: true,
    };
    const prisma = {
      court: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            zone: '一层',
            usage: CourtUsage.RETAIL,
            enabled: true,
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
      timeSlot: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'slot-1',
            code: 'S01',
            label: '上午场',
            startMinutes: 540,
            endMinutes: 660,
            period: SlotPeriod.DAYTIME,
            enabled: true,
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
      priceRule: { findMany: vi.fn().mockResolvedValue([priceRule]) },
      courtBooking: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'booking-private',
            orderId: 'order-private',
            memberId: 'member-private',
            courtId: 'court-1',
            startsAt,
            endsAt,
            status: BookingStatus.CONFIRMED,
            usage: CourtUsage.RETAIL,
            holdExpiresAt: new Date(),
          },
        ]),
      },
      courtClosure: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'closure-private',
            courtId: 'court-1',
            startsAt,
            endsAt,
            reason: '内部维修原因',
            status: CourtClosureStatus.ACTIVE,
            creationIdempotencyKey: 'private-closure-key',
            createdById: 'admin-private',
          },
        ]),
      },
    };
    const service = new VenuesService(prisma as never);

    const result = await service.availability('2099-01-01');

    expect(result).toEqual({
      date: '2099-01-01',
      courts: [
        {
          id: 'court-1',
          name: '1号场',
          usage: CourtUsage.RETAIL,
          enabled: true,
        },
      ],
      slots: [
        {
          id: 'slot-1',
          label: '上午场',
          startMinutes: 540,
          endMinutes: 660,
          period: SlotPeriod.DAYTIME,
          enabled: true,
          price: { priceCents: 6_800, newcomerPriceCents: 4_800 },
        },
      ],
      bookings: [
        {
          courtId: 'court-1',
          startsAt,
          endsAt,
          status: BookingStatus.CONFIRMED,
          usage: CourtUsage.RETAIL,
        },
      ],
      closures: [
        {
          courtId: 'court-1',
          startsAt,
          endsAt,
          status: CourtClosureStatus.ACTIVE,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /creationIdempotencyKey|creationCommandHash|createdById|parameterSnapshot|weekdayMask|effectiveFrom|orderId|memberId|holdExpiresAt|reason|sortOrder/,
    );
    expect(prisma.priceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          creationIdempotencyKey: true,
          creationCommandHash: true,
          createdById: true,
        }),
      }),
    );
  });
});

describe('VenuesService booking ownership', () => {
  it('lets only one of two distinct concurrent commands reserve the same court slot', async () => {
    let conflictReads = 0;
    let releaseConflictReads!: () => void;
    const bothReadNoConflict = new Promise<void>((resolve) => {
      releaseConflictReads = resolve;
    });
    let committed = false;
    const courtBookingFindFirst = vi.fn(async () => {
      conflictReads += 1;
      if (conflictReads === 2) releaseConflictReads();
      await bothReadNoConflict;
      return null;
    });
    const orderCreate = vi.fn(
      async ({ data }: { data: Record<string, any> }) => {
        if (committed) {
          throw new Prisma.PrismaClientKnownRequestError(
            'active slot collision',
            {
              code: 'P2002',
              clientVersion: 'test',
              meta: {
                modelName: 'CourtBooking',
                target: ['courtId', 'startsAt', 'endsAt'],
              },
            },
          );
        }
        committed = true;
        return {
          id: 'order-slot-winner',
          ...data,
          bookings: [],
          items: [],
        };
      },
    );
    const tx = {
      courtClosure: { findFirst: vi.fn().mockResolvedValue(null) },
      courtBooking: { findFirst: courtBookingFindFirst },
      order: { create: orderCreate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const transaction = vi.fn(
      async (work: (value: typeof tx) => unknown, _options: unknown) =>
        work(tx),
    );
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn(),
      },
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'slot-1',
            code: 'S01',
            label: '上午场',
            enabled: true,
            startMinutes: 540,
            endMinutes: 660,
          }),
      },
      memberProfile: {
        findUnique: vi.fn().mockResolvedValue({ level: 'GOLD' }),
      },
      priceRule: {
        findMany: vi.fn().mockResolvedValue([priceRuleFixture(6_800, 4_800)]),
      },
      $transaction: transaction,
    };
    const service = new VenuesService(prisma as never);

    const results = await Promise.allSettled([
      service.createBooking(
        {
          ...bookingDto,
          creationIdempotencyKey: 'venue-command-one',
        },
        member,
      ),
      service.createBooking(
        {
          ...bookingDto,
          creationIdempotencyKey: 'venue-command-two',
        },
        member,
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe(
      '该场地时段已被占用',
    );
    expect(orderCreate).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(
      transaction.mock.calls.every(
        ([, options]) =>
          options?.isolationLevel ===
          Prisma.TransactionIsolationLevel.Serializable,
      ),
    ).toBe(true);
  });

  it('turns a serializable booking race into an actionable refresh conflict', async () => {
    const serializableRace = new Prisma.PrismaClientKnownRequestError(
      'could not serialize access due to read/write dependencies',
      { code: 'P2034', clientVersion: 'test' },
    );
    const transaction = vi.fn().mockRejectedValue(serializableRace);
    const prisma = {
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'slot-1',
            code: 'S01',
            label: '上午场',
            enabled: true,
            startMinutes: 540,
            endMinutes: 660,
          }),
      },
      memberProfile: {
        findUnique: vi.fn().mockResolvedValue({ level: 'GOLD' }),
      },
      priceRule: {
        findMany: vi.fn().mockResolvedValue([priceRuleFixture(6_800, 4_800)]),
      },
      $transaction: transaction,
    };
    const service = new VenuesService(prisma as never);

    await expect(service.createBooking(bookingDto, member)).rejects.toThrow(
      '该场地时段刚刚被其他操作占用，请刷新后重试',
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('requires an assisted-booking customer before touching the database', async () => {
    const prisma = { user: { findFirst: vi.fn() }, $transaction: vi.fn() };
    const service = new VenuesService(prisma as never);

    await expect(
      service.createBooking(bookingDto, frontDesk),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents a member token from assigning an order to another customer', async () => {
    const transaction = vi.fn();
    const service = new VenuesService({ $transaction: transaction } as never);

    await expect(
      service.createBooking({ ...bookingDto, memberId: 'member-2' }, member),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a delegated target that is missing, disabled, or not a member', async () => {
    const user = { findFirst: vi.fn().mockResolvedValue(null) };
    const service = new VenuesService({ user } as never);

    await expect(
      service.createBooking(
        { ...bookingDto, memberId: 'member-disabled' },
        frontDesk,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'member-disabled',
        status: UserStatus.ACTIVE,
        deletedAt: null,
        memberProfile: { isNot: null },
      },
      select: { id: true },
    });
  });

  it('records the customer as owner and the front desk as creator/audit actor', async () => {
    const tx = {
      frontDeskShift: {
        findFirst: vi.fn().mockResolvedValue({ id: 'shift-open' }),
      },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member-2' }) },
      courtClosure: { findFirst: vi.fn().mockResolvedValue(null) },
      courtBooking: { findFirst: vi.fn().mockResolvedValue(null) },
      order: {
        create: vi
          .fn()
          .mockResolvedValue({ id: 'order-assisted', bookings: [], items: [] }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member-2' }) },
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'slot-1',
            code: 'S01',
            label: '上午场',
            enabled: true,
            startMinutes: 540,
            endMinutes: 660,
          }),
      },
      memberProfile: {
        findUnique: vi.fn().mockResolvedValue({ level: 'GOLD' }),
      },
      priceRule: {
        findMany: vi.fn().mockResolvedValue([priceRuleFixture(6_800, 4_800)]),
      },
      $transaction: runner(tx),
    };
    const service = new VenuesService(prisma as never);

    await expect(
      service.createBooking({ ...bookingDto, memberId: 'member-2' }, frontDesk),
    ).resolves.toMatchObject({ id: 'order-assisted' });

    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberId: 'member-2',
          createdById: frontDesk.sub,
          bookings: {
            create: expect.objectContaining({ memberId: 'member-2' }),
          },
          parameterSnapshot: expect.objectContaining({
            targetMemberId: 'member-2',
            createdById: frontDesk.sub,
            operatorAssisted: true,
          }),
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: frontDesk.sub,
        action: 'VENUE_ORDER_CREATED',
        newValue: expect.objectContaining({
          memberId: 'member-2',
          createdById: frontDesk.sub,
        }),
      }),
    });
  });

  it('does not create an assisted booking when the front desk has no open shift', async () => {
    const tx = {
      frontDeskShift: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { findFirst: vi.fn() },
      order: { create: vi.fn() },
    };
    const prisma = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'member-2' }) },
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'slot-1',
            code: 'S01',
            label: '上午场',
            enabled: true,
            startMinutes: 540,
            endMinutes: 660,
          }),
      },
      memberProfile: {
        findUnique: vi.fn().mockResolvedValue({ level: 'GOLD' }),
      },
      priceRule: {
        findMany: vi.fn().mockResolvedValue([priceRuleFixture(6_800, 4_800)]),
      },
      $transaction: runner(tx),
    };

    await expect(
      new VenuesService(prisma as never).createBooking(
        { ...bookingDto, memberId: 'member-2' },
        frontDesk,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('binds an idempotency key to the delegated target member', async () => {
    const command = {
      kind: 'VENUE_BOOKING',
      memberId: 'member-2',
      date: bookingDto.date,
      courtId: bookingDto.courtId,
      slotId: bookingDto.slotId,
      sourceChannel: bookingDto.sourceChannel,
      couponCode: null,
    };
    const existing = {
      id: 'order-existing',
      memberId: 'member-2',
      creationCommandHash: orderCreationCommandHash(command),
    };
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue(existing),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...existing, bookings: [], items: [] }),
      },
      user: { findFirst: vi.fn() },
    };
    const service = new VenuesService(prisma as never);
    const keyedDto = {
      ...bookingDto,
      memberId: 'member-2',
      creationIdempotencyKey: 'venue-assisted-key-1',
    };

    await expect(
      service.createBooking(keyedDto, frontDesk),
    ).resolves.toMatchObject({ id: 'order-existing' });
    await expect(
      service.createBooking({ ...keyedDto, memberId: 'member-1' }, frontDesk),
    ).rejects.toThrow('幂等键已用于不同命令');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a newcomer experience coupon in a prime slot using the effective policy version', async () => {
    const systemParameter = {
      findFirst: vi.fn().mockResolvedValue({
        id: 'newcomer-periods-v1',
        value: [SlotPeriod.EARLY, SlotPeriod.DAYTIME],
      }),
    };
    const prisma = {
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'slot-1',
          code: 'S07',
          label: '晚黄金场',
          enabled: true,
          startMinutes: 1_260,
          endMinutes: 1_380,
          period: SlotPeriod.PRIME,
        }),
      },
      memberProfile: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ level: 'EXPERIENCE', isNewCustomer: true }),
      },
      priceRule: {
        findMany: vi.fn().mockResolvedValue([priceRuleFixture(8_800, 4_800)]),
      },
      couponCode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'coupon-newcomer',
          code: 'YQ-NEWCOMER-1',
          holderId: member.sub,
          status: CouponStatus.CLAIMED,
          expiresAt: new Date('2099-01-08T00:00:00.000Z'),
          template: {
            code: 'NEWCOMER-COURT-EXPERIENCE',
            enabled: true,
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            validTo: new Date('2099-02-01T00:00:00.000Z'),
            faceValueCents: 0,
            merchant: { status: UserStatus.ACTIVE },
          },
        }),
      },
      systemParameter,
      $transaction: vi.fn(),
    };
    const service = new VenuesService(prisma as never);

    await expect(
      service.createBooking(
        {
          ...bookingDto,
          couponCode: 'YQ-NEWCOMER-1',
        },
        member,
      ),
    ).rejects.toThrow('新客体验权益仅限非黄金时段使用');
    expect(systemParameter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: 'newcomer.experience.allowed_slot_periods',
        }),
        select: { id: true, value: true },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('snapshots the newcomer non-prime policy and applies the configured experience price', async () => {
    const tx = {
      courtClosure: { findFirst: vi.fn().mockResolvedValue(null) },
      courtBooking: { findFirst: vi.fn().mockResolvedValue(null) },
      order: {
        create: vi
          .fn()
          .mockResolvedValue({ id: 'order-newcomer', bookings: [], items: [] }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      court: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'court-1',
            code: 'C01',
            name: '1号场',
            enabled: true,
            usage: CourtUsage.RETAIL,
          }),
      },
      timeSlot: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'slot-1',
          code: 'S02',
          label: '上午场',
          enabled: true,
          startMinutes: 540,
          endMinutes: 720,
          period: SlotPeriod.DAYTIME,
        }),
      },
      memberProfile: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ level: 'EXPERIENCE', isNewCustomer: true }),
      },
      priceRule: {
        findMany: vi.fn().mockResolvedValue([priceRuleFixture(9_000, 4_900)]),
      },
      couponCode: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'coupon-newcomer',
          code: 'YQ-NEWCOMER-1',
          holderId: member.sub,
          status: CouponStatus.CLAIMED,
          expiresAt: new Date('2099-01-08T00:00:00.000Z'),
          template: {
            code: 'NEWCOMER-COURT-EXPERIENCE',
            enabled: true,
            validFrom: new Date('2026-01-01T00:00:00.000Z'),
            validTo: new Date('2099-02-01T00:00:00.000Z'),
            faceValueCents: 0,
            merchant: { status: UserStatus.ACTIVE },
          },
        }),
      },
      systemParameter: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 'newcomer-periods-v1',
            value: [SlotPeriod.EARLY, SlotPeriod.DAYTIME],
          }),
      },
      $transaction: runner(tx),
    };
    const service = new VenuesService(prisma as never);

    await expect(
      service.createBooking(
        { ...bookingDto, couponCode: 'YQ-NEWCOMER-1' },
        member,
      ),
    ).resolves.toMatchObject({ id: 'order-newcomer' });
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          listAmountCents: 9_000,
          discountCents: 4_100,
          payableCents: 4_900,
          parameterSnapshot: expect.objectContaining({
            priceRuleId: 'price-1',
            priceRuleCode: 'PRICE_S01',
            priceRuleVersion: 1,
            priceRuleEffectiveFrom: '2026-01-01T00:00:00.000Z',
            priceRuleEffectiveTo: '2099-01-01T00:00:00.000Z',
            priceRuleTimeSlotId: 'slot-1',
            priceRuleWeekdayMask: 127,
            newcomerPolicy: {
              allowedPeriodsParameterId: 'newcomer-periods-v1',
              allowedPeriods: [SlotPeriod.EARLY, SlotPeriod.DAYTIME],
              slotPeriod: SlotPeriod.DAYTIME,
            },
          }),
        }),
      }),
    );
  });
});

describe('VenuesService check-in workflow', () => {
  it('treats a repeated scan as an idempotent no-op', async () => {
    const checkedIn = {
      id: 'order-1',
      businessType: BusinessType.VENUE,
      status: OrderStatus.CHECKED_IN,
      creationIdempotencyKey: 'private-order-key',
      creationCommandHash: 'private-order-hash',
      parameterSnapshot: { rawPriceRule: 'private' },
      bookings: [
        {
          id: 'booking-1',
          status: BookingStatus.CHECKED_IN,
          startsAt: new Date('2099-01-01T01:00:00.000Z'),
          endsAt: new Date('2099-01-01T03:00:00.000Z'),
          fulfillmentIdempotencyKey: 'private-fulfillment-key',
          fulfillmentCommandHash: 'private-fulfillment-hash',
          fulfillmentEvidence: { raw: 'private' },
        },
      ],
    };
    const tx = {
      frontDeskShift: {
        findFirst: vi.fn().mockResolvedValue({ id: 'shift-open' }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(checkedIn),
        updateMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      courtBooking: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = { $transaction: runner(tx) };
    const service = new VenuesService(prisma as never);

    const result = await service.checkIn('order-1', frontDesk);
    expect(result).toEqual({
      id: 'order-1',
      businessType: BusinessType.VENUE,
      status: OrderStatus.CHECKED_IN,
      bookings: [
        {
          id: 'booking-1',
          status: BookingStatus.CHECKED_IN,
          startsAt: new Date('2099-01-01T01:00:00.000Z'),
          endsAt: new Date('2099-01-01T03:00:00.000Z'),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /creationIdempotencyKey|creationCommandHash|parameterSnapshot|fulfillmentIdempotencyKey|fulfillmentCommandHash|fulfillmentEvidence/,
    );
    expect(tx.courtBooking.updateMany).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('changes only a paid order and writes one audit record', async () => {
    const paid = {
      id: 'order-1',
      businessType: BusinessType.VENUE,
      status: OrderStatus.PAID,
      bookings: [
        {
          id: 'booking-1',
          status: BookingStatus.CONFIRMED,
          startsAt: new Date(Date.now() + 10 * 60_000),
        },
      ],
    };
    const updated = { ...paid, status: OrderStatus.CHECKED_IN };
    const tx = {
      frontDeskShift: {
        findFirst: vi.fn().mockResolvedValue({ id: 'shift-open' }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue(paid),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new VenuesService({ $transaction: runner(tx) } as never);

    await expect(service.checkIn('order-1', frontDesk)).resolves.toEqual(
      updated,
    );
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: OrderStatus.PAID },
      data: { status: OrderStatus.CHECKED_IN },
    });
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects venue check-in before the configured opening boundary', async () => {
    const paid = {
      id: 'order-early',
      businessType: BusinessType.VENUE,
      status: OrderStatus.PAID,
      bookings: [
        {
          id: 'booking-early',
          status: BookingStatus.CONFIRMED,
          startsAt: new Date(Date.now() + 2 * 60 * 60_000),
        },
      ],
    };
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(paid),
        updateMany: vi.fn(),
      },
      frontDeskShift: { findFirst: vi.fn() },
      courtBooking: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new VenuesService({ $transaction: runner(tx) } as never);

    await expect(service.checkIn(paid.id, frontDesk)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.frontDeskShift.findFirst).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('blocks check-in after the front desk shift closes and audits an admin bypass', async () => {
    const paid = {
      id: 'order-gated',
      businessType: BusinessType.VENUE,
      status: OrderStatus.PAID,
      bookings: [
        {
          id: 'booking-gated',
          status: BookingStatus.CONFIRMED,
          startsAt: new Date(Date.now() + 10 * 60_000),
        },
      ],
    };
    const frontDeskTx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(paid),
        updateMany: vi.fn(),
      },
      frontDeskShift: { findFirst: vi.fn().mockResolvedValue(null) },
      courtBooking: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    await expect(
      new VenuesService({ $transaction: runner(frontDeskTx) } as never).checkIn(
        paid.id,
        frontDesk,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(frontDeskTx.order.updateMany).not.toHaveBeenCalled();

    const updated = { ...paid, status: OrderStatus.CHECKED_IN };
    const adminTx = {
      order: {
        findUnique: vi.fn().mockResolvedValue(paid),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
      },
      frontDeskShift: { findFirst: vi.fn() },
      courtBooking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    await expect(
      new VenuesService({ $transaction: runner(adminTx) } as never).checkIn(
        paid.id,
        administrator,
      ),
    ).resolves.toEqual(updated);
    expect(adminTx.frontDeskShift.findFirst).not.toHaveBeenCalled();
    expect(adminTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'FRONT_DESK_SHIFT_GATE_BYPASSED',
        objectId: paid.id,
      }),
    });
  });

  it('rejects a member token before opening a transaction', async () => {
    const transaction = vi.fn();
    const service = new VenuesService({ $transaction: transaction } as never);

    await expect(service.checkIn('order-1', member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a paid order whose booking evidence was cancelled or lost', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-no-slot',
          businessType: BusinessType.VENUE,
          status: OrderStatus.PAID,
          bookings: [{ id: 'booking-1', status: BookingStatus.CANCELLED }],
        }),
        updateMany: vi.fn(),
      },
      courtBooking: { updateMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new VenuesService({ $transaction: runner(tx) } as never);

    await expect(service.checkIn('order-no-slot', frontDesk)).rejects.toThrow(
      '没有可履约',
    );
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});
