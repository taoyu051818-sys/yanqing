import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import {
  AccountType,
  AppRole,
  CourtUsage,
  CourtZone,
  CouponStatus,
  EventStatus,
  GameLevel,
  GameStatus,
  HostStatus,
  InventoryMode,
  MemberLevel,
  MerchantLevel,
  ParameterType,
  SlotPeriod,
  SourceChannel,
  SupplierType,
  TrainingAudience,
} from '../src/generated/prisma/client.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const addDays = (days: number, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const seedUsers = [
  {
    phone: '13800000001',
    displayName: '金羽管理员',
    primaryRole: AppRole.ADMIN,
    roles: [
      AppRole.MEMBER,
      AppRole.ADMIN,
      AppRole.FINANCE,
      AppRole.EVENT_MANAGER,
    ],
  },
  {
    phone: '13800000002',
    displayName: '前台小羽',
    primaryRole: AppRole.FRONT_DESK,
    roles: [AppRole.MEMBER, AppRole.FRONT_DESK],
  },
  {
    phone: '13800000003',
    displayName: '王教练',
    primaryRole: AppRole.COACH,
    roles: [AppRole.MEMBER, AppRole.COACH],
  },
  {
    phone: '13800000004',
    displayName: '周末主理人阿凯',
    primaryRole: AppRole.HOST,
    roles: [AppRole.MEMBER, AppRole.HOST],
  },
  {
    phone: '13800000005',
    displayName: '延庆会员小林',
    primaryRole: AppRole.MEMBER,
    roles: [AppRole.MEMBER],
  },
  {
    phone: '13800000006',
    displayName: '山脚咖啡商户',
    primaryRole: AppRole.MERCHANT,
    roles: [AppRole.MEMBER, AppRole.MERCHANT],
  },
  {
    phone: '13800000007',
    displayName: '财务复核小金',
    primaryRole: AppRole.FINANCE,
    roles: [AppRole.MEMBER, AppRole.FINANCE],
  },
  {
    phone: '13800000008',
    displayName: '延庆超级管理员',
    primaryRole: AppRole.SUPER_ADMIN,
    roles: [AppRole.MEMBER, AppRole.SUPER_ADMIN],
  },
] as const;

async function seed() {
  const users = new Map<
    string,
    Awaited<ReturnType<typeof prisma.user.upsert>>
  >();
  for (const item of seedUsers) {
    const user = await prisma.user.upsert({
      where: { phone: item.phone },
      update: { displayName: item.displayName, primaryRole: item.primaryRole },
      create: {
        phone: item.phone,
        displayName: item.displayName,
        primaryRole: item.primaryRole,
        memberProfile: {
          create: {
            level:
              item.primaryRole === AppRole.MEMBER
                ? MemberLevel.GOLD
                : MemberLevel.REGULAR,
            tags: [item.primaryRole, 'SEED'],
            sourceChannel: SourceChannel.STORE_VISIT,
            consentVersion: '2026-08',
            consentedAt: new Date(),
          },
        },
      },
    });
    users.set(item.phone, user);
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.createMany({
      data: item.roles.map((role) => ({ userId: user.id, role })),
    });
    for (const type of Object.values(AccountType)) {
      const seededBalance: Partial<Record<AccountType, number>> =
        item.phone === '13800000005'
          ? {
              [AccountType.CASH_PRINCIPAL]: 30_000,
              [AccountType.GIFT_BALANCE]: 10_000,
              [AccountType.BADMINTON_COIN]: 500,
              [AccountType.EVENT_POINTS]: 80,
              [AccountType.GROWTH_POINTS]: 120,
            }
          : {};
      await prisma.account.upsert({
        where: { userId_type: { userId: user.id, type } },
        update: {},
        create: { userId: user.id, type, balance: seededBalance[type] || 0 },
      });
    }
  }

  const admin = users.get('13800000001')!;
  const coach = users.get('13800000003')!;
  const host = users.get('13800000004')!;
  const member = users.get('13800000005')!;
  const merchantUser = users.get('13800000006')!;

  await prisma.hostProfile.upsert({
    where: { userId: host.id },
    update: { status: HostStatus.APPROVED, approvedAt: new Date() },
    create: {
      userId: host.id,
      status: HostStatus.APPROVED,
      approvedAt: new Date(),
      level: 'GOLD',
    },
  });

  const merchant = await prisma.merchant.upsert({
    where: { code: 'M-COFFEE-001' },
    update: {},
    create: {
      code: 'M-COFFEE-001',
      name: '山脚咖啡',
      category: '餐饮咖啡',
      level: MerchantLevel.MEMBER_BENEFIT,
      contactName: '李店长',
      contactPhone: '13800000006',
      cooperationStartsAt: new Date('2026-01-01T00:00:00+08:00'),
      settlementRule: {
        mode: 'PER_REDEMPTION',
        feeCents: 200,
        paymentOwner: 'MERCHANT',
      },
    },
  });
  await prisma.userRole.deleteMany({
    where: { userId: merchantUser.id, role: AppRole.MERCHANT },
  });
  await prisma.userRole.create({
    data: {
      userId: merchantUser.id,
      role: AppRole.MERCHANT,
      merchantId: merchant.id,
    },
  });

  const zones = [
    CourtZone.EAST,
    CourtZone.WEST,
    CourtZone.SOUTH,
    CourtZone.NORTH,
  ];
  for (let number = 1; number <= 20; number += 1) {
    await prisma.court.upsert({
      where: { code: `C${String(number).padStart(2, '0')}` },
      update: { enabled: true },
      create: {
        code: `C${String(number).padStart(2, '0')}`,
        name: `${number}号场`,
        zone: zones[Math.floor((number - 1) / 5)],
        usage: number <= 16 ? CourtUsage.RETAIL : CourtUsage.MEMBER_BLOCK,
        sortOrder: number,
      },
    });
  }

  const slotSeeds = [
    ['S01', '晨练场', 7 * 60, 9 * 60, SlotPeriod.EARLY, 6000],
    ['S02', '上午场', 9 * 60, 12 * 60, SlotPeriod.DAYTIME, 9000],
    ['S03', '午间场', 12 * 60, 14 * 60, SlotPeriod.DAYTIME, 7000],
    ['S04', '下午场', 14 * 60, 17 * 60, SlotPeriod.DAYTIME, 9000],
    ['S05', '晚高峰一', 17 * 60, 19 * 60, SlotPeriod.PRIME, 10000],
    ['S06', '晚高峰二', 19 * 60, 21 * 60, SlotPeriod.PRIME, 12000],
    ['S07', '夜场', 21 * 60, 23 * 60, SlotPeriod.PRIME, 8000],
    ['S08', '深夜场', 23 * 60, 24 * 60, SlotPeriod.PRIME, 4000],
  ] as const;
  for (const [
    code,
    label,
    startMinutes,
    endMinutes,
    period,
    priceCents,
  ] of slotSeeds) {
    const slot = await prisma.timeSlot.upsert({
      where: { code },
      update: { label, startMinutes, endMinutes, enabled: true },
      create: {
        code,
        label,
        startMinutes,
        endMinutes,
        period,
        sortOrder: Number(code.slice(1)),
      },
    });
    const priceStart = new Date('2026-01-01T00:00:00+08:00');
    await prisma.priceRule.upsert({
      where: { code_version: { code: `PRICE_${code}`, version: 1 } },
      update: {},
      create: {
        code: `PRICE_${code}`,
        version: 1,
        name: `${label}基础价`,
        timeSlotId: slot.id,
        weekdayMask: 127,
        priceCents,
        newcomerPriceCents: Math.round(priceCents * 0.7),
        effectiveFrom: priceStart,
        effectiveTo: new Date('2099-01-01T00:00:00+08:00'),
        enabled: true,
        creationIdempotencyKey: `SEED:PRICE_${code}:V1`,
        creationCommandHash: 'b'.repeat(64),
        createdById: admin.id,
      },
    });
  }

  const parameters = [
    [
      'training.contract_rate_bps',
      2000,
      ParameterType.INTEGER,
      '培训有效收入计入场馆合同收入比例，锁定20%',
    ],
    [
      'training.venue_fee_cents',
      0,
      ParameterType.INTEGER,
      '培训不得另收场地费',
    ],
    [
      'badminton_coin.cent_value',
      10,
      ParameterType.INTEGER,
      '1羽毛球币可抵扣的分值',
    ],
    [
      'referral.first_payment.coin_reward',
      50,
      ParameterType.INTEGER,
      '直接推荐新客首次付费奖励羽球币',
    ],
    [
      'referral.refund_observation_days',
      7,
      ParameterType.INTEGER,
      '新客首付奖励观察期',
    ],
    [
      'newcomer.experience.valid_days',
      7,
      ParameterType.INTEGER,
      '新客体验权益领取后有效天数',
    ],
    [
      'newcomer.experience.allowed_slot_periods',
      [SlotPeriod.EARLY, SlotPeriod.DAYTIME],
      ParameterType.JSON,
      '新客体验权益允许使用的非黄金时段',
    ],
    ['booking.hold_minutes', 10, ParameterType.INTEGER, '场地订单锁定分钟数'],
    [
      'operations.venue_check_in_window.v1',
      { version: 1, earlyMinutes: 30, lateMinutes: 30 },
      ParameterType.JSON,
      '场地签到窗口V1；开始前30分钟至开始后30分钟，单项运行时硬上限240分钟',
    ],
    [
      'operations.game_check_in_window.v1',
      { version: 1, earlyMinutes: 30, lateMinutes: 30 },
      ParameterType.JSON,
      '球局签到窗口V1；开赛前30分钟至开赛后30分钟，单项运行时硬上限240分钟',
    ],
    [
      'operations.event_check_in_window.v1',
      { version: 1, earlyMinutes: 30, lateMinutes: 30 },
      ParameterType.JSON,
      '赛事签到窗口V1；开赛前30分钟至开赛后30分钟，单项运行时硬上限240分钟',
    ],
    [
      'training.attendance_window.v1',
      { version: 1, earlyMinutes: 30, lateMinutes: 120 },
      ParameterType.JSON,
      '培训到课登记窗口V1；开课前30分钟至结课后120分钟，单项运行时硬上限240分钟',
    ],
    [
      'training.completion_window.v1',
      { version: 1, earlyMinutes: 0, lateMinutes: 240 },
      ParameterType.JSON,
      '培训消课与结课窗口V1；不得早于课次结束，结束后240分钟外仅允许管理员说明原因补录',
    ],
  ] as const;
  for (const [key, value, type, description] of parameters) {
    const effectiveFrom = new Date('2026-01-01T00:00:00+08:00');
    await prisma.systemParameter.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom } },
      update: { value, description, locked: key.startsWith('training.') },
      create: {
        key,
        value,
        type,
        description,
        effectiveFrom,
        locked: key.startsWith('training.'),
        createdById: admin.id,
      },
    });
  }

  const adultProduct = await prisma.trainingProduct.upsert({
    where: { code: 'TR-ADULT-10' },
    update: {},
    create: {
      code: 'TR-ADULT-10',
      name: '成人羽毛球进阶10次课',
      audience: TrainingAudience.ADULT,
      totalSessions: 10,
      validityDays: 120,
      priceCents: 198000,
      unitRevenueCents: 19800,
      refundRule: { mode: 'UNCONSUMED_PRO_RATA' },
    },
  });
  const youthProduct = await prisma.trainingProduct.upsert({
    where: { code: 'TR-YOUTH-20' },
    update: {},
    create: {
      code: 'TR-YOUTH-20',
      name: '青少年成长20次课',
      audience: TrainingAudience.YOUTH,
      totalSessions: 20,
      validityDays: 180,
      priceCents: 360000,
      unitRevenueCents: 18000,
      refundRule: {
        mode: 'UNCONSUMED_PRO_RATA',
        guardianConsentRequired: true,
      },
    },
  });
  await prisma.trainingClass.upsert({
    where: { code: 'CLASS-ADULT-WED' },
    update: {},
    create: {
      code: 'CLASS-ADULT-WED',
      productId: adultProduct.id,
      name: '成人周三进阶班',
      coachId: coach.id,
      schedule: { weekday: 3, start: '19:00' },
      capacity: 12,
      courtCountPerSession: 2,
      hoursPerSession: 2,
      coachCostCents: 60000,
      assistantCostCents: 0,
      materialCostCents: 8000,
    },
  });
  await prisma.trainingClass.upsert({
    where: { code: 'CLASS-YOUTH-SAT' },
    update: {},
    create: {
      code: 'CLASS-YOUTH-SAT',
      productId: youthProduct.id,
      name: '青少年周六成长班',
      coachId: coach.id,
      schedule: { weekday: 6, start: '09:00' },
      capacity: 16,
      courtCountPerSession: 3,
      hoursPerSession: 2,
      coachCostCents: 70000,
      assistantCostCents: 20000,
      materialCostCents: 12000,
    },
  });

  await prisma.game.upsert({
    where: { code: 'GM-WEEKEND-001' },
    update: { startsAt: addDays(5, 19), endsAt: addDays(5, 21), capacity: 6 },
    create: {
      code: 'GM-WEEKEND-001',
      title: '周末进阶双打局',
      hostId: host.id,
      level: GameLevel.INTERMEDIATE,
      status: GameStatus.OPEN,
      startsAt: addDays(5, 19),
      endsAt: addDays(5, 21),
      capacity: 6,
      feeCents: 6800,
      description: '主理人现场分组，按实到人数结算激励',
      rewardRule: { type: 'BADMINTON_COIN', perCheckedIn: 20, cap: 500 },
    },
  });
  await prisma.event.upsert({
    where: { code: 'YQ-SWISS-2026-01' },
    update: { startsAt: addDays(21, 9), registrationEndsAt: addDays(18, 22) },
    create: {
      code: 'YQ-SWISS-2026-01',
      name: '延庆金羽固定双打积分赛',
      startsAt: addDays(21, 9),
      registrationEndsAt: addDays(18, 22),
      status: EventStatus.OPEN,
      capacityPeople: 48,
      minimumPeople: 24,
      totalRounds: 5,
      feeCents: 12800,
      memberFeeCents: 9800,
      sponsor: '山脚咖啡',
      rules: [
        '固定搭档双打',
        '五轮瑞士制',
        '单局21分，20平不加分',
        '男双对女双让5分，男双对混双让2分，混双对女双让2分',
      ],
      prizePool: { badmintonCoins: 3000, sponsorCoupons: 48 },
    },
  });

  const membershipSeeds = [
    [
      'MEMBER-REGULAR-YEAR',
      '金羽年度会员',
      MemberLevel.REGULAR,
      29900,
      365,
      { bookingPriority: true, memberPrice: true },
    ],
    [
      'MEMBER-GOLD-YEAR',
      '金羽年度金卡',
      MemberLevel.GOLD,
      89900,
      365,
      {
        bookingPriority: true,
        memberPrice: true,
        eventDiscount: true,
        allianceBenefits: true,
      },
    ],
    [
      'MEMBER-BLACK-YEAR',
      '金羽年度黑金卡',
      MemberLevel.BLACK,
      199900,
      365,
      {
        bookingPriority: true,
        dedicatedService: true,
        eventDiscount: true,
        allianceBenefits: true,
      },
    ],
  ] as const;
  for (const [
    code,
    name,
    level,
    priceCents,
    durationDays,
    benefits,
  ] of membershipSeeds) {
    await prisma.membershipProduct.upsert({
      where: { code_version: { code, version: 1 } },
      update: {},
      create: {
        code,
        version: 1,
        name,
        level,
        priceCents,
        durationDays,
        benefits,
        effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
        effectiveTo: new Date('2099-01-01T00:00:00+08:00'),
        enabled: true,
        creationIdempotencyKey: `SEED:${code}:V1`,
        creationCommandHash: 'c'.repeat(64),
        createdById: admin.id,
      },
    });
  }

  const rechargePlanSeeds = [
    ['RECHARGE_100', '充值100元', 10_000, 0],
    ['RECHARGE_500', '充值500元赠25元', 50_000, 2_500],
    ['RECHARGE_1000', '充值1000元赠100元', 100_000, 10_000],
  ] as const;
  for (const [code, name, principalCents, giftCents] of rechargePlanSeeds) {
    await prisma.rechargePlan.upsert({
      where: { code_version: { code, version: 1 } },
      update: {},
      create: {
        code,
        version: 1,
        name,
        principalCents,
        giftCents,
        effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
        effectiveTo: new Date('2099-01-01T00:00:00+08:00'),
        enabled: true,
        creationIdempotencyKey: `SEED:${code}:V1`,
        creationCommandHash: 'a'.repeat(64),
        createdById: admin.id,
      },
    });
  }

  const couponTemplate = await prisma.couponTemplate.upsert({
    where: { code: 'COFFEE-AFTER-GAME' },
    update: {},
    create: {
      code: 'COFFEE-AFTER-GAME',
      merchantId: merchant.id,
      name: '赛后咖啡权益券',
      activityName: '金羽赛后补给',
      benefitDescription: '任意咖啡立减10元',
      faceValueCents: 1000,
      validFrom: new Date('2026-01-01T00:00:00+08:00'),
      validTo: new Date('2027-12-31T23:59:59+08:00'),
      claimLimitPerUser: 1,
      issueLimit: 5000,
      issuedCount: 3,
    },
  });
  for (let index = 1; index <= 3; index += 1) {
    const code = `YQ-COFFEE-${String(index).padStart(4, '0')}`;
    await prisma.couponCode.upsert({
      where: { code },
      update: {},
      create: {
        templateId: couponTemplate.id,
        code,
        status: index === 1 ? CouponStatus.CLAIMED : CouponStatus.ISSUED,
        holderId: index === 1 ? member.id : undefined,
        claimedAt: index === 1 ? new Date() : undefined,
        expiresAt: new Date('2027-12-31T23:59:59+08:00'),
      },
    });
  }

  const inventorySeeds = [
    [
      'SHUTTLE-01',
      '比赛级羽毛球',
      '耗材',
      InventoryMode.PURCHASE,
      '燕北体育',
      7800,
      9800,
      8,
      10,
    ],
    [
      'GRIP-01',
      '防滑手胶',
      '配件',
      InventoryMode.CONSIGNMENT,
      '京北羽业',
      500,
      1000,
      60,
      20,
    ],
    [
      'WATER-01',
      '运动电解质水',
      '饮品',
      InventoryMode.PURCHASE,
      '延庆本地供应',
      250,
      500,
      12,
      24,
    ],
  ] as const;
  const mainLocation = await prisma.inventoryLocation.upsert({
    where: { code: 'MAIN' },
    update: { name: '主仓', enabled: true },
    create: { id: 'inventory-location-main', code: 'MAIN', name: '主仓' },
  });
  const ownedSupplier = await prisma.supplier.upsert({
    where: { code: 'SEED-OWNED' },
    update: {
      name: '金羽自营采购',
      type: SupplierType.OWNED,
      settlementRule: { settlementCycle: 'MONTHLY', paymentTermsDays: 30 },
      enabled: true,
    },
    create: {
      code: 'SEED-OWNED',
      name: '金羽自营采购',
      type: SupplierType.OWNED,
      settlementRule: { settlementCycle: 'MONTHLY', paymentTermsDays: 30 },
    },
  });
  const consignmentSupplier = await prisma.supplier.upsert({
    where: { code: 'SEED-CONSIGNMENT' },
    update: {
      name: '合作品牌寄售',
      type: SupplierType.CONSIGNMENT,
      settlementRule: {
        settlementCycle: 'MONTHLY',
        commissionRateBps: 2500,
      },
      enabled: true,
    },
    create: {
      code: 'SEED-CONSIGNMENT',
      name: '合作品牌寄售',
      type: SupplierType.CONSIGNMENT,
      settlementRule: {
        settlementCycle: 'MONTHLY',
        commissionRateBps: 2500,
      },
    },
  });
  for (const [
    sku,
    name,
    category,
    mode,
    supplier,
    purchasePriceCents,
    salePriceCents,
    stock,
    safeStock,
  ] of inventorySeeds) {
    const settlementParty =
      mode === InventoryMode.CONSIGNMENT ? consignmentSupplier : ownedSupplier;
    const inventoryItem = await prisma.inventoryItem.upsert({
      where: { sku },
      update: {
        name,
        category,
        mode,
        supplier,
        supplierId: settlementParty.id,
        defaultLocationId: mainLocation.id,
        purchasePriceCents,
        salePriceCents,
        stock,
        safeStock,
      },
      create: {
        sku,
        name,
        category,
        mode,
        supplier,
        supplierId: settlementParty.id,
        defaultLocationId: mainLocation.id,
        purchasePriceCents,
        salePriceCents,
        stock,
        safeStock,
      },
    });
    await prisma.inventoryStockBalance.upsert({
      where: {
        itemId_locationId_batchCode: {
          itemId: inventoryItem.id,
          locationId: mainLocation.id,
          batchCode: 'DEFAULT',
        },
      },
      update: { quantity: stock },
      create: {
        itemId: inventoryItem.id,
        locationId: mainLocation.id,
        batchCode: 'DEFAULT',
        quantity: stock,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorRole: AppRole.ADMIN,
      action: 'DEMO_DATA_SEEDED',
      objectType: 'System',
      objectId: 'seed',
      newValue: { courts: 20, slots: 8, users: seedUsers.length },
    },
  });
  console.info(
    `Seed completed: 20 courts, 8 slots, ${seedUsers.length} role accounts and demo business data.`,
  );
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
