import {
  coupons as seedCoupons,
  enrollments as seedEnrollments,
  events as seedEvents,
  games as seedGames,
  goods as seedGoods,
  membershipProducts as seedMembershipProducts,
  merchants as seedMerchants,
  trainingProducts as seedTrainingProducts,
  trainingSessions as seedTrainingSessions,
} from "./catalog";

type JsonRecord = Record<string, any>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const KEYS = {
  orders: "yanqing_mock_orders",
  games: "yanqing_mock_games",
  events: "yanqing_mock_events",
  eventDetails: "yanqing_mock_event_details",
  enrollments: "yanqing_mock_enrollments",
  students: "yanqing_mock_students",
  trainingSessions: "yanqing_mock_training_sessions",
  trainingProducts: "yanqing_mock_training_products",
  trainingCreationCommands: "yanqing_mock_training_creation_commands",
  trainingTrials: "yanqing_mock_training_trials",
  youthTrainingRules: "yanqing_mock_youth_training_rules",
  merchants: "yanqing_mock_merchants",
  coupons: "yanqing_mock_coupons",
  couponTemplates: "yanqing_mock_coupon_templates",
  goods: "yanqing_mock_goods",
  inventoryTransactions: "yanqing_mock_inventory_transactions",
  inventorySuppliers: "yanqing_mock_inventory_suppliers",
  inventoryLocations: "yanqing_mock_inventory_locations",
  inventoryBalances: "yanqing_mock_inventory_balances",
  purchaseOrders: "yanqing_mock_purchase_orders",
  stocktakes: "yanqing_mock_stocktakes",
  inventoryOperations: "yanqing_mock_inventory_operations",
  settlements: "yanqing_mock_settlements",
  reconciliationPeriods: "yanqing_mock_reconciliation_periods",
  venueBookings: "yanqing_mock_venue_bookings",
  venueClosures: "yanqing_mock_venue_closures",
  customerLeads: "yanqing_mock_customer_leads",
  hostApplications: "yanqing_mock_host_applications",
  orderCreations: "yanqing_mock_order_creations",
  rechargePlans: "yanqing_mock_recharge_plans",
  membershipProducts: "yanqing_mock_membership_products",
  priceRules: "yanqing_mock_price_rules",
  memberAccounts: "yanqing_mock_member_accounts",
  memberAccountTransactions: "yanqing_mock_member_account_transactions",
  accountAdjustmentRequests: "yanqing_mock_account_adjustment_requests",
  frontDeskShifts: "yanqing_mock_front_desk_shifts",
  trainingConsumeCorrections: "yanqing_mock_training_consume_corrections",
  trainingSettlements: "yanqing_mock_training_settlements",
  consignmentPayableEntries: "yanqing_mock_consignment_payable_entries",
  consignmentSettlements: "yanqing_mock_consignment_settlements",
  governanceUsers: "yanqing_mock_governance_users",
  systemParameters: "yanqing_mock_system_parameters",
  riskEvents: "yanqing_mock_risk_events",
  auditLogs: "yanqing_mock_audit_logs",
  dataErasureRequests: "yanqing_mock_data_erasure_requests",
} as const;

function read<T>(key: string, fallback: T): T {
  const value = uni.getStorageSync(key);
  return value === undefined || value === null || value === ""
    ? clone(fallback)
    : (value as T);
}

function write<T>(key: string, value: T): T {
  const next = clone(value);
  uni.setStorageSync(key, next);
  return next;
}

const initialSettlement = () => [
  {
    id: "settlement-mock-1",
    merchantId: "merchant-coffee",
    merchant: { id: "merchant-coffee", name: "山脚咖啡", category: "餐饮" },
    periodStart: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    periodEnd: new Date().toISOString(),
    issuedCount: 120,
    claimedCount: 72,
    redeemedCount: 48,
    effectiveNewCustomers: 31,
    attributedGmvCents: 420_000,
    attributedGrossProfitCents: 180_000,
    cooperationFeeCents: 12_000,
    roi: 15,
    status: "DRAFT",
    detail: { workflowHistory: [] },
  },
];

const initialTrainingSettlements = (): JsonRecord[] => {
  const now = new Date();
  const start = new Date(now.getTime() - 86_400_000);
  const end = new Date(now);
  return [
    {
      id: "training-settlement-mock-1",
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      effectiveRevenueCents: 168_000,
      contractRateBps: 2_000,
      venueContributionCents: 33_600,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      coachCostCents: 36_000,
      assistantCostCents: 8_000,
      materialCostCents: 5_000,
      acquisitionCostCents: 0,
      marketingCostCents: 0,
      occupiedCourtHours: 6,
      cashContributionMarginCents: 119_000,
      status: "DRAFT",
      confirmedById: null,
      confirmedAt: null,
      createdById: "user-finance",
      createdBy: { id: "user-finance", displayName: "金羽财务" },
      workflowHistory: [
        {
          action: "TRAINING_SETTLEMENT_CREATED",
          actorId: "user-finance",
          actorName: "金羽财务",
          oldValue: null,
          newValue: { status: "DRAFT" },
          reason: null,
          at: now.toISOString(),
        },
      ],
      processedIdempotencyKeys: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ];
};

const initialConsignmentPayableEntries = (): JsonRecord[] => {
  const occurredAt = `${new Date(Date.now() - 86_400_000)
    .toISOString()
    .slice(0, 10)}T04:00:00.000Z`;
  return [
    {
      id: "consignment-payable-mock-1",
      type: "SALE",
      supplierId: "supplier-consignment",
      supplier: {
        id: "supplier-consignment",
        code: "CONSIGN-01",
        name: "合作品牌寄售",
      },
      itemId: "goods-grip",
      item: {
        id: "goods-grip",
        sku: "GRIP-001",
        name: "专业吸汗手胶",
      },
      orderId: "order-consignment-seed",
      orderItemId: "order-item-consignment-seed",
      order: {
        id: "order-consignment-seed",
        orderNo: "GD-MOCK-CONSIGN-001",
        completedAt: occurredAt,
      },
      refundId: null,
      refund: null,
      reversalOfId: null,
      quantity: 2,
      unitSalePriceCents: 1_500,
      grossSaleCents: 3_000,
      commissionRateBps: 2_500,
      commissionCents: 750,
      payableCents: 2_250,
      ruleSnapshot: {
        supplierCode: "CONSIGN-01",
        supplierName: "合作品牌寄售",
        sku: "GRIP-001",
        itemName: "专业吸汗手胶",
        settlementCycle: "MONTHLY",
        commissionRateBps: 2_500,
        commissionMeaning: "VENUE_COMMISSION",
      },
      occurredAt,
      idempotencyKey: "CONSIGNMENT-SALE:order-item-consignment-seed",
      createdAt: occurredAt,
    },
  ];
};

const initialCustomerLeads = (): JsonRecord[] => [
  {
    id: "lead-mock-1",
    displayName: "体验客户小赵",
    phone: "13800000018",
    status: "CONTACTING",
    sourceChannel: "DOUYIN",
    campaign: "延庆周末体验课",
    referrerId: null,
    ownerId: "user-frontdesk",
    owner: { id: "user-frontdesk", displayName: "前台小羽" },
    convertedMemberId: null,
    nextFollowUpAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    followUps: [
      {
        id: "follow-up-mock-1",
        kind: "WECHAT",
        content: "已发送体验课时间表",
        statusBefore: "NEW",
        statusAfter: "CONTACTING",
        createdAt: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const initialHostApplications = (): JsonRecord[] => [
  {
    id: "host-profile-mock",
    userId: "user-member",
    status: "APPLIED",
    appliedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    user: {
      id: "user-member",
      displayName: "延庆会员小林",
      phone: "13800000005",
      memberProfile: { level: "GOLD", visitCount: 18 },
    },
  },
];

const initialGovernanceUsers = (): JsonRecord[] => [
  { id: "user-member", displayName: "延庆会员小林", phone: "13800000005", status: "ACTIVE", primaryRole: "MEMBER", roles: [{ role: "MEMBER", merchantId: null }], wechatBound: true },
  { id: "user-frontdesk", displayName: "前台小羽", phone: "13800000001", status: "ACTIVE", primaryRole: "FRONT_DESK", roles: [{ role: "MEMBER", merchantId: null }, { role: "FRONT_DESK", merchantId: null }], wechatBound: true },
  { id: "user-coach", displayName: "王教练", phone: "13800000002", status: "ACTIVE", primaryRole: "COACH", roles: [{ role: "MEMBER", merchantId: null }, { role: "COACH", merchantId: null }], wechatBound: true },
  { id: "user-host", displayName: "周末主理人阿凯", phone: "13800000003", status: "ACTIVE", primaryRole: "HOST", roles: [{ role: "MEMBER", merchantId: null }, { role: "HOST", merchantId: null }], wechatBound: true },
  { id: "user-merchant", displayName: "山脚咖啡商户", phone: "13800000004", status: "ACTIVE", primaryRole: "MERCHANT", roles: [{ role: "MEMBER", merchantId: null }, { role: "MERCHANT", merchantId: "merchant-coffee", merchant: { id: "merchant-coffee", name: "山脚咖啡" } }], wechatBound: true },
  { id: "user-finance", displayName: "金羽财务", phone: "13800000006", status: "ACTIVE", primaryRole: "FINANCE", roles: [{ role: "MEMBER", merchantId: null }, { role: "FINANCE", merchantId: null }], wechatBound: true },
  { id: "user-event", displayName: "赛事管理员", phone: "13800000007", status: "ACTIVE", primaryRole: "EVENT_MANAGER", roles: [{ role: "MEMBER", merchantId: null }, { role: "EVENT_MANAGER", merchantId: null }], wechatBound: true },
  { id: "user-admin", displayName: "金羽管理员", phone: "13800000008", status: "ACTIVE", primaryRole: "ADMIN", roles: [{ role: "MEMBER", merchantId: null }, { role: "ADMIN", merchantId: null }], wechatBound: true },
  { id: "user-super", displayName: "超级管理员", phone: "13800000009", status: "ACTIVE", primaryRole: "SUPER_ADMIN", roles: [{ role: "MEMBER", merchantId: null }, { role: "SUPER_ADMIN", merchantId: null }], wechatBound: true },
  { id: "user-privacy", displayName: "待注销演示会员", phone: "13800000010", status: "DISABLED", primaryRole: "MEMBER", roles: [{ role: "MEMBER", merchantId: null }], wechatBound: true },
];

const initialDataErasureRequests = (): JsonRecord[] => [{
  id: "erasure-mock-ready",
  userId: "user-privacy",
  user: { id: "user-privacy", displayName: "待注销演示会员", phone: "13800000010", status: "DISABLED" },
  status: "REQUESTED",
  reason: "不再使用场馆服务",
  requestIdempotencyKey: "erasure-mock-ready-request",
  requestCommandHash: "mock-ready-command",
  decisionIdempotencyKey: null,
  decisionCommandHash: null,
  reviewedById: null,
  reviewedBy: null,
  reviewReason: null,
  requestedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  reviewedAt: null,
  completedAt: null,
  createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
}];

const initialSystemParameters = (): JsonRecord[] => [
  { id: "parameter-training-rate", key: "training.contract_rate_bps", value: 2000, type: "INTEGER", description: "培训有效流水计入场馆合同收入比例", locked: true, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-training-venue-fee", key: "training.venue_fee_cents", value: 0, type: "INTEGER", description: "培训场地费硬禁用", locked: true, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-newcomer-valid-days", key: "newcomer.experience.valid_days", value: 7, type: "INTEGER", description: "新客体验权益领取后有效天数", locked: false, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-newcomer-periods", key: "newcomer.experience.allowed_slot_periods", value: ["EARLY", "DAYTIME"], type: "JSON", description: "新客体验权益允许使用的非黄金时段", locked: false, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-booking-hold", key: "booking.hold_minutes", value: 10, type: "INTEGER", description: "待支付订单占场分钟数", locked: false, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-venue-check-in-window-v1", key: "operations.venue_check_in_window.v1", value: { version: 1, earlyMinutes: 30, lateMinutes: 30 }, type: "JSON", description: "场地签到窗口 v1（提前/延后均不超过240分钟）", locked: false, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-game-check-in-window-v1", key: "operations.game_check_in_window.v1", value: { version: 1, earlyMinutes: 30, lateMinutes: 30 }, type: "JSON", description: "球局签到窗口 v1（提前/延后均不超过240分钟）", locked: false, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-event-check-in-window-v1", key: "operations.event_check_in_window.v1", value: { version: 1, earlyMinutes: 30, lateMinutes: 30 }, type: "JSON", description: "赛事签到窗口 v1（提前/延后均不超过240分钟）", locked: false, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-training-attendance-window-v1", key: "training.attendance_window.v1", value: { version: 1, earlyMinutes: 30, lateMinutes: 120 }, type: "JSON", description: "培训点名与试听签到窗口 v1（提前/延后均不超过240分钟）", locked: true, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
  { id: "parameter-training-completion-window-v1", key: "training.completion_window.v1", value: { version: 1, earlyMinutes: 0, lateMinutes: 240 }, type: "JSON", description: "培训消课、结课与试听未到窗口 v1（提前/延后均不超过240分钟）", locked: true, effectiveFrom: "2026-01-01T00:00:00+08:00", effectiveTo: null },
];

const initialRechargePlans = (): JsonRecord[] => [
  {
    id: "recharge-plan-mock-100",
    code: "RECHARGE_100",
    version: 1,
    name: "充值100元",
    principalCents: 10_000,
    giftCents: 0,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: "2099-01-01T00:00:00+08:00",
    enabled: true,
    createdById: "user-admin",
    createdBy: { id: "user-admin", displayName: "金羽管理员" },
    transitions: [],
    createdAt: "2026-01-01T00:00:00+08:00",
    updatedAt: "2026-01-01T00:00:00+08:00",
  },
  {
    id: "recharge-plan-mock-500",
    code: "RECHARGE_500",
    version: 1,
    name: "充值500元赠25元",
    principalCents: 50_000,
    giftCents: 2_500,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: "2099-01-01T00:00:00+08:00",
    enabled: true,
    createdById: "user-admin",
    createdBy: { id: "user-admin", displayName: "金羽管理员" },
    transitions: [],
    createdAt: "2026-01-01T00:00:00+08:00",
    updatedAt: "2026-01-01T00:00:00+08:00",
  },
  {
    id: "recharge-plan-mock-1000",
    code: "RECHARGE_1000",
    version: 1,
    name: "充值1000元赠100元",
    principalCents: 100_000,
    giftCents: 10_000,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: "2099-01-01T00:00:00+08:00",
    enabled: true,
    createdById: "user-admin",
    createdBy: { id: "user-admin", displayName: "金羽管理员" },
    transitions: [],
    createdAt: "2026-01-01T00:00:00+08:00",
    updatedAt: "2026-01-01T00:00:00+08:00",
  },
];

const initialMembershipProducts = (): JsonRecord[] =>
  seedMembershipProducts.map((product) => ({
    ...product,
    creationIdempotencyKey: `SEED:${product.code}:V${product.version}`,
    creationCommandHash: "c".repeat(64),
  }));

const initialPriceRules = (): JsonRecord[] => {
  const labels = ["晨练", "上午一", "上午二", "午间", "下午一", "下午二", "晚场一", "晚场二"];
  const prices = [6_800, 6_800, 6_800, 6_800, 6_800, 6_800, 8_800, 8_800];
  return labels.map((label, index) => ({
    id: `price-rule-${index + 1}`,
    code: `PRICE_S${index + 1}`,
    version: 1,
    name: `${label}基础价`,
    timeSlotId: `slot-${index + 1}`,
    weekdayMask: 127,
    priceCents: prices[index],
    newcomerPriceCents: index < 6 ? 4_800 : null,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: "2099-01-01T00:00:00+08:00",
    enabled: true,
    creationIdempotencyKey: `SEED:PRICE_S${index + 1}:V1`,
    creationCommandHash: "b".repeat(64),
    createdById: "user-admin",
    createdBy: { id: "user-admin", displayName: "金羽管理员" },
    transitions: [],
    createdAt: "2026-01-01T00:00:00+08:00",
    updatedAt: "2026-01-01T00:00:00+08:00",
  }));
};

const initialRiskEvents = (): JsonRecord[] => [
  { id: "risk-mock-1", ruleCode: "COUPON_DEVICE_BURST", severity: "HIGH", status: "OPEN", userId: "user-member", objectType: "CouponCode", objectId: "coupon-1002", summary: "同设备短时领取多张联盟券", evidence: { deviceClaims: 5 }, resolvedBy: null, resolvedAt: null, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() },
  { id: "risk-mock-2", ruleCode: "PAYMENT_CALLBACK_MISMATCH", severity: "MEDIUM", status: "REVIEWING", userId: "user-member", orderId: "order-1001", objectType: "Payment", objectId: "payment-mock", summary: "支付回调金额与订单金额不一致", evidence: { orderAmountCents: 12000, callbackAmountCents: 11900 }, resolvedBy: null, resolvedAt: null, createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
];

const initialAuditLogs = (): JsonRecord[] => [
  { id: "audit-mock-1", actorId: "user-admin", actor: { id: "user-admin", displayName: "金羽管理员" }, actorRole: "ADMIN", action: "PARAMETER_VERSION_CREATED", objectType: "SystemParameter", objectId: "parameter-booking-hold", reason: "初始化预约规则", result: "SUCCESS", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
];

const initialMemberAccounts = (): Record<string, JsonRecord[]> => {
  const accountTypes = [
    ["CASH_PRINCIPAL", 128_000],
    ["GIFT_BALANCE", 20_000],
    ["BADMINTON_COIN", 500],
    ["EVENT_POINTS", 126],
    ["GROWTH_POINTS", 860],
  ] as const;
  const build = (userId: string, balanceRatio = 1) =>
    accountTypes.map(([type, balance]) => ({
      id: `account-${userId}-${type.toLowerCase()}`,
      userId,
      type,
      balance: Math.round(balance * balanceRatio),
      frozenBalance: 0,
      version: 0,
    }));
  return {
    "member-1": build("member-1"),
    "member-2": build("member-2", 0.4),
  };
};

function buildEventDetail(eventId: string): JsonRecord {
  const summary =
    getEvents().find((item) => item.id === eventId) || seedEvents[0];
  const fixture = eventId === seedEvents[0]?.id;
  const completedFixture = eventId === seedEvents[1]?.id;
  const teams =
    fixture || completedFixture
      ? Array.from({ length: 12 }, (_, index) => ({
          id: `team-${index + 1}`,
          name: `金羽组合${index + 1}`,
          playerAName: `队员${index * 2 + 1}`,
          playerBName: `队员${index * 2 + 2}`,
          category:
            index % 3 === 0
              ? "MEN_DOUBLES"
              : index % 3 === 1
                ? "WOMEN_DOUBLES"
                : "MIXED_DOUBLES",
          // Keep the fixture at the 24-person start threshold so the event
          // workbench can exercise the full Swiss workflow immediately.
          status: completedFixture ? "COMPLETED" : "CHECKED_IN",
          points: 0,
          wins: 0,
          losses: 0,
          scoreDiff: 0,
          finalRank: completedFixture ? index + 1 : null,
          eventPointsAwarded: completedFixture ? Math.max(1, 12 - index) : 0,
          opponents: [],
        }))
      : [];
  const makeMatch = (
    id: string,
    round: number,
    teamAId: string,
    teamBId: string,
    status: string,
    scoreA: number | null,
    scoreB: number | null,
    startingScoreA = 0,
    startingScoreB = 0,
  ) => ({
    id,
    round,
    teamAId,
    teamBId,
    status,
    courtLabel: `${round}-${id}号场`,
    startingScoreA,
    startingScoreB,
    scoreA,
    scoreB,
  });
  const matches = fixture
    ? [
        makeMatch("match-r1-1", 1, "team-1", "team-3", "CONFIRMED", 21, 18),
        makeMatch(
          "match-r1-2",
          1,
          "team-2",
          "team-4",
          "CONFIRMED",
          21,
          15,
          5,
          0,
        ),
        makeMatch(
          "match-r1-3",
          1,
          "team-5",
          "team-7",
          "CONFIRMED",
          21,
          17,
          5,
          0,
        ),
        makeMatch(
          "match-r1-4",
          1,
          "team-6",
          "team-8",
          "CONFIRMED",
          21,
          16,
          0,
          2,
        ),
        makeMatch(
          "match-r1-5",
          1,
          "team-9",
          "team-11",
          "CONFIRMED",
          21,
          19,
          0,
          2,
        ),
        makeMatch(
          "match-r1-6",
          1,
          "team-10",
          "team-12",
          "CONFIRMED",
          21,
          14,
          0,
          2,
        ),
        makeMatch(
          "match-r2-1",
          2,
          "team-1",
          "team-5",
          "CONFIRMED",
          21,
          16,
          0,
          5,
        ),
        makeMatch(
          "match-r2-2",
          2,
          "team-2",
          "team-6",
          "CONFIRMED",
          21,
          17,
          2,
          0,
        ),
        makeMatch(
          "match-r2-3",
          2,
          "team-3",
          "team-7",
          "CONFIRMED",
          21,
          18,
          2,
          0,
        ),
        makeMatch(
          "match-r2-4",
          2,
          "team-4",
          "team-8",
          "CONFIRMED",
          21,
          15,
          0,
          5,
        ),
        makeMatch(
          "match-r2-5",
          2,
          "team-9",
          "team-10",
          "CONFIRMED",
          21,
          19,
          2,
          0,
        ),
        makeMatch(
          "match-r2-6",
          2,
          "team-11",
          "team-12",
          "PENDING",
          null,
          null,
          2,
          0,
        ),
      ]
    : [];
  return {
    ...clone(summary),
    ...(fixture ? { status: "IN_PROGRESS" } : {}),
    teams,
    matches,
    prizeAwards: [],
  };
}

export function getGames(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.games, seedGames as JsonRecord[]);
}
export function saveGames(value: JsonRecord[]) {
  return write(KEYS.games, value);
}

export function getEvents(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.events, seedEvents as JsonRecord[]);
}
export function saveEvents(value: JsonRecord[]) {
  return write(KEYS.events, value);
}

export function getEventDetail(eventId: string): JsonRecord {
  const details = read<Record<string, JsonRecord>>(KEYS.eventDetails, {});
  if (!details[eventId]) {
    details[eventId] = buildEventDetail(eventId);
    write(KEYS.eventDetails, details);
  }
  return details[eventId];
}

export function saveEventDetail(value: JsonRecord) {
  const details = read<Record<string, JsonRecord>>(KEYS.eventDetails, {});
  details[value.id] = value;
  write(KEYS.eventDetails, details);
  const summaries = getEvents().map((item) =>
    item.id === value.id
      ? {
          ...item,
          status: value.status,
          currentRound: value.currentRound,
          cancelReason: value.cancelReason,
          cancelPolicySnapshot: value.cancelPolicySnapshot,
          cancelledAt: value.cancelledAt,
          _count: {
            teams: (value.teams || []).filter(
              (team: JsonRecord) =>
                !["CANCELLED", "REFUNDED"].includes(team.status),
            ).length,
          },
        }
      : item,
  );
  saveEvents(summaries);
  return value;
}

/** Rebuild the visible Swiss standings from immutable mock match results. */
export function recomputeEventStandings(detail: JsonRecord) {
  const teams = (detail.teams || []) as JsonRecord[];
  const byId = new Map(teams.map((team) => [team.id, team]));
  teams.forEach((team) => {
    team.points = 0;
    team.wins = 0;
    team.losses = 0;
    team.scoreDiff = 0;
  });
  for (const match of (detail.matches || []) as JsonRecord[]) {
    if (!["CONFIRMED", "CORRECTED"].includes(match.status)) continue;
    const teamA = byId.get(match.teamAId);
    if (!teamA || match.scoreA === null || match.scoreB === null) continue;
    if (!match.teamBId) {
      teamA.points += 1;
      teamA.wins += 1;
      continue;
    }
    const teamB = byId.get(match.teamBId);
    if (!teamB) continue;
    const scoreA = Number(match.scoreA);
    const scoreB = Number(match.scoreB);
    teamA.scoreDiff += scoreA - scoreB;
    teamB.scoreDiff += scoreB - scoreA;
    if (scoreA > scoreB) {
      teamA.points += 1;
      teamA.wins += 1;
      teamB.losses += 1;
    } else {
      teamB.points += 1;
      teamB.wins += 1;
      teamA.losses += 1;
    }
  }
  return detail;
}

export function getEnrollments(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.enrollments, seedEnrollments as JsonRecord[]);
}
export function saveEnrollments(value: JsonRecord[]) {
  return write(KEYS.enrollments, value);
}
export function getStudents(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.students, [
    {
      id: "student-youth-1",
      guardianId: "user-member",
      displayName: "小羽学员",
      guardianConsentStatus: true,
      authorizationNote: "监护人已在测试环境确认授权",
      guardian: { id: "user-member", displayName: "延庆会员小林" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
}
export function saveStudents(value: JsonRecord[]) {
  return write(KEYS.students, value);
}
export function getTrainingSessions(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.trainingSessions,
    seedTrainingSessions as JsonRecord[],
  );
}
export function saveTrainingSessions(value: JsonRecord[]) {
  return write(KEYS.trainingSessions, value);
}
export function getTrainingProducts(): JsonRecord[] {
  const products = read<JsonRecord[]>(
    KEYS.trainingProducts,
    seedTrainingProducts as JsonRecord[],
  );
  return products.map((product) => ({
    enabled: true,
    ...product,
    classes: (product.classes || []).map((trainingClass: JsonRecord) => ({
      active: true,
      ...(trainingClass.id === "class-adult" ? { coachId: "user-coach" } : {}),
      ...trainingClass,
    })),
  }));
}
export function saveTrainingProducts(value: JsonRecord[]) {
  return write(KEYS.trainingProducts, value);
}
export function getTrainingCreationCommands(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.trainingCreationCommands, []);
}
export function saveTrainingCreationCommands(value: JsonRecord[]) {
  return write(KEYS.trainingCreationCommands, value);
}
export function getTrainingTrials(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.trainingTrials, []);
}
export function saveTrainingTrials(value: JsonRecord[]) {
  return write(KEYS.trainingTrials, value);
}
export function getYouthTrainingRules(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.youthTrainingRules, []);
}
export function saveYouthTrainingRules(value: JsonRecord[]) {
  return write(KEYS.youthTrainingRules, value);
}
export function getMerchants(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.merchants, seedMerchants as JsonRecord[]);
}
export function saveMerchants(value: JsonRecord[]) {
  return write(KEYS.merchants, value);
}
export function getCoupons(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.coupons, seedCoupons as JsonRecord[]);
}
export function saveCoupons(value: JsonRecord[]) {
  return write(KEYS.coupons, value);
}
const defaultCouponTemplates = (): JsonRecord[] =>
  seedCoupons.map((coupon: any, index) => ({
    id: coupon.templateId || `coupon-template-${index + 1}`,
    code: coupon.template?.code || `COUPON-${index + 1}`,
    merchantId:
      coupon.merchantId ||
      coupon.template?.merchantId ||
      coupon.template?.merchant?.id,
    merchant: coupon.template?.merchant,
    benefitDescription:
      coupon.template?.benefitDescription || "联盟商户专属权益",
    faceValueCents: Number(coupon.template?.faceValueCents || 0),
    enabled: true,
    validFrom: new Date(Date.now() - 86_400_000).toISOString(),
    validTo:
      coupon.expiresAt || new Date(Date.now() + 30 * 86_400_000).toISOString(),
    issueLimit: 2000,
    issuedCount: 1,
    claimedCount: 0,
    redeemedCount: 0,
  }));
export function getCouponTemplates(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.couponTemplates, defaultCouponTemplates());
}
export function saveCouponTemplates(value: JsonRecord[]) {
  return write(KEYS.couponTemplates, value);
}
export function getGoods(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.goods,
    (seedGoods as JsonRecord[]).map((item) => ({
      ...item,
      supplierId:
        item.mode === "CONSIGNMENT"
          ? "supplier-consignment"
          : "supplier-owned",
      defaultLocationId: "inventory-location-main",
      batchCode: "DEFAULT",
      expiresAt: null,
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    })),
  );
}
export function saveGoods(value: JsonRecord[]) {
  return write(KEYS.goods, value);
}
export function getInventoryTransactions() {
  return read<JsonRecord[]>(KEYS.inventoryTransactions, []);
}
export function saveInventoryTransactions(value: JsonRecord[]) {
  return write(KEYS.inventoryTransactions, value);
}
export function getInventorySuppliers() {
  return read<JsonRecord[]>(KEYS.inventorySuppliers, [
    {
      id: "supplier-owned",
      code: "OWNED-01",
      name: "金羽自营采购",
      type: "OWNED",
      contactName: "采购经理",
      contactPhone: "13800000001",
      settlementRule: {
        settlementCycle: "MONTHLY",
        paymentTermsDays: 30,
      },
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    {
      id: "supplier-consignment",
      code: "CONSIGN-01",
      name: "合作品牌寄售",
      type: "CONSIGNMENT",
      contactName: "品牌经理",
      contactPhone: "13800000002",
      settlementRule: {
        settlementCycle: "MONTHLY",
        commissionRateBps: 2500,
      },
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ]);
}
export function saveInventorySuppliers(value: JsonRecord[]) {
  return write(KEYS.inventorySuppliers, value);
}
export function getInventoryLocations() {
  return read<JsonRecord[]>(KEYS.inventoryLocations, [
    {
      id: "inventory-location-main",
      code: "MAIN",
      name: "主仓",
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    {
      id: "inventory-location-front",
      code: "FRONT",
      name: "前台展示仓",
      enabled: true,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
  ]);
}
export function saveInventoryLocations(value: JsonRecord[]) {
  return write(KEYS.inventoryLocations, value);
}
export function getInventoryBalances() {
  return read<JsonRecord[]>(
    KEYS.inventoryBalances,
    getGoods().map((item) => ({
      id: `balance-${item.id}-main`,
      itemId: item.id,
      locationId: "inventory-location-main",
      batchCode: "DEFAULT",
      quantity: Number(item.stock || 0),
    })),
  );
}
export function saveInventoryBalances(value: JsonRecord[]) {
  return write(KEYS.inventoryBalances, value);
}
export function getPurchaseOrders() {
  return read<JsonRecord[]>(KEYS.purchaseOrders, []);
}
export function savePurchaseOrders(value: JsonRecord[]) {
  return write(KEYS.purchaseOrders, value);
}
export function getStocktakes() {
  return read<JsonRecord[]>(KEYS.stocktakes, []);
}
export function saveStocktakes(value: JsonRecord[]) {
  return write(KEYS.stocktakes, value);
}
export function getInventoryOperations() {
  return read<JsonRecord[]>(KEYS.inventoryOperations, []);
}
export function saveInventoryOperations(value: JsonRecord[]) {
  return write(KEYS.inventoryOperations, value);
}
export function getSettlements(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.settlements, initialSettlement());
}
export function saveSettlements(value: JsonRecord[]) {
  return write(KEYS.settlements, value);
}
export function getReconciliationPeriods(): Record<string, JsonRecord> {
  return read<Record<string, JsonRecord>>(KEYS.reconciliationPeriods, {});
}
export function saveReconciliationPeriods(value: Record<string, JsonRecord>) {
  return write(KEYS.reconciliationPeriods, value);
}

/**
 * Retail court holds are kept separately from orders in the mock transport.
 * This mirrors the API's CourtBooking rows and lets the availability screen
 * immediately reflect a newly-created hold (and its later payment/check-in)
 * across pages and role switches.
 */
export function getVenueBookings(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.venueBookings, []);
}

export function saveVenueBookings(value: JsonRecord[]) {
  return write(KEYS.venueBookings, value);
}

export function getVenueClosures(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.venueClosures, []);
}

export function saveVenueClosures(value: JsonRecord[]) {
  return write(KEYS.venueClosures, value);
}

export function getCustomerLeads(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.customerLeads, initialCustomerLeads());
}

export function saveCustomerLeads(value: JsonRecord[]) {
  return write(KEYS.customerLeads, value);
}

export function getHostApplications(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.hostApplications, initialHostApplications());
}

export function saveHostApplications(value: JsonRecord[]) {
  return write(KEYS.hostApplications, value);
}

export function getOrderCreations(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.orderCreations, []);
}

export function getRechargePlans(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.rechargePlans, initialRechargePlans());
}

export function getMembershipProducts(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.membershipProducts, initialMembershipProducts());
}

export function saveMembershipProducts(value: JsonRecord[]) {
  return write(KEYS.membershipProducts, value);
}

export function getPriceRules(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.priceRules, initialPriceRules());
}

export function savePriceRules(value: JsonRecord[]) {
  return write(KEYS.priceRules, value);
}

export function saveRechargePlans(value: JsonRecord[]) {
  return write(KEYS.rechargePlans, value);
}

export function saveOrderCreations(value: JsonRecord[]) {
  return write(KEYS.orderCreations, value);
}

export function getMemberAccounts(): Record<string, JsonRecord[]> {
  return read<Record<string, JsonRecord[]>>(
    KEYS.memberAccounts,
    initialMemberAccounts(),
  );
}

export function saveMemberAccounts(value: Record<string, JsonRecord[]>) {
  return write(KEYS.memberAccounts, value);
}

export function getMemberAccountTransactions(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.memberAccountTransactions, []);
}

export function saveMemberAccountTransactions(value: JsonRecord[]) {
  return write(KEYS.memberAccountTransactions, value);
}

export function getAccountAdjustmentRequests(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.accountAdjustmentRequests, []);
}

export function saveAccountAdjustmentRequests(value: JsonRecord[]) {
  return write(KEYS.accountAdjustmentRequests, value);
}

export function getFrontDeskShifts(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.frontDeskShifts, []);
}

export function saveFrontDeskShifts(value: JsonRecord[]) {
  return write(KEYS.frontDeskShifts, value);
}

export function getTrainingConsumeCorrections(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.trainingConsumeCorrections, []);
}

export function saveTrainingConsumeCorrections(value: JsonRecord[]) {
  return write(KEYS.trainingConsumeCorrections, value);
}

export function getTrainingSettlements(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.trainingSettlements,
    initialTrainingSettlements(),
  );
}

export function saveTrainingSettlements(value: JsonRecord[]) {
  return write(KEYS.trainingSettlements, value);
}

export function getConsignmentPayableEntries(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.consignmentPayableEntries,
    initialConsignmentPayableEntries(),
  );
}

export function saveConsignmentPayableEntries(value: JsonRecord[]) {
  return write(KEYS.consignmentPayableEntries, value);
}

export function getConsignmentSettlements(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.consignmentSettlements, []);
}

export function saveConsignmentSettlements(value: JsonRecord[]) {
  return write(KEYS.consignmentSettlements, value);
}

export function getGovernanceUsers(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.governanceUsers, initialGovernanceUsers());
}

export function saveGovernanceUsers(value: JsonRecord[]) {
  return write(KEYS.governanceUsers, value);
}

export function getSystemParameters(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.systemParameters, initialSystemParameters());
}

export function saveSystemParameters(value: JsonRecord[]) {
  return write(KEYS.systemParameters, value);
}

export function getDataErasureRequests(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.dataErasureRequests, initialDataErasureRequests());
}

export function saveDataErasureRequests(value: JsonRecord[]) {
  return write(KEYS.dataErasureRequests, value);
}

export function getRiskEvents(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.riskEvents, initialRiskEvents());
}

export function saveRiskEvents(value: JsonRecord[]) {
  return write(KEYS.riskEvents, value);
}

export function getAuditLogs(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.auditLogs, initialAuditLogs());
}

export function saveAuditLogs(value: JsonRecord[]) {
  return write(KEYS.auditLogs, value);
}

export function resetCatalogState() {
  Object.values(KEYS).forEach((key) => uni.removeStorageSync(key));
}
