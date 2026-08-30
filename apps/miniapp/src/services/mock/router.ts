import type { AppRole } from "../../types/domain";
import { mockLogin, mockUser } from "./core";
import { availability, getOrders, saveOrders } from "./venue";
import { membershipProducts } from "./catalog";
import {
  getAccountAdjustmentRequests,
  getCoupons,
  getCouponTemplates,
  getCustomerLeads,
  getEnrollments,
  getEventDetail,
  getEvents,
  getGames,
  getFrontDeskShifts,
  getHostApplications,
  getGoods,
  getInventoryTransactions,
  getMemberAccounts,
  getMemberAccountTransactions,
  getInventorySuppliers,
  getInventoryLocations,
  getInventoryBalances,
  getOrderCreations,
  getPurchaseOrders,
  getStocktakes,
  getInventoryOperations,
  getMerchants,
  getReconciliationPeriods,
  getSettlements,
  getStudents,
  getTrainingSessions,
  getTrainingProducts,
  getTrainingCreationCommands,
  getTrainingConsumeCorrections,
  getTrainingSettlements,
  getGovernanceUsers,
  getSystemParameters,
  getRiskEvents,
  getAuditLogs,
  getVenueBookings,
  getVenueClosures,
  recomputeEventStandings,
  saveCoupons,
  saveAccountAdjustmentRequests,
  saveCouponTemplates,
  saveCustomerLeads,
  saveEnrollments,
  saveEventDetail,
  saveEvents,
  saveGames,
  saveFrontDeskShifts,
  saveHostApplications,
  saveGoods,
  saveInventoryTransactions,
  saveMemberAccounts,
  saveMemberAccountTransactions,
  saveInventoryBalances,
  saveOrderCreations,
  savePurchaseOrders,
  saveStocktakes,
  saveInventoryOperations,
  saveMerchants,
  saveReconciliationPeriods,
  saveSettlements,
  saveStudents,
  saveTrainingSessions,
  saveTrainingProducts,
  saveTrainingCreationCommands,
  saveTrainingConsumeCorrections,
  saveTrainingSettlements,
  saveGovernanceUsers,
  saveSystemParameters,
  saveRiskEvents,
  saveAuditLogs,
  saveVenueBookings,
  saveVenueClosures,
} from "./state";

const ok = (value: any) => JSON.parse(JSON.stringify(value));

/**
 * The mock transport is used as an acceptance harness, so it must enforce
 * the same action-level role boundary as the API.  UI menu hiding is not a
 * security control: a tester can (and should) call a route directly after
 * switching identities to verify that an unauthorized action is rejected.
 */
const mockRoles = (): AppRole[] =>
  mockUser().roles.map((role) => (typeof role === "string" ? role : role.role));

const hasMockRole = (...allowed: AppRole[]) =>
  allowed.some((role) => mockRoles().includes(role));

const requireMockRole = (...allowed: AppRole[]) => {
  if (!hasMockRole(...allowed))
    throw new Error(`当前角色无权执行该操作，需要：${allowed.join("、")}`);
};
const requireInventoryRead = () =>
  requireMockRole(
    "FRONT_DESK",
    "COACH",
    "EVENT_MANAGER",
    "FINANCE",
    "ADMIN",
    "SUPER_ADMIN",
  );

const assignedMerchant = (merchantId: unknown) =>
  Boolean(merchantId) && String(merchantId) === "merchant-coffee";
const merchantDirectoryIsScoped = () =>
  hasMockRole("MERCHANT") && !hasMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
const templateDirectoryIsScoped = () => !hasMockRole("ADMIN", "SUPER_ADMIN");
const settlementDirectoryIsScoped = () =>
  !hasMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
const merchantCanManage = (merchantId: unknown) => {
  if (!merchantId) return false;
  if (hasMockRole("ADMIN", "SUPER_ADMIN")) return true;
  // The fixture merchant account represents 山脚咖啡.  In production this is
  // resolved from UserRole.merchantId; keeping the same boundary in the mock
  // prevents a role switch from exposing another merchant's ledger.
  return hasMockRole("MERCHANT") && assignedMerchant(merchantId);
};
const merchantCanRedeem = (merchantId: unknown) =>
  hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN") ||
  merchantCanManage(merchantId);

const assertTrainingSettlementPeriodUnlocked = (
  periodStart: Date,
  periodEnd: Date,
) => {
  const shifted = new Date(periodStart.getTime() + 8 * 60 * 60 * 1_000);
  const firstBusinessDay = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) -
      8 * 60 * 60 * 1_000,
  );
  const locked = Object.values(getReconciliationPeriods()).find((period: any) => {
    if (period?.status !== "LOCKED") return false;
    const businessDate = new Date(String(period.businessDate || ""));
    return (
      Number.isFinite(businessDate.getTime()) &&
      businessDate.getTime() >= firstBusinessDay.getTime() &&
      businessDate.getTime() < periodEnd.getTime()
    );
  });
  if (locked) throw new Error("账期包含已锁定营业日，不能新增或变更培训结算");
};

interface MockVenueMember {
  id: string;
  displayName: string;
  phone?: string;
  status?: "ACTIVE";
  level?: string;
  memberProfile?: Record<string, unknown>;
}

const MOCK_ACTIVE_MEMBERS: MockVenueMember[] = [
  {
    id: "member-1",
    displayName: "延庆会员小林",
    phone: "13800000005",
    status: "ACTIVE",
    level: "GOLD",
    memberProfile: { level: "GOLD" },
  },
  {
    id: "member-2",
    displayName: "羽友小周",
    phone: "13800000007",
    status: "ACTIVE",
    level: "REGULAR",
    memberProfile: { level: "REGULAR" },
  },
];

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const integer = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value)
    ? value
    : Number.isInteger(Number(value))
      ? Number(value)
      : NaN;
const isExpired = (value: unknown) => {
  if (!value) return false;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) && time <= Date.now();
};
const requireIdempotencyKey = (value: unknown, label = "幂等键") => {
  const key = text(value);
  if (key.length < 8 || key.length > 100)
    throw new Error(`${label}长度必须为8-100个字符`);
  return key;
};
const requireTrainingCreationReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 2 || reason.length > 300)
    throw new Error("创建原因长度必须为2-300个字符");
  return reason;
};
const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const newOrderNo = (prefix = "YQ") =>
  `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const normalizeCreationCommand = (value: unknown, inArray = false): unknown => {
  if (value === undefined) return inArray ? null : undefined;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value.map((item) => normalizeCreationCommand(item, true));
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = normalizeCreationCommand(
        (value as Record<string, unknown>)[key],
      );
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  }
  return String(value);
};

const creationCommandHash = (command: unknown) => {
  const canonical = JSON.stringify(normalizeCreationCommand(command));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

type MockCreationAttempt =
  | { tracked: false; replayed: false }
  | {
      tracked: true;
      replayed: boolean;
      key: string;
      memberId: string;
      commandHash: string;
      response?: any;
    };

const beginMockOrderCreation = (
  creationIdempotencyKey: unknown,
  command: unknown,
  targetMemberId = mockUser().id,
): MockCreationAttempt => {
  if (!text(creationIdempotencyKey)) return { tracked: false, replayed: false };
  const key = requireIdempotencyKey(
    creationIdempotencyKey,
    "订单创建幂等键",
  );
  const memberId = targetMemberId;
  const commandHash = creationCommandHash(command);
  const existing = getOrderCreations().find((item) => item.key === key);
  if (existing) {
    if (
      existing.memberId !== memberId ||
      existing.commandHash !== commandHash
    ) {
      throw new Error("订单创建幂等键已用于其他用户或其他创建指令");
    }
    return {
      tracked: true,
      replayed: true,
      key,
      memberId,
      commandHash,
      response: existing.response,
    };
  }
  return { tracked: true, replayed: false, key, memberId, commandHash };
};

const finishMockOrderCreation = (
  attempt: MockCreationAttempt,
  response: any,
): any => {
  if (attempt.tracked && !attempt.replayed) {
    saveOrderCreations([
      {
        key: attempt.key,
        memberId: attempt.memberId,
        commandHash: attempt.commandHash,
        response: ok(response),
        createdAt: new Date().toISOString(),
      },
      ...getOrderCreations(),
    ]);
  }
  return ok(response);
};

type MockTrainingCreationAttempt = {
  replayed: boolean;
  key: string;
  actorId: string;
  action: string;
  objectType: string;
  commandHash: string;
  response?: any;
};

const beginMockTrainingCreation = (
  creationIdempotencyKey: unknown,
  action: string,
  objectType: string,
  command: unknown,
): MockTrainingCreationAttempt => {
  const key = requireIdempotencyKey(
    creationIdempotencyKey,
    "培训创建幂等键",
  );
  const actorId = mockUser().id;
  const commandHash = creationCommandHash(command);
  const existing = getTrainingCreationCommands().find(
    (item) => item.key === key,
  );
  if (existing) {
    if (
      existing.actorId !== actorId ||
      existing.action !== action ||
      existing.objectType !== objectType ||
      existing.commandHash !== commandHash
    ) {
      throw new Error("培训操作幂等键已用于不同命令");
    }
    return {
      replayed: true,
      key,
      actorId,
      action,
      objectType,
      commandHash,
      response: existing.response,
    };
  }
  return {
    replayed: false,
    key,
    actorId,
    action,
    objectType,
    commandHash,
  };
};

const finishMockTrainingCreation = (
  attempt: MockTrainingCreationAttempt,
  response: any,
  reason: string,
): any => {
  if (attempt.replayed) return ok(attempt.response);
  const snapshot = ok(response);
  saveTrainingCreationCommands([
    {
      key: attempt.key,
      actorId: attempt.actorId,
      action: attempt.action,
      objectType: attempt.objectType,
      objectId: response.id,
      commandHash: attempt.commandHash,
      response: snapshot,
      createdAt: new Date().toISOString(),
    },
    ...getTrainingCreationCommands(),
  ]);
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: attempt.actorId,
      actorRole: mockUser().primaryRole,
      action: attempt.action,
      objectType: attempt.objectType,
      objectId: response.id,
      oldValue: { exists: false },
      newValue: { ...snapshot, commandHash: attempt.commandHash },
      reason,
      requestId: attempt.key,
      createdAt: new Date().toISOString(),
    },
    ...getAuditLogs(),
  ]);
  return snapshot;
};

const mockMemberIdentity = (userId: string) => {
  if (userId === "member-1")
    return {
      id: userId,
      displayName: "延庆会员小林",
      phone: "13800000005",
    };
  if (userId === "member-2")
    return { id: userId, displayName: "羽友小周", phone: "13800000007" };
  return { id: userId, displayName: userId, phone: null };
};

const mockActorIdentity = (userId: string) => {
  const actorRoles: AppRole[] = [
    "FRONT_DESK",
    "COACH",
    "FINANCE",
    "ADMIN",
    "SUPER_ADMIN",
  ];
  const actor = actorRoles.map((role) => mockUser(role)).find((item) => item.id === userId);
  return actor
    ? { id: actor.id, displayName: actor.displayName }
    : { id: userId, displayName: userId };
};

const mockShanghaiBusinessDate = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const frontDeskShiftView = (shift: any) => ({
  ...shift,
  operator: mockActorIdentity(shift.operatorId),
  openedBy: mockActorIdentity(shift.openedById),
  closedBy: shift.closedById ? mockActorIdentity(shift.closedById) : null,
  varianceReviewedBy: shift.varianceReviewedById
    ? mockActorIdentity(shift.varianceReviewedById)
    : null,
});

const requireMockOpenFrontDeskShift = () => {
  if (hasMockRole("ADMIN", "SUPER_ADMIN")) return null;
  if (!hasMockRole("FRONT_DESK"))
    throw new Error("仅已开班前台或管理员可执行该操作");
  const businessDate = mockShanghaiBusinessDate();
  const shift = getFrontDeskShifts().find(
    (item) =>
      item.businessDateLabel === businessDate &&
      item.venueCode === "MAIN" &&
      item.operatorId === mockUser().id &&
      item.status === "OPEN",
  );
  if (!shift) throw new Error("当前前台未开班或今日班次已关闭，请先开班");
  return shift;
};

const findMockTrainingLedger = (recognitionId: string) => {
  const enrollments = getEnrollments();
  for (const enrollment of enrollments) {
    for (const attendance of enrollment.attendances || []) {
      const recognition = (attendance.revenueRecognitions || []).find(
        (item: any) => item.id === recognitionId,
      );
      if (recognition)
        return { enrollments, enrollment, attendance, recognition };
    }
  }
  return null;
};

const activeMockConsumeRecognition = (attendance: any) =>
  [...(attendance?.revenueRecognitions || [])]
    .filter(
      (recognition: any) =>
        recognition.type === "CONSUME" && !recognition.reversedBy,
    )
    .sort((a: any, b: any) => Number(b.sequence) - Number(a.sequence))[0] ||
  null;

const trainingCorrectionView = (correction: any) => {
  const ledger = findMockTrainingLedger(correction.recognitionId);
  const reversal = correction.reversalRecognitionId
    ? findMockTrainingLedger(correction.reversalRecognitionId)?.recognition ||
      null
    : null;
  const lesson = ledger
    ? getTrainingSessions().find(
        (item) => item.id === ledger.attendance.sessionId,
      )
    : null;
  return {
    ...correction,
    recognition: ledger?.recognition || null,
    reversalRecognition: reversal,
    attendance: ledger
      ? {
          ...ledger.attendance,
          session: lesson,
          enrollment: {
            id: ledger.enrollment.id,
            status: ledger.enrollment.status,
            consumedSessions: ledger.enrollment.consumedSessions,
            confirmedRevenueCents: ledger.enrollment.confirmedRevenueCents,
            prepaidBalanceCents: ledger.enrollment.prepaidBalanceCents,
            growthPointsBalance: ledger.enrollment.growthPointsBalance || 0,
            student: ledger.enrollment.student || null,
            buyer: ledger.enrollment.buyer || null,
            product: ledger.enrollment.product,
          },
        }
      : null,
    requestedBy: mockActorIdentity(correction.requestedById),
    reviewedBy: correction.reviewedById
      ? mockActorIdentity(correction.reviewedById)
      : null,
  };
};

const postMockTrainingConsume = (
  enrollment: any,
  attendance: any,
  requestedIdempotencyKey?: string,
) => {
  const requestedKey = text(requestedIdempotencyKey);
  if (requestedKey) {
    const existing = getEnrollments()
      .flatMap((item) => item.attendances || [])
      .flatMap((item: any) => item.revenueRecognitions || [])
      .find((item: any) => item.idempotencyKey === requestedKey);
    if (existing) {
      if (
        existing.attendanceId === attendance.id &&
        existing.type === "CONSUME" &&
        !existing.reversedBy
      )
        return existing;
      throw new Error("消课幂等键已用于其他流水");
    }
  }
  const recognized = Math.min(
    trainingUnitRevenue(enrollment),
    Number(enrollment.prepaidBalanceCents || 0),
  );
  const venueContribution = Math.round(recognized * 0.2);
  const sequence = Math.max(
    0,
    ...(attendance.revenueRecognitions || []).map((item: any) =>
      Number(item.sequence || 0),
    ),
  ) + 1;
  const recognition = {
    id: newId("recognition"),
    attendanceId: attendance.id,
    enrollmentId: enrollment.id,
    type: "CONSUME",
    sequence,
    reversalOfId: null,
    reversedBy: null,
    effectiveRevenueCents: recognized,
    recognizedRevenueCents: recognized,
    contractRateBps: 2_000,
    venueContributionCents: venueContribution,
    venueFeeCents: 0,
    trainingPayableVenueCents: 0,
    idempotencyKey:
      requestedKey || `CONSUME:${attendance.id}:${sequence}`,
    createdAt: new Date().toISOString(),
  };
  enrollment.usedSessions =
    Number(enrollment.usedSessions || enrollment.consumedSessions || 0) + 1;
  enrollment.consumedSessions = enrollment.usedSessions;
  enrollment.confirmedRevenueCents =
    Number(enrollment.confirmedRevenueCents || 0) + recognized;
  enrollment.prepaidBalanceCents = Math.max(
    0,
    Number(enrollment.prepaidBalanceCents || 0) - recognized,
  );
  if (enrollment.product?.audience === "YOUTH") {
    enrollment.growthPointsBalance =
      Number(enrollment.growthPointsBalance || 0) + 1;
  }
  if (
    enrollment.usedSessions >= Number(enrollment.totalSessions || 0) ||
    enrollment.prepaidBalanceCents <= 0
  )
    enrollment.status = "COMPLETED";
  Object.assign(attendance, {
    status: "ATTENDED",
    consumedSessions: 1,
    consumedAt: new Date().toISOString(),
    confirmedRevenueCents: recognized,
    growthPointsAwarded: enrollment.product?.audience === "YOUTH" ? 1 : 0,
    operatorId: mockUser().id,
    revenueRecognitions: [
      ...(attendance.revenueRecognitions || []),
      recognition,
    ],
  });
  return recognition;
};

const accountAdjustmentView = (request: any) => {
  const account = Object.values(getMemberAccounts())
    .flat()
    .find((item: any) => item.id === request.accountId) as any;
  const transaction = request.transactionId
    ? getMemberAccountTransactions().find(
        (item) => item.id === request.transactionId,
      ) || null
    : null;
  return {
    ...request,
    account: account
      ? { ...account, user: mockMemberIdentity(account.userId) }
      : null,
    requestedBy: mockActorIdentity(request.requestedById),
    reviewedBy: request.reviewedById
      ? mockActorIdentity(request.reviewedById)
      : null,
    transaction,
  };
};

const GAME_CAPACITY_MIN = 4;
const GAME_CAPACITY_MAX = 6;
const validGameCapacity = (capacity: unknown) => {
  const parsed = integer(capacity);
  return (
    Number.isFinite(parsed) &&
    parsed >= GAME_CAPACITY_MIN &&
    parsed <= GAME_CAPACITY_MAX
  );
};
const gameCapacity = (game: any) =>
  validGameCapacity(game.capacity) ? integer(game.capacity) : 0;
const activeRegistrationStatuses = ["REGISTERED", "PAID", "CHECKED_IN"];
const activeTeamStatuses = ["REGISTERED", "PAID", "CHECKED_IN", "COMPLETED"];
const eventCapacity = (event: any) =>
  integer(event.capacityPeople) && event.capacityPeople > 0
    ? event.capacityPeople
    : 48;
const eventMinimumPeople = (event: any) =>
  integer(event.minimumPeople) && event.minimumPeople > 0
    ? event.minimumPeople
    : 24;
const eventRoundLimit = (event: any) =>
  integer(event.totalRounds) && event.totalRounds > 0 ? event.totalRounds : 5;
const trainingUnitRevenue = (enrollment: any) => {
  const product = enrollment?.product || {};
  const explicit = integer(product.unitRevenueCents)
    ? Number(product.unitRevenueCents)
    : NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const total = Number(product.priceCents || enrollment?.totalAmountCents || 0);
  const sessions = Number(
    product.totalSessions || enrollment?.totalSessions || 1,
  );
  return Math.max(0, Math.round(total / Math.max(1, sessions)));
};
const startsAtDate = (date: string, minutes: number) => {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return new Date(`${date}T${hours}:${mins}:00+08:00`);
};

/** Promote exactly one oldest waiting member after a seat is released. */
const promoteMockGameWaitlist = (game: any) => {
  const registrations = game.registrations || [];
  const seated = registrations.filter((item: any) =>
    activeRegistrationStatuses.includes(item.status),
  );
  if (seated.length >= gameCapacity(game)) return null;
  const next = registrations
    .filter((item: any) => item.status === "WAITLISTED" && !item.orderId)
    .sort((a: any, b: any) =>
      String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)),
    )[0];
  if (!next) {
    if (game.status === "FULL") game.status = "OPEN";
    return null;
  }
  const orderId = newId("order");
  Object.assign(next, {
    status: "REGISTERED",
    orderId,
    promotedAt: new Date().toISOString(),
  });
  game._count = { ...(game._count || {}), registrations: seated.length + 1 };
  game.status = seated.length + 1 >= gameCapacity(game) ? "FULL" : "OPEN";
  const order = {
    id: orderId,
    orderNo: newOrderNo("GO"),
    title: game.title,
    status: "PENDING",
    businessType: "GAME",
    gameId: game.id,
    payableCents: Number(game.feeCents || 0),
    paidCents: 0,
    refundedCents: 0,
    createdAt: new Date().toISOString(),
    memberId: next.userId,
    parameterSnapshot: {
      gameId: game.id,
      hostId: game.hostId,
      promotedFromWaitlist: true,
    },
  };
  return { order, registration: next };
};

const couponMerchantId = (coupon: any) =>
  coupon.merchantId ||
  coupon.template?.merchantId ||
  coupon.template?.merchant?.id;
const couponTemplate = (coupon: any) =>
  coupon.template ||
  getCouponTemplates().find((item) => item.id === coupon.templateId);
const requireEvent = (eventId: string) => {
  if (!getEvents().some((event) => event.id === eventId))
    throw new Error("赛事不存在");
  return getEventDetail(eventId);
};

const eventStartingScore = (
  categoryA: unknown,
  categoryB: unknown,
): [number, number] => {
  const a = text(categoryA) || "MIXED_DOUBLES";
  const b = text(categoryB) || "MIXED_DOUBLES";
  if (a === "MEN_DOUBLES" && b === "WOMEN_DOUBLES") return [0, 5];
  if (a === "WOMEN_DOUBLES" && b === "MEN_DOUBLES") return [5, 0];
  if (a === "MEN_DOUBLES" && b === "MIXED_DOUBLES") return [0, 2];
  if (a === "MIXED_DOUBLES" && b === "MEN_DOUBLES") return [2, 0];
  if (a === "WOMEN_DOUBLES" && b === "MIXED_DOUBLES") return [2, 0];
  if (a === "MIXED_DOUBLES" && b === "WOMEN_DOUBLES") return [0, 2];
  return [0, 0];
};

const buildMockSwissPairings = (teams: any[], round: number) => {
  const sorted = [...teams].sort(
    (a, b) =>
      Number(b.points || 0) - Number(a.points || 0) ||
      Number(b.scoreDiff || 0) - Number(a.scoreDiff || 0) ||
      String(a.id).localeCompare(String(b.id)),
  );
  // Rotate the lower half after round one.  The small deterministic search
  // below then avoids an opponent that has already appeared in the team's
  // history whenever an alternative is available.
  if (round > 1 && sorted.length > 2) {
    const pivot = Math.ceil(sorted.length / 2);
    const lower = sorted.splice(pivot);
    const shift = (round - 1) % lower.length;
    sorted.push(...lower.slice(shift), ...lower.slice(0, shift));
  }
  const remaining = [...sorted];
  const pairings: any[] = [];
  while (remaining.length) {
    const teamA = remaining.shift();
    let candidateIndex = remaining.findIndex((candidate) => {
      const opponents = Array.isArray(teamA.opponents) ? teamA.opponents : [];
      return (
        !opponents.includes(candidate.id) &&
        !(
          Array.isArray(candidate.opponents) &&
          candidate.opponents.includes(teamA.id)
        )
      );
    });
    if (candidateIndex < 0) candidateIndex = remaining.length ? 0 : -1;
    if (candidateIndex < 0) {
      pairings.push({ teamA, teamB: null });
    } else {
      const [teamB] = remaining.splice(candidateIndex, 1);
      pairings.push({ teamA, teamB });
    }
  }
  return pairings;
};

// The mock keeps the same idempotent state machine as the API so an operator
// can exercise OPEN/REVIEW/LOCKED transitions without a database.  It is
// intentionally local to the mock transport and does not affect production.
const reconciliationTotals = {
  orderPaidCents: 2866000,
  orderRefundedCents: 0,
  successfulPaymentCents: 2866000,
  completedRefundCents: 0,
  trainingEffectiveRevenueCents: 1680000,
  trainingVenueContributionCents: 336000,
  trainingSettlementVenueContributionCents: 0,
  allianceAttributedGmvCents: 420000,
  allianceCooperationFeeCents: 12000,
  inventoryTransactionCount: 4,
  inventoryCostCents: 27200,
};

const mockReconciliationBlockers = (date: string) => {
  const dayStart = new Date(`${date}T00:00:00+08:00`).getTime();
  const dayEnd = dayStart + 86_400_000;
  const pendingRefunds = getOrders()
    .flatMap((order) => order.refunds || [])
    .filter(
      (refund: any) =>
        ["REQUESTED", "APPROVED", "PROCESSING"].includes(refund.status) &&
        new Date(refund.requestedAt || 0).getTime() < dayEnd,
    ).length;
  const pendingPayments = getOrders().filter(
    (order) =>
      ["CREATED", "PROCESSING"].includes(order.paymentStatus) &&
      new Date(order.createdAt || 0).getTime() < dayEnd,
  ).length;
  const pendingTraining = getTrainingSettlements().filter(
    (settlement) =>
      ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"].includes(
        settlement.status,
      ) && new Date(settlement.periodEnd || 0).getTime() <= dayEnd,
  ).length;
  const pendingAlliance = getSettlements().filter(
    (settlement) =>
      ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"].includes(
        settlement.status,
      ) && new Date(settlement.periodEnd || 0).getTime() <= dayEnd,
  ).length;
  const dayShifts = getFrontDeskShifts().filter(
    (shift) => shift.businessDateLabel === date && shift.venueCode === "MAIN",
  );
  const openShifts = dayShifts.filter((shift) => shift.status === "OPEN").length;
  const unreviewedVariances = dayShifts.filter(
    (shift) =>
      shift.status === "CLOSED" &&
      Number(shift.cashVarianceCents || 0) !== 0 &&
      !shift.varianceReviewedAt,
  ).length;
  return [
    ...(pendingRefunds
      ? [{ kind: "PENDING_REFUNDS", count: pendingRefunds, message: `有 ${pendingRefunds} 笔退款待处理` }]
      : []),
    ...(pendingPayments
      ? [{ kind: "PENDING_PAYMENTS", count: pendingPayments, message: `有 ${pendingPayments} 笔支付待处理` }]
      : []),
    ...(pendingTraining
      ? [{ kind: "PENDING_TRAINING_SETTLEMENTS", count: pendingTraining, message: `有 ${pendingTraining} 笔培训结算待处理` }]
      : []),
    ...(pendingAlliance
      ? [{ kind: "PENDING_ALLIANCE_SETTLEMENTS", count: pendingAlliance, message: `有 ${pendingAlliance} 笔联盟结算待处理` }]
      : []),
    ...(openShifts
      ? [{ kind: "OPEN_FRONT_DESK_SHIFTS", count: openShifts, message: `有 ${openShifts} 个前台班次尚未关班` }]
      : []),
    ...(unreviewedVariances
      ? [{ kind: "UNREVIEWED_CASH_VARIANCES", count: unreviewedVariances, message: `有 ${unreviewedVariances} 个班次现金差异待复核` }]
      : []),
  ];
};

export async function mockRequest<T>(
  method: string,
  url: string,
  data: any = {},
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (url === "/auth/wechat-login") return ok(mockLogin("MEMBER"));
  if (url === "/auth/dev-login")
    return ok(mockLogin((data.role || "MEMBER") as AppRole));
  if (url === "/auth/me") return ok(mockUser());
  if (url === "/parameters" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const prefix = text(data.prefix);
    return ok(getSystemParameters().filter((item) =>
      !prefix || String(item.key).startsWith(prefix),
    ));
  }
  if (url === "/parameters" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const key = text(data.key);
    const description = text(data.description);
    const effectiveFrom = new Date(String(data.effectiveFrom || ""));
    if (!key || key.length > 120) throw new Error("参数键不能为空且不能超过120字符");
    if (description.length < 2 || description.length > 300) throw new Error("参数说明长度必须为2-300字符");
    if (!Number.isFinite(effectiveFrom.getTime())) throw new Error("生效时间无效");
    if (key === "training.contract_rate_bps" && Number(data.value) !== 2000)
      throw new Error("培训计入场馆合同收入比例锁定为20%");
    if (key === "training.venue_fee_cents" && Number(data.value) !== 0)
      throw new Error("培训不得另收场地费");
    const parameters = getSystemParameters();
    const current = parameters
      .filter((item) => item.key === key)
      .sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)))[0];
    const locked = Boolean(data.locked) || key.startsWith("training.");
    if (current && effectiveFrom.getTime() === new Date(current.effectiveFrom).getTime()) {
      const sameCommand =
        JSON.stringify(current.value) === JSON.stringify(data.value) &&
        current.type === (text(data.type) || "STRING") &&
        current.description === description &&
        current.locked === locked;
      if (sameCommand) return ok(current);
      throw new Error("同一参数与生效时间已被其他命令占用");
    }
    if (current && effectiveFrom.getTime() <= new Date(current.effectiveFrom).getTime())
      throw new Error("新版本生效时间必须晚于上一版本");
    if (current?.locked && !hasMockRole("SUPER_ADMIN"))
      throw new Error("锁定参数仅超级管理员可变更");
    if (current && !current.effectiveTo) current.effectiveTo = effectiveFrom.toISOString();
    const now = new Date().toISOString();
    const created = {
      id: newId("parameter"), key, value: data.value,
      type: text(data.type) || "STRING", description,
      locked,
      effectiveFrom: effectiveFrom.toISOString(), effectiveTo: null,
      createdById: mockUser().id, createdAt: now,
    };
    saveSystemParameters([created, ...parameters]);
    saveAuditLogs([{
      id: newId("audit"), actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: mockRoles()[0], action: "PARAMETER_VERSION_CREATED",
      objectType: "SystemParameter", objectId: created.id,
      oldValue: current ? { id: current.id, value: current.value } : null,
      newValue: { key, value: data.value, effectiveFrom: created.effectiveFrom },
      reason: text(data.reason) || description,
      result: "SUCCESS", createdAt: now,
    }, ...getAuditLogs()]);
    return ok(created);
  }
  if (url === "/audit-logs" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const objectType = text(data.objectType);
    const items = getAuditLogs().filter((item) =>
      !objectType || item.objectType === objectType,
    );
    return ok({ items, total: items.length, page: 1, pageSize: 100 });
  }
  if (url === "/governance/users" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const keyword = text(data.keyword).toLowerCase();
    const role = text(data.role);
    const status = text(data.status);
    const items = getGovernanceUsers().filter((item) =>
      (!keyword || `${item.displayName} ${item.phone || ""}`.toLowerCase().includes(keyword)) &&
      (!status || item.status === status) &&
      (!role || item.primaryRole === role || item.roles?.some((entry: any) => entry.role === role)),
    );
    return ok({ items, total: items.length, page: 1, pageSize: 100 });
  }
  const governanceRolesMatch = url.match(/^\/governance\/users\/([^/]+)\/roles$/);
  if (governanceRolesMatch && method === "POST") {
    requireMockRole("SUPER_ADMIN");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === governanceRolesMatch[1]);
    if (!user) throw new Error("用户不存在");
    const roles = [...new Set((Array.isArray(data.roles) ? data.roles : []).map(text))].sort();
    const primaryRole = text(data.primaryRole);
    const reason = text(data.reason);
    if (!roles.length || !roles.includes(primaryRole)) throw new Error("主角色必须包含在角色集合中");
    if (reason.length < 2) throw new Error("请填写角色变更原因");
    if (user.id === mockUser().id && !roles.includes("SUPER_ADMIN"))
      throw new Error("超级管理员不能移除自己的超级管理员角色");
    const merchantId = text(data.merchantId);
    if (roles.includes("MERCHANT") && !merchantId) throw new Error("商户角色必须关联商户");
    if (!roles.includes("MERCHANT") && merchantId) throw new Error("仅商户角色可以关联商户");
    const requestId = data.idempotencyKey
      ? requireIdempotencyKey(data.idempotencyKey, "治理角色幂等键")
      : "";
    const action = "USER_ROLES_SET";
    const commandHash = creationCommandHash({
      kind: action,
      userId: user.id,
      primaryRole,
      roles,
      merchantId: merchantId || null,
      reason,
    });
    const replay = requestId
      ? getAuditLogs().find((item) => item.requestId === requestId)
      : null;
    if (replay) {
      if (
        replay.actorId !== mockUser().id ||
        replay.action !== action ||
        replay.objectType !== "User" ||
        replay.objectId !== user.id ||
        replay.newValue?.commandHash !== commandHash
      )
        throw new Error("治理操作幂等键已用于不同命令");
      return ok(user);
    }
    if (user.status !== "ACTIVE") throw new Error("停用用户不能配置角色");
    const merchant = merchantId
      ? getMerchants().find((item) => item.id === merchantId)
      : null;
    if (
      merchantId &&
      (!merchant || (merchant.status && merchant.status !== "ACTIVE"))
    )
      throw new Error("有效商户不存在");
    const oldValue = { primaryRole: user.primaryRole, roles: user.roles };
    const nextRoles = roles.map((role) => ({
      role,
      merchantId: role === "MERCHANT" ? merchantId : null,
      ...(role === "MERCHANT" ? { merchant } : {}),
    }));
    const unchanged =
      user.primaryRole === primaryRole &&
      JSON.stringify(user.roles) === JSON.stringify(nextRoles);
    if (!unchanged) {
      user.primaryRole = primaryRole;
      user.roles = nextRoles;
      user.updatedAt = new Date().toISOString();
      saveGovernanceUsers(users);
    }
    if (!unchanged || requestId) {
      const createdAt = user.updatedAt || new Date().toISOString();
      saveAuditLogs([{
        id: newId("audit"), actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName }, actorRole: "SUPER_ADMIN",
        action, objectType: "User", objectId: user.id,
        oldValue,
        newValue: { primaryRole, roles: nextRoles, commandHash },
        reason, ...(requestId ? { requestId } : {}),
        result: "SUCCESS", createdAt,
      }, ...getAuditLogs()]);
    }
    return ok(user);
  }
  const governanceStatusMatch = url.match(/^\/governance\/users\/([^/]+)\/status$/);
  if (governanceStatusMatch && method === "POST") {
    requireMockRole("SUPER_ADMIN");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === governanceStatusMatch[1]);
    if (!user) throw new Error("用户不存在");
    const status = text(data.status);
    const reason = text(data.reason);
    if (!["ACTIVE", "DISABLED"].includes(status)) throw new Error("用户状态无效");
    if (reason.length < 2) throw new Error("请填写状态变更原因");
    if (user.id === mockUser().id && status !== "ACTIVE") throw new Error("不能停用当前登录的超级管理员");
    if (user.status === status) return ok(user);
    const oldStatus = user.status;
    user.status = status;
    user.updatedAt = new Date().toISOString();
    saveGovernanceUsers(users);
    saveAuditLogs([{
      id: newId("audit"), actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName }, actorRole: "SUPER_ADMIN",
      action: "USER_STATUS_SET", objectType: "User", objectId: user.id,
      oldValue: { status: oldStatus }, newValue: { status }, reason,
      result: "SUCCESS", createdAt: user.updatedAt,
    }, ...getAuditLogs()]);
    return ok(user);
  }
  if (url === "/governance/risk-events" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    const severity = text(data.severity);
    const items = getRiskEvents().filter((item) =>
      (!status || item.status === status) && (!severity || item.severity === severity),
    );
    return ok({ items, total: items.length, page: 1, pageSize: 100 });
  }
  const riskActionMatch = url.match(/^\/governance\/risk-events\/([^/]+)\/(review|resolve|dismiss)$/);
  if (riskActionMatch && method === "POST") {
    const action = riskActionMatch[2];
    requireMockRole(...(action === "review"
      ? ["FINANCE", "ADMIN", "SUPER_ADMIN"] as AppRole[]
      : ["ADMIN", "SUPER_ADMIN"] as AppRole[]));
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("请填写风险处理原因");
    const risks = getRiskEvents();
    const risk = risks.find((item) => item.id === riskActionMatch[1]);
    if (!risk) throw new Error("风险事件不存在");
    const target = action === "review" ? "REVIEWING" : action === "resolve" ? "RESOLVED" : "DISMISSED";
    if (risk.status === target) return ok(risk);
    if (["RESOLVED", "DISMISSED"].includes(risk.status)) throw new Error("终态风险事件不能再次处理");
    if (action === "review" && risk.status !== "OPEN") throw new Error("只有待处理风险可以进入复核");
    const oldStatus = risk.status;
    risk.status = target;
    risk.evidence = { ...(risk.evidence || {}), lastAction: action, lastReason: reason, lastActorId: mockUser().id };
    risk.resolvedBy = target === "REVIEWING" ? null : mockUser().id;
    risk.resolvedAt = target === "REVIEWING" ? null : new Date().toISOString();
    saveRiskEvents(risks);
    saveAuditLogs([{
      id: newId("audit"), actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName }, actorRole: mockRoles()[0],
      action: `RISK_EVENT_${target}`, objectType: "RiskEvent", objectId: risk.id,
      oldValue: { status: oldStatus }, newValue: { status: target }, reason,
      result: "SUCCESS", createdAt: new Date().toISOString(),
    }, ...getAuditLogs()]);
    return ok(risk);
  }
  if (url === "/operations/shifts/current" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const businessDate = mockShanghaiBusinessDate();
    const shift = getFrontDeskShifts().find(
      (item) =>
        item.businessDateLabel === businessDate &&
        item.venueCode === "MAIN" &&
        item.operatorId === mockUser().id,
    );
    return ok(shift ? frontDeskShiftView(shift) : null);
  }
  if (url === "/operations/shifts/history" && method === "GET") {
    requireMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const canSeeAll = hasMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    if (status && !["OPEN", "CLOSED"].includes(status))
      throw new Error("班次状态无效");
    const operatorId = canSeeAll
      ? text(data.operatorId)
      : mockUser().id;
    const limit = Number.isInteger(integer(data.limit))
      ? Math.min(100, Math.max(1, integer(data.limit)))
      : 30;
    const shifts = getFrontDeskShifts()
      .filter(
        (item) =>
          item.venueCode === "MAIN" &&
          (!status || item.status === status) &&
          (!operatorId || item.operatorId === operatorId),
      )
      .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)))
      .slice(0, limit)
      .map(frontDeskShiftView);
    return ok(shifts);
  }
  if (url === "/operations/shifts/open" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const openingCashCents = integer(data.openingCashCents);
    if (!Number.isSafeInteger(openingCashCents) || openingCashCents < 0)
      throw new Error("开班备用金必须为非负整数分");
    const businessDateLabel = mockShanghaiBusinessDate();
    const shifts = getFrontDeskShifts();
    const existing = shifts.find(
      (item) =>
        item.businessDateLabel === businessDateLabel &&
        item.venueCode === "MAIN" &&
        item.operatorId === mockUser().id,
    );
    if (existing) {
      if (existing.status === "CLOSED")
        throw new Error("今日班次已经关闭，不能重复开班");
      if (Number(existing.openingCashCents) !== openingCashCents)
        throw new Error("今日班次已用不同备用金开班");
      return ok(frontDeskShiftView(existing));
    }
    const now = new Date().toISOString();
    const shift = {
      id: newId("front-desk-shift"),
      businessDate: new Date(
        `${businessDateLabel}T00:00:00+08:00`,
      ).toISOString(),
      businessDateLabel,
      venueCode: "MAIN",
      operatorId: mockUser().id,
      status: "OPEN",
      openedAt: now,
      openingCashCents,
      closedAt: null,
      closingCashCents: null,
      expectedCashCents: null,
      cashVarianceCents: null,
      varianceReviewedById: null,
      varianceReviewedAt: null,
      varianceReviewReason: null,
      handoverNote: null,
      closeReason: null,
      pendingSnapshot: null,
      openedById: mockUser().id,
      closedById: null,
      auditTrail: [
        {
          action: "FRONT_DESK_SHIFT_OPENED",
          actorId: mockUser().id,
          createdAt: now,
          openingCashCents,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    saveFrontDeskShifts([shift, ...shifts]);
    return ok(frontDeskShiftView(shift));
  }
  const closeFrontDeskShiftMatch = url.match(
    /^\/operations\/shifts\/([^/]+)\/close$/,
  );
  if (closeFrontDeskShiftMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const shifts = getFrontDeskShifts();
    const shift = shifts.find((item) => item.id === closeFrontDeskShiftMatch[1]);
    if (!shift) throw new Error("前台班次不存在");
    const administrator = hasMockRole("ADMIN", "SUPER_ADMIN");
    const delegated = shift.operatorId !== mockUser().id;
    if (delegated && !administrator) throw new Error("只能关闭自己的前台班次");
    const closingCashCents = integer(data.closingCashCents);
    const handoverNote = text(data.handoverNote);
    const closeReason = text(data.reason) || null;
    if (!Number.isSafeInteger(closingCashCents) || closingCashCents < 0)
      throw new Error("关班现金实点必须为非负整数分");
    if (handoverNote.length < 2 || handoverNote.length > 1000)
      throw new Error("交接备注长度必须为2-1000个字符");
    if (delegated && (!closeReason || closeReason.length < 2))
      throw new Error("管理员代关班次必须填写原因");
    if (closeReason && closeReason.length > 300)
      throw new Error("代关原因不能超过300个字符");
    if (shift.status === "CLOSED") {
      if (
        shift.closedById === mockUser().id &&
        Number(shift.closingCashCents) === closingCashCents &&
        shift.handoverNote === handoverNote &&
        (shift.closeReason || null) === closeReason
      )
        return ok(frontDeskShiftView(shift));
      throw new Error("班次已经用另一组关班数据关闭");
    }

    const allOrders = getOrders();
    const operationalOrders = allOrders.filter(
      (order) => order.createdById === shift.operatorId,
    );
    const cashOrders = allOrders.filter(
      (order) =>
        order.paymentChannel === "OFFLINE_CASH" &&
        order.paymentOperatorId === shift.operatorId &&
        ["PAID", "CHECKED_IN", "COMPLETED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
          order.status,
        ) &&
        mockShanghaiBusinessDate(new Date(order.paidAt || order.createdAt)) ===
          shift.businessDateLabel,
    );
    const cashReceiptsCents = cashOrders.reduce(
      (sum, order) => sum + Number(order.paidCents || 0),
      0,
    );
    const cashRefundsCents = cashOrders.reduce(
      (sum, order) =>
        sum +
        (order.refunds || [])
          .filter(
            (refund: any) =>
              refund.status === "SUCCEEDED" &&
              mockShanghaiBusinessDate(
                new Date(refund.completedAt || refund.requestedAt),
              ) === shift.businessDateLabel,
          )
          .reduce(
            (refundSum: number, refund: any) =>
              refundSum + Number(refund.amountCents || 0),
            0,
          ),
      0,
    );
    const expectedCashCents =
      Number(shift.openingCashCents) + cashReceiptsCents - cashRefundsCents;
    if (expectedCashCents < 0)
      throw new Error("现金退款超过备用金与现金收款，请先由财务核对异常");
    const pendingOrders = operationalOrders.filter((order) =>
      ["PENDING", "PAID", "REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(
        order.status,
      ),
    );
    const pendingRefunds = allOrders.flatMap((order) =>
      (order.refunds || [])
        .filter((refund: any) =>
          (order.createdById === shift.operatorId ||
            refund.requestedById === shift.operatorId) &&
          ["REQUESTED", "APPROVED", "PROCESSING", "FAILED"].includes(
            refund.status,
          ),
        )
        .map((refund: any) => ({ ...refund, orderId: order.id })),
    );
    const cashVarianceCents = closingCashCents - expectedCashCents;
    const now = new Date().toISOString();
    const exceptions = [
      ...(pendingRefunds.length
        ? [{ kind: "PENDING_REFUNDS", count: pendingRefunds.length }]
        : []),
      ...(cashVarianceCents
        ? [{ kind: "CASH_VARIANCE", amountCents: cashVarianceCents }]
        : []),
    ];
    Object.assign(shift, {
      status: "CLOSED",
      closedAt: now,
      closingCashCents,
      expectedCashCents,
      cashVarianceCents,
      handoverNote,
      closeReason,
      pendingSnapshot: {
        generatedAt: now,
        businessDate: shift.businessDateLabel,
        venueCode: "MAIN",
        operatorId: shift.operatorId,
        cash: {
          openingCashCents: shift.openingCashCents,
          cashReceiptsCents,
          cashRefundsCents,
          expectedCashCents,
        },
        pendingOrders: { count: pendingOrders.length, items: pendingOrders },
        pendingRefunds: {
          count: pendingRefunds.length,
          items: pendingRefunds,
        },
        pendingPayments: { count: 0 },
        exceptions,
      },
      closedById: mockUser().id,
      auditTrail: [
        ...(shift.auditTrail || []),
        {
          action: "FRONT_DESK_SHIFT_CLOSED",
          actorId: mockUser().id,
          createdAt: now,
          reason: delegated ? closeReason : handoverNote,
          closingCashCents,
          expectedCashCents,
          cashVarianceCents,
        },
      ],
      updatedAt: now,
    });
    saveFrontDeskShifts(shifts);
    return ok(frontDeskShiftView(shift));
  }
  const reviewFrontDeskVarianceMatch = url.match(
    /^\/operations\/shifts\/([^/]+)\/review-variance$/,
  );
  if (reviewFrontDeskVarianceMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const shifts = getFrontDeskShifts();
    const shift = shifts.find(
      (item) => item.id === reviewFrontDeskVarianceMatch[1],
    );
    if (!shift) throw new Error("前台班次不存在");
    if (shift.status !== "CLOSED")
      throw new Error("班次尚未关闭，不能复核现金差异");
    const reason = text(data.reason) || null;
    if (reason && (reason.length < 2 || reason.length > 300))
      throw new Error("差异复核原因长度必须为2-300个字符");
    if (shift.varianceReviewedById) {
      if (
        shift.varianceReviewedById === mockUser().id &&
        (shift.varianceReviewReason || null) === reason
      )
        return ok(frontDeskShiftView(shift));
      throw new Error("现金差异已经由其他复核结果处理");
    }
    if (
      shift.operatorId === mockUser().id ||
      shift.closedById === mockUser().id
    )
      throw new Error("班次操作人与关班人不能复核自己的现金差异");
    if (Number(shift.cashVarianceCents || 0) !== 0 && !reason)
      throw new Error("非零现金差异必须填写复核原因");
    const now = new Date().toISOString();
    shift.varianceReviewedById = mockUser().id;
    shift.varianceReviewedAt = now;
    shift.varianceReviewReason = reason;
    shift.auditTrail = [
      ...(shift.auditTrail || []),
      {
        action: "FRONT_DESK_SHIFT_VARIANCE_REVIEWED",
        actorId: mockUser().id,
        reason: reason || "零差异确认",
        createdAt: now,
      },
    ];
    shift.updatedAt = now;
    saveFrontDeskShifts(shifts);
    return ok(frontDeskShiftView(shift));
  }
  const reconciliationGetMatch = url.match(
    /^\/reconciliation\/periods\/(\d{4}-\d{2}-\d{2})$/,
  );
  if (reconciliationGetMatch && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const date = reconciliationGetMatch[1];
    const periods = getReconciliationPeriods();
    const current = periods[date];
    if (current?.status === "LOCKED") return ok(current);
    const blockers = mockReconciliationBlockers(date);
    return ok({
      ...(current || {}),
      id: current?.id,
      businessDate: `${date}T00:00:00+08:00`,
      status: blockers.length ? "REVIEW" : "OPEN",
      totals: reconciliationTotals,
      exceptionCount: blockers.length,
      closedById: null,
      closedAt: null,
      detail: { businessDate: date, timezone: "Asia/Shanghai", blockers },
      blocked: blockers.length > 0,
      blockers,
    });
  }
  const reconciliationCloseMatch = url.match(
    /^\/reconciliation\/periods\/(\d{4}-\d{2}-\d{2})\/close$/,
  );
  if (reconciliationCloseMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const date = reconciliationCloseMatch[1];
    if (new Date(`${date}T24:00:00+08:00`).getTime() > Date.now()) {
      throw new Error("营业日结束后才可关账；当天数据请使用实时日结预览");
    }
    const periods = getReconciliationPeriods();
    const current = periods[date];
    if (current?.status === "LOCKED") return ok(current);
    const now = new Date().toISOString();
    const blockers = mockReconciliationBlockers(date);
    const blocked = blockers.length > 0;
    const next = {
      id: current?.id || `reconciliation-${date}`,
      businessDate: `${date}T00:00:00+08:00`,
      status: blocked ? "REVIEW" : "LOCKED",
      totals: reconciliationTotals,
      exceptionCount: blockers.length,
      closedById: blocked ? null : mockUser().id,
      closedAt: blocked ? null : now,
      detail: {
        businessDate: date,
        timezone: "Asia/Shanghai",
        blockers,
        ...(data?.reason ? { reason: data.reason } : {}),
      },
      blocked,
      blockers,
    };
    periods[date] = next;
    saveReconciliationPeriods(periods);
    return ok(next);
  }
  if (url === "/work-items") {
    const roles = mockRoles();
    if (roles.every((role) => role === "MEMBER")) return ok([]);
    const customerItems = getCustomerLeads()
      .filter(
        (lead) =>
          !["CONVERTED", "LOST", "ARCHIVED"].includes(String(lead.status)),
      )
      .map((lead) => ({
        id: `customer-lead:${lead.id}`,
        kind: "CUSTOMER_LEAD_SLA",
        objectType: "CustomerLead",
        objectId: lead.id,
        status: lead.status,
        priority:
          new Date(String(lead.slaDueAt)).getTime() < Date.now() ? 95 : 65,
        title: `${new Date(String(lead.slaDueAt)).getTime() < Date.now() ? "线索已逾期" : "客户待跟进"} · ${lead.displayName}`,
        description: `${lead.campaign || lead.sourceChannel} · 负责人 ${lead.ownerName || "待认领"}`,
        ownerRoles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
        createdAt: lead.createdAt,
        dueAt: lead.slaDueAt,
        action: `/members/leads/${lead.id}`,
      }));
    const hostItems = getHostApplications()
      .filter((application) => application.status === "APPLIED")
      .map((application) => ({
        id: `host-application:${application.id}`,
        kind: "HOST_APPLICATION_REVIEW",
        objectType: "HostProfile",
        objectId: application.id,
        status: application.status,
        priority: 88,
        title: `主理人申请待审核 · ${(application.user as any)?.displayName || application.userId}`,
        description: "审核会员资质、到店记录与组织能力",
        ownerRoles: ["ADMIN", "SUPER_ADMIN"],
        createdAt: application.appliedAt,
        action: `/games/hosts/${application.userId}/approve`,
      }));
    const accountAdjustmentItems = getAccountAdjustmentRequests()
      .filter(
        (request) =>
          request.status === "REQUESTED" &&
          request.requestedById !== mockUser().id,
      )
      .map((request) => {
        const view = accountAdjustmentView(request);
        const memberName = view.account?.user?.displayName || "会员";
        return {
          id: `account-adjustment:${request.id}`,
          kind: "ACCOUNT_ADJUSTMENT_REVIEW",
          objectType: "AccountAdjustmentRequest",
          objectId: request.id,
          status: request.status,
          priority: 98,
          title: `账户调整待复核 · ${memberName}`,
          description: `${view.account?.type || "账户"} ${Number(request.amount) > 0 ? "+" : ""}${request.amount} · ${request.reason}`,
          ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
          createdAt: request.createdAt,
          amountCents: request.amount,
          action: "/packages/ops/pages/finance/index",
        };
      });
    const trainingCorrectionItems = getTrainingConsumeCorrections()
      .filter((correction) => correction.status === "REQUESTED")
      .map((correction) => {
        const view = trainingCorrectionView(correction);
        const learner =
          view.attendance?.enrollment?.student?.displayName ||
          view.attendance?.enrollment?.buyer?.displayName ||
          "成人学员";
        return {
          id: `training-consume-correction:${correction.id}`,
          kind: "TRAINING_CONSUME_CORRECTION_REVIEW",
          objectType: "TrainingConsumeCorrection",
          objectId: correction.id,
          status: correction.status,
          priority: 92,
          title: `消课冲正待复核 · ${learner}`,
          description: `${view.attendance?.session?.class?.name || "培训课次"} · 学员 ${learner} · 申请人 ${view.requestedBy?.displayName || correction.requestedById} · ${correction.reason}`,
          ownerRoles: ["ADMIN", "SUPER_ADMIN"],
          createdAt: correction.requestedAt,
          action: `/training/consume-corrections/${correction.id}/approve`,
          metadata: {
            recognitionId: correction.recognitionId,
            attendanceId: correction.attendanceId,
            requestedById: correction.requestedById,
          },
        };
      });
    const trainingSettlementItems = hasMockRole(
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    )
      ? getTrainingSettlements()
          .filter((settlement) =>
            ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED"].includes(
              settlement.status,
            ),
          )
          .map((settlement) => ({
            id: `training-settlement:${settlement.id}`,
            kind: "TRAINING_SETTLEMENT",
            objectType: "TrainingSettlement",
            objectId: settlement.id,
            status: settlement.status,
            priority: 75,
            title:
              settlement.status === "DRAFT"
                ? "培训结算草稿待提交"
                : settlement.status === "PENDING_CONFIRMATION"
                  ? "培训结算待复核确认"
                  : "培训结算待入账",
            description: `有效流水 ¥${(Number(settlement.effectiveRevenueCents || 0) / 100).toFixed(2)} · 场馆20% ¥${(Number(settlement.venueContributionCents || 0) / 100).toFixed(2)}`,
            ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
            createdAt: settlement.createdAt,
            dueAt: settlement.periodEnd,
            amountCents: settlement.venueContributionCents,
            action: `/packages/ops/pages/finance/index?focus=training-settlement&id=${settlement.id}`,
          }))
      : [];
    const items = [
      ...customerItems,
      ...hostItems,
      ...accountAdjustmentItems,
      ...trainingCorrectionItems,
      ...trainingSettlementItems,
      {
        id: "refund:mock-1",
        kind: "REFUND_REVIEW",
        objectType: "Refund",
        objectId: "mock-refund-1",
        status: "REQUESTED",
        priority: 100,
        title: "退款待审核 · RF-MOCK-001",
        description: "模拟场地订单，申请金额 ¥68.00",
        ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        amountCents: 6800,
        action: "/orders/refunds/mock-1/approve",
      },
      {
        id: "training:mock-1",
        kind: "TRAINING_ATTENDANCE",
        objectType: "TrainingAttendance",
        objectId: "attendance-1",
        status: "PENDING",
        priority: 80,
        title: "培训点名/消课 · 周三晚进阶班",
        description: "1 名学员待登记出勤或提交消课建议",
        ownerRoles: ["COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date().toISOString(),
        action: "/packages/ops/pages/coach/index",
      },
      {
        id: "event:mock-1",
        kind: "EVENT_SCORE",
        objectType: "EventMatch",
        objectId: "match-1",
        status: "PENDING",
        priority: 70,
        title: "赛事待录比分 · 第2轮",
        description: "瑞士赛有 1 场比分待确认",
        ownerRoles: ["EVENT_MANAGER", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date().toISOString(),
        action: "/packages/ops/pages/event/index",
      },
      {
        id: "settlement:mock-1",
        kind: "ALLIANCE_SETTLEMENT",
        objectType: "AllianceSettlement",
        objectId: "settlement-1",
        status: "DRAFT",
        priority: 50,
        title: "联盟结算草稿 · 山脚咖啡",
        description: "待财务提交商户确认",
        ownerRoles: ["FINANCE", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date().toISOString(),
        action: "/packages/ops/pages/finance/index",
      },
      {
        id: "stock:mock-1",
        kind: "LOW_STOCK",
        objectType: "InventoryItem",
        objectId: "mock-stock-1",
        status: "OPEN",
        priority: 60,
        title: "库存低于安全线 · 羽毛球",
        description: "当前 4 件，安全线 10 件",
        ownerRoles: ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"],
        createdAt: new Date().toISOString(),
        action: "/inventory/mock-stock-1",
      },
    ];
    return ok(
      items.filter((item) =>
        item.ownerRoles.some((role) => roles.includes(role as AppRole)),
      ),
    );
  }
  if (url === "/venues/closures" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    if (status && !["ACTIVE", "CANCELLED"].includes(status))
      throw new Error("封场状态无效");
    const from = data.from ? new Date(String(data.from)) : null;
    const to = data.to ? new Date(String(data.to)) : null;
    if (from && Number.isNaN(from.getTime())) throw new Error("查询开始时间无效");
    if (to && Number.isNaN(to.getTime())) throw new Error("查询结束时间无效");
    if (from && to && from >= to) throw new Error("查询结束时间必须晚于开始时间");
    const courtId = text(data.courtId);
    return ok(
      getVenueClosures()
        .filter((closure) => !courtId || closure.courtId === courtId)
        .filter((closure) => !status || closure.status === status)
        .filter((closure) => !to || new Date(closure.startsAt) < to)
        .filter((closure) => !from || new Date(closure.endsAt) > from)
        .sort((left, right) =>
          new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
        ),
    );
  }
  if (url === "/venues/closures" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const courtId = text(data.courtId);
    const startsAt = new Date(String(data.startsAt || ""));
    const endsAt = new Date(String(data.endsAt || ""));
    const reason = text(data.reason);
    const creationIdempotencyKey = requireIdempotencyKey(
      data.creationIdempotencyKey,
      "封场创建幂等键",
    );
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
      throw new Error("封场开始或结束时间无效");
    if (endsAt <= startsAt) throw new Error("封场结束时间必须晚于开始时间");
    if (endsAt <= new Date()) throw new Error("不能创建已经结束的封场计划");
    if (reason.length < 2 || reason.length > 300)
      throw new Error("封场原因长度必须为2-300个字符");

    const closures = getVenueClosures();
    const replay = closures.find(
      (closure) => closure.creationIdempotencyKey === creationIdempotencyKey,
    );
    if (replay) {
      if (
        replay.createdById !== mockUser().id ||
        replay.courtId !== courtId ||
        new Date(replay.startsAt).getTime() !== startsAt.getTime() ||
        new Date(replay.endsAt).getTime() !== endsAt.getTime() ||
        replay.reason !== reason
      ) {
        throw new Error("封场幂等键已用于不同命令");
      }
      return ok(replay);
    }

    const date = mockShanghaiBusinessDate(startsAt);
    const calendar = availability(date);
    const court = calendar.courts.find((item: any) => item.id === courtId);
    if (!court) throw new Error("场地不存在");
    const overlappingClosure = closures.find(
      (closure) =>
        closure.courtId === courtId &&
        closure.status === "ACTIVE" &&
        new Date(closure.startsAt).getTime() < endsAt.getTime() &&
        new Date(closure.endsAt).getTime() > startsAt.getTime(),
    );
    if (overlappingClosure)
      throw new Error(`该场地已有重叠封场：${overlappingClosure.reason}`);
    const blockingBookings = (calendar.bookings || []).filter(
      (booking: any) =>
        booking.courtId === courtId &&
        booking.status !== "CANCELLED" &&
        new Date(booking.endsAt).getTime() > Date.now() &&
        new Date(booking.startsAt).getTime() < endsAt.getTime() &&
        new Date(booking.endsAt).getTime() > startsAt.getTime(),
    );
    if (blockingBookings.length) {
      const details = blockingBookings
        .slice(0, 20)
        .map((booking: any) =>
          `${booking.startsAt}~${booking.endsAt}[${booking.orderId || booking.id || "fixture"}]`,
        )
        .join("；");
      throw new Error(
        `封场范围内已有 ${blockingBookings.length} 笔未取消预约，需先逐笔处理，系统不会自动取消或退款：${details}`,
      );
    }
    const now = new Date().toISOString();
    const created = {
      id: newId("court-closure"),
      courtId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reason,
      status: "ACTIVE",
      creationIdempotencyKey,
      createdById: mockUser().id,
      cancelledById: null,
      cancelledAt: null,
      cancelReason: null,
      court: { id: court.id, code: court.code, name: court.name, enabled: court.enabled },
      createdBy: { id: mockUser().id, displayName: mockUser().displayName },
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
      auditTrail: [{ action: "COURT_CLOSURE_CREATED", actorId: mockUser().id, createdAt: now }],
    };
    saveVenueClosures([created, ...closures]);
    return ok(created);
  }
  const cancelVenueClosureMatch = url.match(
    /^\/venues\/closures\/([^/]+)\/cancel$/,
  );
  if (cancelVenueClosureMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const reason = text(data.reason);
    if (reason.length < 2 || reason.length > 300)
      throw new Error("取消原因长度必须为2-300个字符");
    const closures = getVenueClosures();
    const closure = closures.find(
      (item) => item.id === cancelVenueClosureMatch[1],
    );
    if (!closure) throw new Error("封场记录不存在");
    if (closure.status === "CANCELLED") return ok(closure);
    const now = new Date().toISOString();
    closure.status = "CANCELLED";
    closure.cancelledById = mockUser().id;
    closure.cancelledAt = now;
    closure.cancelReason = reason;
    closure.cancelledBy = {
      id: mockUser().id,
      displayName: mockUser().displayName,
    };
    closure.updatedAt = now;
    closure.auditTrail = [
      ...(closure.auditTrail || []),
      {
        action: "COURT_CLOSURE_CANCELLED",
        actorId: mockUser().id,
        reason,
        createdAt: now,
      },
    ];
    saveVenueClosures(closures);
    return ok(closure);
  }
  if (url === "/venues/availability") {
    const date = text(data.date || new Date().toISOString().slice(0, 10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式无效");
    return ok(availability(date));
  }
  if (url === "/venues/bookings" && method === "POST") {
    const date = text(data.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式无效");
    const assisted = hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const requestedMemberId = text(data.memberId);
    let targetMember: MockVenueMember;
    if (assisted) {
      if (!requestedMemberId)
        throw new Error("前台代客订场必须先选择会员");
      const activeMember = MOCK_ACTIVE_MEMBERS.find(
        (member) => member.id === requestedMemberId && member.status === "ACTIVE",
      );
      if (!activeMember)
        throw new Error("所选会员不存在、未建档或已停用");
      targetMember = activeMember;
    } else {
      requireMockRole("MEMBER");
      if (requestedMemberId && requestedMemberId !== mockUser().id)
        throw new Error("会员只能为本人预订场地");
      targetMember = {
        id: mockUser().id,
        displayName: mockUser().displayName,
        memberProfile: mockUser().memberProfile,
      };
    }
    const creation = beginMockOrderCreation(
      data.creationIdempotencyKey,
      {
        kind: "VENUE_BOOKING",
        memberId: targetMember.id,
        date,
        courtId: text(data.courtId),
        slotId: text(data.slotId),
        sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
        couponCode: text(data.couponCode) || null,
      },
      targetMember.id,
    );
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const assistedShift = assisted ? requireMockOpenFrontDeskShift() : null;
    const calendar = availability(date);
    const court = calendar.courts.find((item: any) => item.id === data.courtId);
    const slot = calendar.slots.find((item: any) => item.id === data.slotId);
    if (!court || !slot || !court.enabled) throw new Error("场地或时段不存在");
    if (court.usage === "MAINTENANCE") throw new Error("场地维护中");
    if (court.usage === "TRAINING")
      throw new Error("该场地为培训专用场，不能零售预订");
    const startsAt = startsAtDate(date, Number(slot.startMinutes));
    const endsAt = startsAtDate(date, Number(slot.endMinutes));
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      startsAt <= new Date()
    ) {
      throw new Error("不能预订已开始的时段");
    }
    const closure = (calendar.closures || []).find(
      (item: any) =>
        item.courtId === court.id &&
        item.status === "ACTIVE" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (closure) throw new Error(`该时段已封场：${closure.reason}`);
    const overlap = (calendar.bookings || []).some(
      (booking: any) =>
        booking.courtId === court.id &&
        booking.status !== "CANCELLED" &&
        !(booking.status === "HELD" && isExpired(booking.holdExpiresAt)) &&
        new Date(booking.startsAt).getTime() < endsAt.getTime() &&
        new Date(booking.endsAt).getTime() > startsAt.getTime(),
    );
    if (overlap) throw new Error("该场地时段刚刚被预订");

    let payableCents = Number(slot.price?.priceCents || 0);
    let discountCents = 0;
    let couponId: string | undefined;
    if (data.couponCode) {
      const coupon = getCoupons().find((item) => item.code === data.couponCode);
      const holderId = targetMember.id;
      if (
        !coupon ||
        coupon.holderId !== holderId ||
        coupon.status !== "CLAIMED" ||
        isExpired(coupon.expiresAt)
      ) {
        throw new Error("优惠券无效、已过期或不属于当前会员");
      }
      const template = couponTemplate(coupon);
      if (
        template?.code?.startsWith("NEWCOMER") &&
        slot.price?.newcomerPriceCents !== null &&
        slot.price?.newcomerPriceCents !== undefined
      ) {
        payableCents = Number(slot.price.newcomerPriceCents);
      } else {
        payableCents = Math.max(
          0,
          payableCents - Number(template?.faceValueCents || 0),
        );
      }
      discountCents = Number(slot.price?.priceCents || 0) - payableCents;
      couponId = coupon.id;
    }
    const createdAt = new Date().toISOString();
    const orderId = newId("order");
    const booking = {
      id: newId("booking"),
      orderId,
      courtId: court.id,
      memberId: targetMember.id,
      status: "HELD",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      holdExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      usage: "RETAIL",
    };
    const order = {
      id: orderId,
      orderNo: newOrderNo(),
      title: `${court.name} ${slot.label} 场地预订`,
      status: "PENDING",
      businessType: "VENUE",
      payableCents,
      listAmountCents: Number(slot.price?.priceCents || payableCents),
      discountCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt,
      memberId: targetMember.id,
      createdById: mockUser().id,
      member: {
        id: targetMember.id,
        displayName: targetMember.displayName,
        phone: targetMember.phone,
      },
      bookings: [booking],
      parameterSnapshot: {
        courtId: court.id,
        slotId: slot.id,
        date,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        couponId,
        targetMemberId: targetMember.id,
        createdById: mockUser().id,
        operatorAssisted: assisted,
        frontDeskShiftId: assistedShift?.id || null,
        adminEmergencyBypass: assisted && !assistedShift,
      },
    };
    saveVenueBookings([booking, ...getVenueBookings()]);
    saveOrders([order, ...getOrders()]);
    return finishMockOrderCreation(creation, order);
  }
  if (url === "/orders") {
    const mine = getOrders().filter(
      (order) => order.memberId === mockUser().id || !order.memberId,
    );
    return ok({ items: mine, total: mine.length });
  }
  if (url === "/orders/admin/all") {
    requireMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    return ok({ items: getOrders(), total: getOrders().length });
  }
  const orderDetailMatch = url.match(/^\/orders\/([^/]+)$/);
  if (orderDetailMatch && method === "GET") {
    const order = getOrders().find((item) => item.id === orderDetailMatch[1]);
    if (!order) throw new Error("订单不存在");
    if (
      order.memberId &&
      order.memberId !== mockUser().id &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN")
    )
      throw new Error("无权查看该订单");
    return ok(order);
  }
  const payMatch = url.match(/^\/orders\/([^/]+)\/pay$/);
  if (payMatch && method === "POST") {
    const orders = getOrders();
    const order = orders.find((item) => item.id === payMatch[1]);
    if (!order) throw new Error("订单不存在");
    const channel = text(data.channel);
    if (
      ![
        "WECHAT",
        "OFFLINE_CASH",
        "CASH_PRINCIPAL",
        "GIFT_BALANCE",
        "BADMINTON_COIN",
      ].includes(channel)
    )
      throw new Error("支付渠道无效");
    const selfPayment = !order.memberId || order.memberId === mockUser().id;
    if (selfPayment && channel === "OFFLINE_CASH")
      throw new Error("会员本人不能使用线下现金渠道");
    if (!selfPayment) {
      if (channel !== "OFFLINE_CASH") {
        if (["CASH_PRINCIPAL", "GIFT_BALANCE", "BADMINTON_COIN"].includes(channel))
          throw new Error("账户余额只能由会员本人支付，员工不得代扣");
        throw new Error("员工代客收款仅支持线下现金渠道");
      }
      if (!hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN"))
        throw new Error("仅前台或管理员可代收线下现金");
    }
    const paymentKey = requireIdempotencyKey(data.idempotencyKey, "支付幂等键");
    const existingPayment = orders.find(
      (item) => item.paymentIdempotencyKey === paymentKey,
    );
    if (
      existingPayment &&
      (existingPayment.id !== order.id || existingPayment.paymentChannel !== channel)
    )
      throw new Error("支付幂等键已用于其他订单或支付渠道");
    if (
      existingPayment &&
      existingPayment.paymentOperatorId !== mockUser().id
    )
      throw new Error("支付请求只能由原操作人重试");
    if (existingPayment && existingPayment.id === order.id)
      return ok({
        id: order.paymentId || `payment-${order.id}`,
        status: "SUCCESS",
        idempotent: true,
      });
    if (order.status !== "PENDING")
      throw new Error(`订单当前状态为 ${order.status}，不能支付`);
    const paymentShift =
      channel === "OFFLINE_CASH" ? requireMockOpenFrontDeskShift() : null;
    let trainingEnrollmentToActivate: any;
    if (order.businessType === "TRAINING") {
      const enrollments = getEnrollments();
      trainingEnrollmentToActivate = enrollments.find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!trainingEnrollmentToActivate)
        throw new Error("培训订单缺少报名记录");
      if (trainingEnrollmentToActivate.status !== "PENDING_PAYMENT")
        throw new Error("培训报名状态不可支付");
      if (trainingEnrollmentToActivate.classId) {
        const selectedClass = getTrainingProducts()
          .flatMap((item) => item.classes || [])
          .find(
            (item: any) => item.id === trainingEnrollmentToActivate.classId,
          );
        if (!selectedClass) throw new Error("培训班不存在或已停用");
        if (
          !trainingEnrollmentToActivate.seatReservedUntil ||
          isExpired(trainingEnrollmentToActivate.seatReservedUntil)
        ) {
          throw new Error("培训班名额保留已过期，请重新报名");
        }
        const occupiedSeats = enrollments.filter(
          (item) =>
            item.id !== trainingEnrollmentToActivate.id &&
            item.classId === trainingEnrollmentToActivate.classId &&
            ["ACTIVE", "PARTIALLY_REFUNDED"].includes(item.status),
        ).length;
        if (occupiedSeats >= Number(selectedClass.capacity || 0))
          throw new Error("培训班名额已满，支付未完成");
      }
    }
    order.status = "PAID";
    order.paidCents = order.payableCents;
    order.paidAt = new Date().toISOString();
    order.paymentId = order.paymentId || `payment-${Date.now()}`;
    order.paymentIdempotencyKey = paymentKey;
    order.paymentChannel = channel;
    order.paymentOperatorId = mockUser().id;
    order.paymentFrontDeskShiftId = paymentShift?.id || null;
    order.paymentAdminEmergencyBypass =
      channel === "OFFLINE_CASH" && !paymentShift;
    // Payment finalization advances the business aggregate as well as the
    // order.  Without this bridge a freshly paid game/event registration
    // would remain REGISTERED forever and could not be checked in.
    const snapshot = order.parameterSnapshot || {};
    if (order.businessType === "VENUE") {
      const bookings = getVenueBookings();
      const changed = bookings.map((booking) =>
        booking.orderId === order.id && booking.status === "HELD"
          ? { ...booking, status: "CONFIRMED", holdExpiresAt: null }
          : booking,
      );
      saveVenueBookings(changed);
      order.bookings = (order.bookings || []).map((booking: any) => ({
        ...booking,
        status: booking.status === "HELD" ? "CONFIRMED" : booking.status,
        holdExpiresAt: null,
      }));
    }
    if (order.businessType === "GAME") {
      const gameId =
        order.gameId || snapshot.gameId || order.items?.[0]?.itemId;
      if (gameId) {
        const games = getGames();
        const game = games.find((item) => item.id === gameId);
        const registration = game?.registrations?.find(
          (item: any) =>
            item.orderId === order.id ||
            (item.userId === order.memberId && item.status === "REGISTERED"),
        );
        if (registration) registration.status = "PAID";
        if (game) saveGames(games);
      }
    }
    if (order.businessType === "EVENT") {
      const eventId =
        order.eventId || snapshot.eventId || order.items?.[0]?.itemId;
      const teamId = order.eventTeamId || order.eventTeam?.id;
      if (eventId) {
        const detail = getEventDetail(eventId);
        const team = (detail.teams || []).find((item: any) =>
          teamId
            ? item.id === teamId
            : item.orderId === order.id ||
              (item.captainId === order.memberId &&
                item.status === "REGISTERED"),
        );
        if (team) team.status = "PAID";
        saveEventDetail(detail);
      }
    }
    if (order.businessType === "TRAINING") {
      const enrollments = getEnrollments();
      const enrollment = enrollments.find(
        (item) => item.id === trainingEnrollmentToActivate?.id,
      );
      if (enrollment) {
        enrollment.status = "ACTIVE";
        enrollment.prepaidBalanceCents = Number(
          enrollment.totalAmountCents || enrollment.prepaidBalanceCents || 0,
        );
        enrollment.seatReservedUntil = null;
        enrollment.paidAt = order.paidAt;
      }
      saveEnrollments(enrollments);
    }
    saveOrders(orders);
    return ok({ id: order.paymentId, status: "SUCCESS" });
  }
  const refundMatch = url.match(/^\/orders\/([^/]+)\/refunds$/);
  if (refundMatch && method === "POST") {
    const orders = getOrders();
    const order = orders.find((item) => item.id === refundMatch[1]);
    if (!order) throw new Error("订单不存在");
    const assistedRefund = Boolean(
      order.memberId && order.memberId !== mockUser().id,
    );
    if (
      assistedRefund &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN")
    )
      throw new Error("仅会员本人、前台或管理员可申请退款");
    const amountCents = Number(
      data.amountCents ??
        Number(order.paidCents || 0) - Number(order.refundedCents || 0),
    );
    if (!Number.isInteger(amountCents) || amountCents <= 0)
      throw new Error("退款金额必须为正整数");
    const reason = String(data.reason || "前台服务申请退款").trim();
    if (reason.length < 2) throw new Error("退款原因至少需要2个字");
    const idempotency = data.idempotencyKey
      ? requireIdempotencyKey(data.idempotencyKey, "退款幂等键")
      : `refund:${order.id}:${amountCents}:${reason}`;
    const existing = orders
      .flatMap((item) => item.refunds || [])
      .find((refund: any) => refund.idempotencyKey === idempotency);
    if (existing) {
      if (existing.orderId && existing.orderId !== order.id)
        throw new Error("幂等键已用于其他订单");
      if (
        Number(existing.amountCents) !== amountCents ||
        existing.reason !== reason
      )
        throw new Error("退款幂等键已用于不同的退款内容");
      return ok(existing);
    }
    if (
      !["PAID", "CHECKED_IN", "COMPLETED", "PARTIALLY_REFUNDED"].includes(
        order.status,
      )
    )
      throw new Error("订单当前状态不可退款");
    if (
      amountCents + Number(order.refundedCents || 0) >
      Number(order.paidCents || 0)
    )
      throw new Error("退款金额超过可退余额");
    const pendingAmount = (order.refunds || [])
      .filter((item: any) =>
        ["REQUESTED", "APPROVED", "PROCESSING"].includes(item.status),
      )
      .reduce(
        (sum: number, item: any) => sum + Number(item.amountCents || 0),
        0,
      );
    if (
      amountCents + Number(order.refundedCents || 0) + pendingAmount >
      Number(order.paidCents || 0)
    )
      throw new Error("退款金额超过剩余可退金额（含待审批退款）");
    if (order.businessType === "TRAINING") {
      const enrollment = getEnrollments().find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!enrollment) throw new Error("培训订单缺少报名与预收账本");
      if (
        amountCents >
        Number(enrollment.prepaidBalanceCents || 0) - pendingAmount
      ) {
        throw new Error(
          "退款金额超过未消课预收余额；已消课收入须先走消课冲正流程",
        );
      }
    }
    const refundShift = assistedRefund ? requireMockOpenFrontDeskShift() : null;
    const refund = {
      id: newId("refund"),
      orderId: order.id,
      refundNo: `RF${Date.now()}`,
      idempotencyKey: idempotency,
      status: "REQUESTED",
      amountCents,
      reason,
      requestedById: mockUser().id,
      requestedAt: new Date().toISOString(),
      frontDeskShiftId: refundShift?.id || null,
      adminEmergencyBypass: assistedRefund && !refundShift,
    };
    order.status = "REFUND_PENDING";
    order.refunds = [...(order.refunds || []), refund];
    saveOrders(orders);
    return ok(refund);
  }
  const approveRefundMatch = url.match(/^\/orders\/refunds\/([^/]+)\/approve$/);
  if (approveRefundMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) =>
      item.refunds?.some((refund: any) => refund.id === approveRefundMatch[1]),
    );
    const refund = order?.refunds?.find(
      (item: any) => item.id === approveRefundMatch[1],
    );
    if (!order || !refund) throw new Error("退款申请不存在");
    if (refund.requestedById === mockUser().id)
      throw new Error("退款申请人与审批人不能是同一账号");
    if (refund.status === "SUCCEEDED") return ok(refund);
    if (refund.status !== "REQUESTED") throw new Error("当前退款状态不能批准");
    let trainingEnrollment: any;
    if (order.businessType === "TRAINING") {
      trainingEnrollment = getEnrollments().find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!trainingEnrollment) throw new Error("培训订单缺少报名与预收账本");
      if (
        Number(refund.amountCents || 0) >
        Number(trainingEnrollment.prepaidBalanceCents || 0)
      ) {
        throw new Error(
          "当前未消课预收余额不足；请先驳回本申请或完成消课冲正后重提",
        );
      }
    }
    refund.status = "SUCCEEDED";
    refund.completedAt = new Date().toISOString();
    order.refundedCents =
      Number(order.refundedCents || 0) + Number(refund.amountCents || 0);
    order.status =
      order.refundedCents >= Number(order.paidCents || 0)
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";
    if (trainingEnrollment) {
      trainingEnrollment.refundedCents =
        Number(trainingEnrollment.refundedCents || 0) +
        Number(refund.amountCents || 0);
      trainingEnrollment.prepaidBalanceCents = Math.max(
        0,
        Number(trainingEnrollment.prepaidBalanceCents || 0) -
          Number(refund.amountCents || 0),
      );
      trainingEnrollment.status =
        order.status === "REFUNDED" ? "REFUNDED" : "PARTIALLY_REFUNDED";
      saveEnrollments(
        getEnrollments().map((item) =>
          item.id === trainingEnrollment.id ? trainingEnrollment : item,
        ),
      );
    }
    let ordersAfterRefund = orders;
    if (order.status === "REFUNDED" && order.businessType === "GAME") {
      const games = getGames();
      const game = games.find(
        (item) => item.id === (order.gameId || order.parameterSnapshot?.gameId),
      );
      const registration = game?.registrations?.find(
        (item: any) => item.orderId === order.id,
      );
      if (registration) registration.status = "REFUNDED";
      if (game) {
        const promoted = promoteMockGameWaitlist(game);
        saveGames(games);
        if (promoted) ordersAfterRefund = [promoted.order, ...orders];
      }
    }
    saveOrders(ordersAfterRefund);
    return ok(refund);
  }
  const rejectRefundMatch = url.match(/^\/orders\/refunds\/([^/]+)\/reject$/);
  if (rejectRefundMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) =>
      item.refunds?.some((refund: any) => refund.id === rejectRefundMatch[1]),
    );
    const refund = order?.refunds?.find(
      (item: any) => item.id === rejectRefundMatch[1],
    );
    if (!order || !refund) throw new Error("退款申请不存在");
    if (refund.requestedById === mockUser().id)
      throw new Error("退款申请人与审批人不能是同一账号");
    if (refund.status === "REJECTED") return ok(refund);
    if (!["REQUESTED", "REFUND_PENDING"].includes(refund.status))
      throw new Error("当前退款状态不能驳回");
    refund.status = "REJECTED";
    const rejectionReason = text(data.reason) || "审核未通过";
    if (rejectionReason.length < 2) throw new Error("驳回原因至少需要2个字");
    refund.rejectionReason = rejectionReason;
    const hasPending = (order.refunds || []).some((item: any) =>
      ["REQUESTED", "APPROVED", "PROCESSING"].includes(item.status),
    );
    order.status = hasPending
      ? "REFUND_PENDING"
      : Number(order.refundedCents || 0) > 0
        ? "PARTIALLY_REFUNDED"
        : "PAID";
    saveOrders(orders);
    return ok(refund);
  }
  if (url === "/games" && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const title = text(data.title);
    if (!title) throw new Error("球局标题不能为空");
    const startsAt = new Date(String(data.startsAt || ""));
    const endsAt = new Date(String(data.endsAt || ""));
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new Error("球局时间设置无效");
    }
    if (startsAt <= new Date()) throw new Error("球局开始时间必须晚于当前时间");
    const capacity = integer(data.capacity) ? Number(data.capacity) : NaN;
    if (!validGameCapacity(capacity)) {
      throw new Error(
        `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
      );
    }
    const feeCents = integer(data.feeCents) ? Number(data.feeCents) : 0;
    if (feeCents < 0) throw new Error("球局费用必须为非负整数");
    const courtIds = Array.isArray(data.courtIds)
      ? data.courtIds.map((id: unknown) => text(id)).filter(Boolean)
      : [];
    if (new Set(courtIds).size !== courtIds.length)
      throw new Error("场地不能重复");
    if (!courtIds.length) throw new Error("至少选择一个场地");
    const calendar = availability(mockShanghaiBusinessDate(startsAt));
    const selectedCourts = calendar.courts.filter((court: any) =>
      courtIds.includes(court.id),
    );
    if (selectedCourts.length !== courtIds.length)
      throw new Error("部分场地不存在或已停用");
    if (
      selectedCourts.some((court: any) =>
        ["MAINTENANCE", "TRAINING"].includes(court.usage),
      )
    )
      throw new Error("球局不能使用维护场或培训专用场");
    const closure = (calendar.closures || []).find(
      (item: any) =>
        courtIds.includes(item.courtId) &&
        item.status === "ACTIVE" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (closure) throw new Error(`所选场地时段已封场：${closure.reason}`);
    const occupied = (calendar.bookings || []).find(
      (item: any) =>
        courtIds.includes(item.courtId) &&
        item.status !== "CANCELLED" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (occupied) throw new Error("所选场地时段已被占用");
    const created = {
      ...data,
      id: newId("game"),
      title,
      status: "DRAFT",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity,
      feeCents,
      hostId: mockUser().id,
      host: { displayName: mockUser().displayName },
      registrations: [],
      _count: { registrations: 0 },
      courtIds,
    };
    saveGames([created, ...getGames()]);
    return ok(created);
  }
  if (url === "/games") return ok(getGames());
  if (url === "/games/hosted/me") {
    const user = mockUser();
    return ok(
      getGames().filter(
        (game) =>
          game.hostId === user.id ||
          (!game.hostId && game.host?.displayName === user.displayName),
      ),
    );
  }
  if (url === "/games/hosts/apply" && method === "POST") {
    requireMockRole("MEMBER");
    const applications = getHostApplications();
    const existing = applications.find((item) => item.userId === mockUser().id);
    if (existing?.status === "APPROVED") throw new Error("已经是球局主理人");
    if (existing?.status === "APPLIED") {
      // 首次读取可能来自动态种子；落盘后重放必须返回同一份申请。
      saveHostApplications(applications);
      return ok(existing);
    }
    const profile = existing || {
      id: newId("host-profile"),
      userId: mockUser().id,
      user: { id: mockUser().id, displayName: mockUser().displayName },
    };
    Object.assign(profile, {
      status: "APPLIED",
      appliedAt: new Date().toISOString(),
      suspendedReason: null,
    });
    if (!existing) applications.push(profile);
    saveHostApplications(applications);
    return ok(profile);
  }
  if (url === "/games/host-applications" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    return ok(
      getHostApplications().filter((item) => item.status === "APPLIED"),
    );
  }
  const reviewHostMatch = url.match(
    /^\/games\/hosts\/([^/]+)\/(approve|reject)$/,
  );
  if (reviewHostMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const [, userId, action] = reviewHostMatch;
    const applications = getHostApplications();
    const profile = applications.find((item) => item.userId === userId);
    if (!profile) throw new Error("主理人申请不存在");
    if (profile.status !== "APPLIED") throw new Error("只有待审批申请可以处理");
    if (action === "reject" && text(data.reason).length < 2)
      throw new Error("驳回原因不能为空");
    profile.status = action === "approve" ? "APPROVED" : "REJECTED";
    profile.approvedAt = action === "approve" ? new Date().toISOString() : null;
    profile.suspendedReason = action === "reject" ? text(data.reason) : null;
    saveHostApplications(applications);
    return ok(profile);
  }
  const publishGameMatch = url.match(/^\/games\/([^/]+)\/publish$/);
  if (publishGameMatch && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const list = getGames();
    const game = list.find((item) => item.id === publishGameMatch[1]);
    if (!game) throw new Error("球局不存在");
    const hostOnly = hasMockRole("HOST") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (hostOnly && game.hostId && game.hostId !== mockUser().id)
      throw new Error("只有本局主理人或管理员可操作该球局");
    if (game.status === "OPEN") return ok(game);
    if (
      ["FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(game.status)
    ) {
      throw new Error(`球局当前状态为 ${game.status}，不能发布`);
    }
    if (game.startsAt && new Date(game.startsAt) <= new Date())
      throw new Error("球局时间已过期，不能发布");
    if (!validGameCapacity(game.capacity)) {
      throw new Error(
        `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
      );
    }
    game.status = "OPEN";
    saveGames(list);
    return ok(game);
  }
  const registerGameMatch = url.match(/^\/games\/([^/]+)\/register$/);
  if (registerGameMatch && method === "POST") {
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "GAME_REGISTRATION",
      gameId: registerGameMatch[1],
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
    });
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const list = getGames();
    const game = list.find((item) => item.id === registerGameMatch[1]);
    if (!game || !["OPEN", "FULL"].includes(String(game.status)))
      throw new Error("球局不在报名中");
    if (!validGameCapacity(game.capacity)) {
      throw new Error(
        `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
      );
    }
    const userId = mockUser().id;
    const registrations = game.registrations || [];
    const activeRegistrations = registrations.filter((item: any) =>
      activeRegistrationStatuses.includes(item.status),
    );
    const waitlisted = registrations.filter(
      (item: any) => item.status === "WAITLISTED",
    );
    const existing = registrations.find((item: any) => item.userId === userId);
    if (
      existing &&
      [...activeRegistrationStatuses, "WAITLISTED"].includes(existing.status)
    ) {
      throw new Error("已经报名该球局或正在候补");
    }
    // Preserve FIFO when a seat has opened but an older waiting member has not
    // yet been promoted by the operations workflow.
    if (
      activeRegistrations.length >= gameCapacity(game) ||
      waitlisted.length > 0
    ) {
      const registration = existing
        ? {
            ...existing,
            status: "WAITLISTED",
            orderId: undefined,
            checkedInAt: undefined,
          }
        : {
            id: newId("reg"),
            userId,
            displayName: mockUser().displayName,
            status: "WAITLISTED",
          };
      game.registrations = existing
        ? registrations.map((item: any) =>
            item.id === existing.id ? registration : item,
          )
        : [registration, ...registrations];
      game._count = {
        ...(game._count || {}),
        registrations: activeRegistrations.length,
      };
      game.status = "FULL";
      game.waitlistCount = waitlisted.length + 1;
      saveGames(list);
      return finishMockOrderCreation(creation, {
        registration,
        waitlistPosition: waitlisted.length + 1,
        status: "WAITLISTED",
      });
    }
    const orderId = newId("order");
    const registration = existing
      ? { ...existing, status: "REGISTERED", orderId, checkedInAt: undefined }
      : {
          id: newId("reg"),
          userId,
          displayName: mockUser().displayName,
          status: "REGISTERED",
          orderId,
        };
    game.registrations = existing
      ? registrations.map((item: any) =>
          item.id === existing.id ? registration : item,
        )
      : [...registrations, registration];
    game._count = {
      ...(game._count || {}),
      registrations: activeRegistrations.length + 1,
    };
    if (game._count.registrations >= gameCapacity(game)) game.status = "FULL";
    const createdOrder = {
      id: orderId,
      orderNo: newOrderNo("GO"),
      title: game.title,
      status: "PENDING",
      businessType: "GAME",
      gameId: game.id,
      payableCents: Number(game.feeCents || 0),
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: userId,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: { gameId: game.id, hostId: game.hostId },
    };
    saveGames(list);
    const orders = getOrders();
    saveOrders([createdOrder, ...orders]);
    return finishMockOrderCreation(creation, createdOrder);
  }
  const promoteGameWaitlistMatch = url.match(
    /^\/games\/([^/]+)\/promote-waitlist$/,
  );
  if (promoteGameWaitlistMatch && method === "POST") {
    requireMockRole("HOST", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const games = getGames();
    const game = games.find((item) => item.id === promoteGameWaitlistMatch[1]);
    if (!game) throw new Error("球局不存在");
    const hostOnly = hasMockRole("HOST") && !hasMockRole(
      "FRONT_DESK",
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    );
    if (hostOnly && game.hostId && game.hostId !== mockUser().id)
      throw new Error("只有本局主理人或管理员可操作该球局");
    const promoted = promoteMockGameWaitlist(game);
    saveGames(games);
    if (!promoted) return ok(null);
    saveOrders([promoted.order, ...getOrders()]);
    return ok(promoted);
  }
  if (url === "/games/rewards/grant-matured" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    return ok({ processed: 0, results: [] });
  }
  const completeGameMatch = url.match(/^\/games\/([^/]+)\/complete$/);
  if (completeGameMatch && method === "POST") {
    requireMockRole("HOST", "ADMIN", "SUPER_ADMIN");
    const list = getGames();
    const game = list.find((item) => item.id === completeGameMatch[1]);
    if (!game) throw new Error("球局不存在");
    const actorIsHost =
      hasMockRole("HOST") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (actorIsHost && game.hostId && game.hostId !== mockUser().id)
      throw new Error("主理人只能结束自己负责的球局");
    if (game.status === "COMPLETED")
      return ok({
        checkedIn: (game.registrations || []).filter(
          (item: any) => item.status === "CHECKED_IN",
        ).length,
        reward: game.hostReward || null,
      });
    if (!["OPEN", "FULL", "IN_PROGRESS"].includes(game.status))
      throw new Error(`当前球局状态为 ${game.status}，不允许结束`);
    const startsAt = new Date(String(game.startsAt || ""));
    if (Number.isNaN(startsAt.getTime()))
      throw new Error("球局开始时间无效，不能结束并结算");
    if (startsAt > new Date()) throw new Error("球局尚未开始，不能结束并结算");
    const checkedIn = (game.registrations || []).filter(
      (item: any) => item.status === "CHECKED_IN",
    ).length;
    game.status = "COMPLETED";
    game.hostReward = game.hostReward || {
      basisCount: checkedIn,
      rewardType: "BADMINTON_COIN",
      amount: Math.min(checkedIn * 20, 500),
      status: "PENDING_OBSERVATION",
    };
    saveGames(list);
    return ok({ checkedIn, reward: game.hostReward });
  }
  if (url === "/events" && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const name = text(data.name);
    const code = text(data.code);
    if (!code || !name) throw new Error("赛事编码和名称不能为空");
    const startsAt = new Date(String(data.startsAt || ""));
    const registrationEndsAt = new Date(String(data.registrationEndsAt || ""));
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(registrationEndsAt.getTime()) ||
      registrationEndsAt >= startsAt
    ) {
      throw new Error("报名截止时间必须早于开赛时间");
    }
    if (startsAt <= new Date()) throw new Error("赛事开始时间必须晚于当前时间");
    if (registrationEndsAt <= new Date()) throw new Error("报名截止时间必须晚于当前时间");
    const capacityPeople = integer(data.capacityPeople)
      ? Number(data.capacityPeople)
      : 48;
    const minimumPeople = integer(data.minimumPeople)
      ? Number(data.minimumPeople)
      : 24;
    const totalRounds = integer(data.totalRounds)
      ? Number(data.totalRounds)
      : 5;
    if (
      capacityPeople < 24 ||
      capacityPeople > 48 ||
      capacityPeople % 2 !== 0 ||
      minimumPeople !== 24 ||
      totalRounds !== 5
    ) {
      throw new Error("赛事必须固定为24-48人、24人成赛、五轮瑞士制");
    }
    const feeCents =
      integer(data.feeCents) && Number(data.feeCents) >= 0
        ? Number(data.feeCents)
        : 0;
    const created = {
      ...data,
      id: newId("event"),
      code,
      name,
      status: "DRAFT",
      currentRound: 0,
      startsAt: startsAt.toISOString(),
      registrationEndsAt: registrationEndsAt.toISOString(),
      capacityPeople,
      minimumPeople,
      totalRounds,
      feeCents,
      _count: { teams: 0 },
    };
    saveEvents([created, ...getEvents()]);
    return ok(created);
  }
  if (url === "/events") return ok(getEvents());
  const eventDetailMatch = url.match(/^\/events\/([^/]+)$/);
  if (eventDetailMatch && method === "GET")
    return ok(requireEvent(eventDetailMatch[1]));
  const eventPrizesMatch = url.match(/^\/events\/([^/]+)\/prizes$/);
  if (eventPrizesMatch && method === "GET") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return ok(requireEvent(eventPrizesMatch[1]).prizeAwards || []);
  }
  if (eventPrizesMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(eventPrizesMatch[1]);
    if (detail.status !== "COMPLETED")
      throw new Error("赛事尚未完赛，不能发放奖品");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "奖品发放幂等键",
    );
    const awardName = text(data.awardName);
    const teamId = text(data.teamId);
    const inventoryItemId = text(data.inventoryItemId);
    const quantity = integer(data.quantity);
    const note = text(data.note) || null;
    if (awardName.length < 2) throw new Error("奖项名称至少需要2个字");
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999)
      throw new Error("奖品数量必须为1-999的整数");
    const awards = detail.prizeAwards || [];
    const existing = awards.find(
      (award: any) => award.idempotencyKey === idempotencyKey,
    );
    const requestedRecipients = Array.isArray(data.recipientNames)
      ? data.recipientNames.map((name: unknown) => text(name)).filter(Boolean)
      : [];
    if (existing) {
      const sameRecipients =
        !requestedRecipients.length ||
        JSON.stringify(existing.recipientNames) ===
          JSON.stringify(requestedRecipients);
      if (
        existing.teamId !== teamId ||
        existing.awardName !== awardName ||
        existing.inventoryItemId !== inventoryItemId ||
        Number(existing.quantity) !== quantity ||
        existing.note !== note ||
        !sameRecipients
      ) {
        throw new Error("幂等键已用于其他赛事奖品指令，请更换幂等键");
      }
      return ok(existing);
    }
    const team = (detail.teams || []).find((entry: any) => entry.id === teamId);
    if (!team) throw new Error("获奖队伍不存在");
    if (
      team.status !== "COMPLETED" ||
      !Number.isInteger(team.finalRank) ||
      team.finalRank < 1
    )
      throw new Error("获奖队伍尚未生成有效最终名次");
    const availableNames = [text(team.playerAName), text(team.playerBName)];
    const recipientNames = requestedRecipients.length
      ? requestedRecipients
      : availableNames;
    if (
      new Set(recipientNames.map((name: string) => name.toLocaleLowerCase()))
        .size !== recipientNames.length
    )
      throw new Error("奖品领取人不能重复");
    if (
      recipientNames.some(
        (name: string) =>
          !availableNames.some(
            (candidate: string) =>
              candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ),
      )
    )
      throw new Error("奖品领取人必须属于获奖队伍");
    if (
      awards.some(
        (award: any) =>
          award.teamId === teamId &&
          award.awardName === awardName &&
          award.inventoryItemId === inventoryItemId,
      )
    )
      throw new Error("该队伍的同一奖项和SKU已经发放");
    const goods = getGoods();
    const item = goods.find((entry) => entry.id === inventoryItemId);
    if (!item || item.enabled === false)
      throw new Error("奖品库存商品不存在或已停用");
    if (Number(item.stock || 0) < quantity) throw new Error("奖品库存不足");
    const stockBefore = Number(item.stock || 0);
    const stockAfter = stockBefore - quantity;
    const stockTransaction = {
      id: newId("stock-tx"),
      itemId: item.id,
      type: "EVENT_USAGE",
      quantity: -quantity,
      stockBefore,
      stockAfter,
      unitCostCents: item.purchasePriceCents,
      operatorId: mockUser().id,
      reason: `${detail.name} · ${awardName} · ${team.name}`,
      idempotencyKey: `EVENT_PRIZE:${idempotencyKey}`,
      metadata: {
        referenceType: "EventPrizeAward",
        eventId: detail.id,
        teamId,
        finalRank: team.finalRank,
        awardName,
        recipientNames,
        prizeIssueIdempotencyKey: idempotencyKey,
      },
      createdAt: new Date().toISOString(),
    };
    const award = {
      id: newId("event-prize"),
      eventId: detail.id,
      teamId,
      awardName,
      finalRank: team.finalRank,
      recipientNames,
      inventoryItemId: item.id,
      quantity,
      status: "ISSUED",
      operatorId: mockUser().id,
      inventoryTransactionId: stockTransaction.id,
      idempotencyKey,
      note,
      prizePoolSnapshot: detail.prizePool || null,
      issuedAt: new Date().toISOString(),
      team: { id: team.id, name: team.name, finalRank: team.finalRank },
      inventoryItem: { id: item.id, sku: item.sku, name: item.name },
      operator: { id: mockUser().id, displayName: mockUser().displayName },
      signedBy: null,
    };
    item.stock = stockAfter;
    detail.prizeAwards = [...awards, award];
    saveGoods(goods);
    saveInventoryTransactions([
      stockTransaction,
      ...getInventoryTransactions(),
    ]);
    saveEventDetail(detail);
    return ok(award);
  }
  const receiveEventPrizeMatch = url.match(
    /^\/events\/([^/]+)\/prizes\/([^/]+)\/receive$/,
  );
  if (receiveEventPrizeMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(receiveEventPrizeMatch[1]);
    const award = (detail.prizeAwards || []).find(
      (entry: any) => entry.id === receiveEventPrizeMatch[2],
    );
    if (!award) throw new Error("赛事奖品发放记录不存在");
    const receivedByName = text(data.receivedByName);
    const receiptIdempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "奖品签收幂等键",
    );
    const receiptNote = text(data.note) || null;
    if (!receivedByName) throw new Error("签收人不能为空");
    if (award.status === "RECEIVED") {
      if (
        award.receivedByName !== receivedByName ||
        award.receiptIdempotencyKey !== receiptIdempotencyKey ||
        award.receiptNote !== receiptNote
      )
        throw new Error("奖品已经签收，签收信息与本次请求不一致");
      return ok(award);
    }
    award.status = "RECEIVED";
    award.receivedByName = receivedByName;
    award.signedById = mockUser().id;
    award.signedBy = { id: mockUser().id, displayName: mockUser().displayName };
    award.receiptNote = receiptNote;
    award.receiptIdempotencyKey = receiptIdempotencyKey;
    award.receivedAt = new Date().toISOString();
    saveEventDetail(detail);
    return ok(award);
  }
  const registerEventMatch = url.match(/^\/events\/([^/]+)\/register$/);
  if (registerEventMatch && method === "POST") {
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "EVENT_REGISTRATION",
      eventId: registerEventMatch[1],
      name: text(data.name),
      playerAName: text(data.playerAName),
      playerBName: text(data.playerBName),
      playerAUserId: text(data.playerAUserId) || null,
      playerBUserId: text(data.playerBUserId) || null,
      category: text(data.category),
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
    });
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const detail = requireEvent(registerEventMatch[1]);
    if (detail.status !== "OPEN") throw new Error("赛事不在报名期");
    if (
      detail.registrationEndsAt &&
      new Date(detail.registrationEndsAt) <= new Date()
    )
      throw new Error("赛事报名已截止");
    const teamName = text(data.name);
    const playerAName = text(data.playerAName);
    const playerBName = text(data.playerBName);
    if (!teamName || !playerAName || !playerBName)
      throw new Error("固定双打必须填写队名和两名队员");
    if (playerAName.toLocaleLowerCase() === playerBName.toLocaleLowerCase())
      throw new Error("固定双打的两名队员不能相同");
    const playerAUserId = text(data.playerAUserId) || mockUser().id;
    const playerBUserId = text(data.playerBUserId);
    if (playerBUserId && playerAUserId === playerBUserId)
      throw new Error("固定双打的两名账号不能相同");
    const activeTeams = (detail.teams || []).filter((team: any) =>
      activeTeamStatuses.includes(team.status),
    );
    if ((activeTeams.length + 1) * 2 > eventCapacity(detail))
      throw new Error(`赛事名额已满（最多${eventCapacity(detail)}人）`);
    const currentUserId = mockUser().id;
    const existing = (detail.teams || []).find(
      (team: any) =>
        activeTeamStatuses.includes(team.status) &&
        [team.captainId, team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .includes(currentUserId),
    );
    if (existing) throw new Error("当前用户已参加本赛事");
    const participantIds = [playerAUserId, playerBUserId].filter(Boolean);
    const duplicateParticipant = (detail.teams || []).some(
      (team: any) =>
        activeTeamStatuses.includes(team.status) &&
        [team.playerAUserId, team.playerBUserId]
          .filter(Boolean)
          .some((id: string) => participantIds.includes(id)),
    );
    if (duplicateParticipant)
      throw new Error("同一账号不能参加同一赛事的多个固定双打队伍");
    const orderId = newId("order");
    const team = {
      id: newId("team"),
      name: teamName,
      playerAName,
      playerBName,
      category: data.category || "MIXED_DOUBLES",
      status: "REGISTERED",
      captainId: currentUserId,
      playerAUserId,
      playerBUserId: playerBUserId || null,
      orderId,
      points: 0,
      wins: 0,
      losses: 0,
      scoreDiff: 0,
      finalRank: null,
    };
    detail.teams = [...(detail.teams || []), team];
    detail._count = { ...(detail._count || {}), teams: activeTeams.length + 1 };
    if (detail._count.teams * 2 >= eventCapacity(detail))
      detail.status = "FULL";
    saveEventDetail(detail);
    const createdOrder = {
      id: orderId,
      orderNo: newOrderNo("EV"),
      title: `${detail.name} 报名`,
      status: "PENDING",
      businessType: "EVENT",
      eventId: detail.id,
      eventTeamId: team.id,
      payableCents: Number(detail.feeCents || 0),
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: currentUserId,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: { eventId: detail.id },
    };
    saveOrders([createdOrder, ...getOrders()]);
    return finishMockOrderCreation(creation, {
      ...createdOrder,
      eventTeam: team,
    });
  }
  const publishEventMatch = url.match(/^\/events\/([^/]+)\/publish$/);
  if (publishEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(publishEventMatch[1]);
    if (detail.status === "OPEN") return ok(detail);
    if (detail.status !== "DRAFT")
      throw new Error(`赛事当前状态为 ${detail.status}，不能发布`);
    if (
      eventMinimumPeople(detail) !== 24 ||
      eventRoundLimit(detail) !== 5 ||
      eventCapacity(detail) < 24 ||
      eventCapacity(detail) > 48 ||
      eventCapacity(detail) % 2 !== 0
    ) {
      throw new Error("赛事配置不符合固定24-48人、五轮瑞士制要求");
    }
    if (
      detail.registrationEndsAt &&
      detail.startsAt &&
      new Date(detail.registrationEndsAt) >= new Date(detail.startsAt)
    )
      throw new Error("报名截止时间必须早于开赛时间");
    if (detail.startsAt && new Date(detail.startsAt) <= new Date())
      throw new Error("赛事开赛时间已过，不能发布");
    detail.status = "OPEN";
    saveEventDetail(detail);
    const event = getEvents().find((item) => item.id === publishEventMatch[1]);
    return ok(event || { id: publishEventMatch[1], status: "OPEN" });
  }
  const finishEventMatch = url.match(/^\/events\/([^/]+)\/finish$/);
  if (finishEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(finishEventMatch[1]);
    if (detail.status === "COMPLETED")
      return ok(
        (detail.teams || [])
          .filter((team: any) => team.finalRank)
          .sort((a: any, b: any) => a.finalRank - b.finalRank),
      );
    if (detail.status !== "IN_PROGRESS")
      throw new Error(`当前赛事状态为 ${detail.status}，不允许完赛`);
    if (Number(detail.currentRound || 0) !== eventRoundLimit(detail))
      throw new Error(`赛事必须完成${eventRoundLimit(detail)}轮后才能完赛`);
    const checkedTeams = (detail.teams || []).filter(
      (team: any) => team.status === "CHECKED_IN",
    );
    if (checkedTeams.length * 2 < eventMinimumPeople(detail))
      throw new Error(
        `签到人数不足${eventMinimumPeople(detail)}人，暂不能完赛`,
      );
    for (let round = 1; round <= eventRoundLimit(detail); round += 1) {
      const roundMatches = (detail.matches || []).filter(
        (match: any) => match.round === round,
      );
      if (
        !roundMatches.length ||
        roundMatches.some(
          (match: any) => !["CONFIRMED", "CORRECTED"].includes(match.status),
        )
      )
        throw new Error(`第${round}轮仍有未确认比分`);
    }
    const ranked = [...checkedTeams].sort(
      (a, b) =>
        Number(b.points || 0) - Number(a.points || 0) ||
        Number(b.scoreDiff || 0) - Number(a.scoreDiff || 0),
    );
    ranked.forEach((team, index) => {
      team.finalRank = index + 1;
      team.eventPointsAwarded = Math.max(1, ranked.length - index);
      team.status = "COMPLETED";
    });
    detail.status = "COMPLETED";
    saveEventDetail(detail);
    return ok(ranked);
  }
  const nextEventRoundMatch = url.match(/^\/events\/([^/]+)\/rounds\/next$/);
  if (nextEventRoundMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(nextEventRoundMatch[1]);
    const nextRound = Number(detail.currentRound || 0) + 1;
    if (!["OPEN", "FULL", "IN_PROGRESS"].includes(detail.status))
      throw new Error(`当前赛事状态为 ${detail.status}，不允许生成下一轮配对`);
    if (nextRound > eventRoundLimit(detail))
      throw new Error("所有轮次已经完成");
    const teams = (detail.teams || []).filter(
      (team: any) => team.status === "CHECKED_IN",
    );
    if (teams.length * 2 < eventMinimumPeople(detail))
      throw new Error(
        `签到人数不足${eventMinimumPeople(detail)}人，暂不能开赛`,
      );
    if (nextRound > 1) {
      const previous = (detail.matches || []).filter(
        (match: any) => match.round === nextRound - 1,
      );
      if (
        !previous.length ||
        previous.some(
          (match: any) => !["CONFIRMED", "CORRECTED"].includes(match.status),
        )
      )
        throw new Error(`第${nextRound - 1}轮仍有未确认比分`);
    }
    if ((detail.matches || []).some((match: any) => match.round === nextRound))
      throw new Error(`第${nextRound}轮配对已经生成，请勿重复操作`);
    const pairMatches = buildMockSwissPairings(teams, nextRound).map(
      ({ teamA, teamB }, index) => {
        if (!teamB) {
          teamA.points = Number(teamA.points || 0) + 1;
          teamA.wins = Number(teamA.wins || 0) + 1;
          teamA.opponents = [...(teamA.opponents || []), "BYE"];
          return {
            id: newId(`match-${nextRound}`),
            round: nextRound,
            teamAId: teamA.id,
            teamBId: null,
            status: "CONFIRMED",
            courtLabel: "轮空",
            startingScoreA: 0,
            startingScoreB: 0,
            scoreA: 21,
            scoreB: 0,
          };
        }
        const [startingScoreA, startingScoreB] = eventStartingScore(
          teamA.category,
          teamB.category,
        );
        return {
          id: newId(`match-${nextRound}`),
          round: nextRound,
          teamAId: teamA.id,
          teamBId: teamB.id,
          status: "PENDING",
          courtLabel: `${index + 1}号场`,
          startingScoreA,
          startingScoreB,
          scoreA: null,
          scoreB: null,
        };
      },
    );
    detail.currentRound = nextRound;
    detail.status = "IN_PROGRESS";
    detail.matches = [...(detail.matches || []), ...pairMatches];
    saveEventDetail(detail);
    return ok(pairMatches);
  }
  const eventCheckInMatch = url.match(
    /^\/events\/([^/]+)\/teams\/([^/]+)\/check-in$/,
  );
  if (eventCheckInMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(eventCheckInMatch[1]);
    const team = (detail.teams || []).find(
      (item: any) => item.id === eventCheckInMatch[2],
    );
    if (!team) throw new Error("参赛组合不存在");
    if (team.status === "CHECKED_IN") return ok(team);
    if (
      !["OPEN", "FULL"].includes(detail.status) ||
      Number(detail.currentRound || 0) !== 0
    )
      throw new Error("当前赛事状态不允许签到");
    if (team.status !== "PAID") throw new Error("参赛报名尚未支付");
    team.status = "CHECKED_IN";
    team.checkedInAt = new Date().toISOString();
    saveEventDetail(detail);
    return ok(team);
  }
  const scoreEventMatch = url.match(/^\/events\/matches\/([^/]+)\/score$/);
  if (scoreEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const details = getEvents().map((item) => getEventDetail(item.id));
    const detail = details.find((item) =>
      (item.matches || []).some(
        (match: any) => match.id === scoreEventMatch[1],
      ),
    );
    const match = detail?.matches?.find(
      (item: any) => item.id === scoreEventMatch[1],
    );
    const scoreA = Number(data.scoreA);
    const scoreB = Number(data.scoreB);
    if (!match) throw new Error("比赛不存在");
    if (!detail || detail.status !== "IN_PROGRESS")
      throw new Error("当前赛事不在进行中");
    if (Number(match.round) !== Number(detail.currentRound || 0))
      throw new Error("只能录入当前轮比分");
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < Number(match.startingScoreA || 0) ||
      scoreB < Number(match.startingScoreB || 0) ||
      scoreA > 21 ||
      scoreB > 21 ||
      scoreA === scoreB ||
      Math.max(scoreA, scoreB) !== 21
    )
      throw new Error("比分必须以21分结束、不得平分且不能低于让分");
    if (match.status === "CONFIRMED" || match.status === "CORRECTED") {
      if (match.scoreA === scoreA && match.scoreB === scoreB) return ok(match);
      throw new Error("比分已确认，修正请使用纠错接口");
    }
    Object.assign(match, { scoreA, scoreB, status: "CONFIRMED" });
    const teamA = (detail.teams || []).find(
      (team: any) => team.id === match.teamAId,
    );
    const teamB = (detail.teams || []).find(
      (team: any) => team.id === match.teamBId,
    );
    if (teamA && teamB) {
      teamA.opponents = [...new Set([...(teamA.opponents || []), teamB.id])];
      teamB.opponents = [...new Set([...(teamB.opponents || []), teamA.id])];
    }
    if (detail) saveEventDetail(recomputeEventStandings(detail));
    return ok(match || { id: scoreEventMatch[1], status: "CONFIRMED" });
  }
  const correctEventMatch = url.match(/^\/events\/matches\/([^/]+)\/correct$/);
  if (correctEventMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");
    const details = getEvents().map((item) => getEventDetail(item.id));
    const detail = details.find((item) =>
      (item.matches || []).some(
        (match: any) => match.id === correctEventMatch[1],
      ),
    );
    const match = detail?.matches?.find(
      (item: any) => item.id === correctEventMatch[1],
    );
    if (!match) throw new Error("比赛不存在");
    if (!detail || detail.status !== "IN_PROGRESS")
      throw new Error("当前赛事不在进行中");
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("纠错必须填写至少2个字的原因");
    const scoreA = Number(data.scoreA);
    const scoreB = Number(data.scoreB);
    if (
      !Number.isInteger(scoreA) ||
      !Number.isInteger(scoreB) ||
      scoreA < Number(match.startingScoreA || 0) ||
      scoreB < Number(match.startingScoreB || 0) ||
      scoreA > 21 ||
      scoreB > 21 ||
      scoreA === scoreB ||
      Math.max(scoreA, scoreB) !== 21
    )
      throw new Error("纠正比分必须以21分结束、不得平分且不能低于让分");
    if (!["CONFIRMED", "CORRECTED"].includes(match.status))
      throw new Error("只有已确认比分才能纠错");
    if (
      match.status === "CORRECTED" &&
      match.scoreA === scoreA &&
      match.scoreB === scoreB &&
      match.correctionReason === reason
    )
      return ok(match);
    Object.assign(match, {
      scoreA,
      scoreB,
      status: "CORRECTED",
      correctionReason: reason,
    });
    if (detail) saveEventDetail(recomputeEventStandings(detail));
    return ok(match || { id: correctEventMatch[1], status: "CORRECTED" });
  }
  if (url === "/training/products" && method === "GET")
    return ok(
      getTrainingProducts()
        .filter((product) => product.enabled !== false)
        .map((product) => ({
          ...product,
          classes: (product.classes || []).filter(
            (trainingClass: any) => trainingClass.active !== false,
          ),
        })),
    );
  if (url === "/training/products" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const audience = text(data.audience);
    const totalSessions = integer(data.totalSessions);
    const validityDays = integer(data.validityDays);
    const priceCents = integer(data.priceCents);
    const refundRule = data.refundRule;
    const reason = requireTrainingCreationReason(data.reason);
    if (!code || code.length > 40 || !name || name.length > 100)
      throw new Error("课程产品编码和名称不能为空且不能超过规定长度");
    if (!['ADULT', 'YOUTH'].includes(audience))
      throw new Error("课程产品适用人群无效");
    if (totalSessions < 1 || totalSessions > 200)
      throw new Error("课程总课次必须为1-200");
    if (validityDays < 1 || validityDays > 730)
      throw new Error("课程有效期必须为1-730天");
    if (priceCents < 1) throw new Error("课程售价必须大于0");
    if (!refundRule || typeof refundRule !== "object" || Array.isArray(refundRule))
      throw new Error("退费规则必须为对象");
    const command = {
      code,
      name,
      audience,
      totalSessions,
      validityDays,
      priceCents,
      refundRule,
      reason,
    };
    const attempt = beginMockTrainingCreation(
      data.creationIdempotencyKey,
      "TRAINING_PRODUCT_CREATED",
      "TrainingProduct",
      command,
    );
    if (attempt.replayed) return finishMockTrainingCreation(attempt, attempt.response, reason);
    const products = getTrainingProducts();
    if (products.some((product) => text(product.code).toUpperCase() === code))
      throw new Error("课程产品编码已存在");
    const product = {
      id: newId("training-product"),
      code,
      name,
      audience,
      totalSessions,
      validityDays,
      priceCents,
      unitRevenueCents: Math.round(priceCents / totalSessions),
      refundRule,
      enabled: true,
      classes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveTrainingProducts([product, ...products]);
    return finishMockTrainingCreation(attempt, product, reason);
  }
  if (url === "/training/classes" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code).toUpperCase();
    const productId = text(data.productId);
    const name = text(data.name);
    const coachId = text(data.coachId) || null;
    const assistantId = text(data.assistantId) || null;
    const schedule = data.schedule as Record<string, unknown> | undefined;
    const capacity = integer(data.capacity);
    const coachCostCents = integer(data.coachCostCents ?? 0);
    const assistantCostCents = integer(data.assistantCostCents ?? 0);
    const materialCostCents = integer(data.materialCostCents ?? 0);
    const reason = requireTrainingCreationReason(data.reason);
    if (!code || code.length > 40 || !name || name.length > 100)
      throw new Error("培训班级编码和名称不能为空且不能超过规定长度");
    if (!productId) throw new Error("必须选择课程产品");
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule))
      throw new Error("班级课表配置不能为空");
    const weekday = integer(schedule.weekday);
    const scheduleStartsAt = text(schedule.startsAt);
    const scheduleEndsAt = text(schedule.endsAt);
    if (
      weekday < 1 ||
      weekday > 7 ||
      !/^\d{2}:\d{2}$/.test(scheduleStartsAt) ||
      !/^\d{2}:\d{2}$/.test(scheduleEndsAt) ||
      scheduleEndsAt <= scheduleStartsAt
    )
      throw new Error("班级课表时间设置无效");
    if (capacity < 1 || capacity > 100)
      throw new Error("班级容量必须为1-100");
    if ([coachCostCents, assistantCostCents, materialCostCents].some((value) => value < 0))
      throw new Error("班级成本必须为非负整数分");
    const normalizedSchedule = {
      ...schedule,
      weekday,
      startsAt: scheduleStartsAt,
      endsAt: scheduleEndsAt,
    };
    const command = {
      code,
      productId,
      name,
      coachId,
      assistantId,
      schedule: normalizedSchedule,
      capacity,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
      reason,
    };
    const attempt = beginMockTrainingCreation(
      data.creationIdempotencyKey,
      "TRAINING_CLASS_CREATED",
      "TrainingClass",
      command,
    );
    if (attempt.replayed) return finishMockTrainingCreation(attempt, attempt.response, reason);
    const products = getTrainingProducts();
    const product = products.find((item) => item.id === productId && item.enabled !== false);
    if (!product) throw new Error("培训产品不存在或已停用");
    if (
      products
        .flatMap((item) => item.classes || [])
        .some((item: any) => text(item.code).toUpperCase() === code)
    )
      throw new Error("培训班级编码已存在");
    const trainingClass = {
      id: newId("training-class"),
      code,
      productId,
      name,
      coachId,
      assistantId,
      schedule: normalizedSchedule,
      capacity,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    product.classes = [trainingClass, ...(product.classes || [])];
    saveTrainingProducts(products);
    return finishMockTrainingCreation(attempt, trainingClass, reason);
  }
  if (url === "/training/students" && method === "GET") {
    return ok(
      getStudents().filter((student) => student.guardianId === mockUser().id),
    );
  }
  if (url === "/training/admin/students" && method === "GET") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const guardianId = text(data?.guardianId);
    return ok(
      getStudents().filter(
        (student) => !guardianId || student.guardianId === guardianId,
      ),
    );
  }
  if (url === "/training/students" && method === "POST") {
    const displayName = text(data.displayName);
    if (!displayName) throw new Error("学员姓名不能为空");
    const guardianId = text(data.guardianId) || mockUser().id;
    const actingForAnotherGuardian = guardianId !== mockUser().id;
    if (actingForAnotherGuardian)
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const guardianConsentStatus = data.guardianConsentStatus === true;
    const authorizationNote = text(data.authorizationNote);
    if (
      actingForAnotherGuardian &&
      guardianConsentStatus &&
      !authorizationNote
    ) {
      throw new Error("代监护人登记授权时必须填写授权凭证说明");
    }
    const birthMonth = data.birthMonth
      ? new Date(String(data.birthMonth))
      : null;
    if (
      birthMonth &&
      (Number.isNaN(birthMonth.getTime()) || birthMonth > new Date())
    ) {
      throw new Error("出生月份格式无效或晚于当前月份");
    }
    const student = {
      id: newId("student"),
      guardianId,
      displayName,
      birthMonth: birthMonth?.toISOString() || null,
      guardianConsentStatus,
      authorizationNote:
        authorizationNote ||
        (guardianConsentStatus ? "监护人通过小程序确认授权" : null),
      guardian: {
        id: guardianId,
        displayName: actingForAnotherGuardian
          ? "指定监护人"
          : mockUser().displayName,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveStudents([student, ...getStudents()]);
    return ok(student);
  }
  const trainingStudentMatch = url.match(/^\/training\/students\/([^/]+)$/);
  if (trainingStudentMatch && method === "PATCH") {
    const students = getStudents();
    const student = students.find(
      (item) => item.id === trainingStudentMatch[1],
    );
    if (!student) throw new Error("学员档案不存在");
    const actingForAnotherGuardian = student.guardianId !== mockUser().id;
    if (actingForAnotherGuardian)
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    if (data.displayName !== undefined && !text(data.displayName))
      throw new Error("学员姓名不能为空");
    if (
      actingForAnotherGuardian &&
      data.guardianConsentStatus === true &&
      !student.guardianConsentStatus &&
      !text(data.authorizationNote)
    ) {
      throw new Error("代监护人确认授权时必须填写授权凭证说明");
    }
    const birthMonth =
      data.birthMonth === undefined
        ? undefined
        : new Date(String(data.birthMonth));
    if (
      birthMonth &&
      (Number.isNaN(birthMonth.getTime()) || birthMonth > new Date())
    ) {
      throw new Error("出生月份格式无效或晚于当前月份");
    }
    Object.assign(student, {
      ...(data.displayName === undefined
        ? {}
        : { displayName: text(data.displayName) }),
      ...(birthMonth === undefined
        ? {}
        : { birthMonth: birthMonth.toISOString() }),
      ...(data.guardianConsentStatus === undefined
        ? {}
        : { guardianConsentStatus: data.guardianConsentStatus === true }),
      ...(data.authorizationNote === undefined
        ? {}
        : { authorizationNote: text(data.authorizationNote) }),
      updatedAt: new Date().toISOString(),
    });
    if (
      !actingForAnotherGuardian &&
      data.guardianConsentStatus === true &&
      !student.authorizationNote
    ) {
      student.authorizationNote = "监护人通过小程序确认授权";
    }
    saveStudents(students);
    return ok(student);
  }
  if (url === "/training/enrollments") {
    const userId = mockUser().id;
    return ok(
      getEnrollments().filter(
        (enrollment) => enrollment.buyerId === userId || !enrollment.buyerId,
      ),
    );
  }
  if (url === "/training/admin/enrollments") {
    requireMockRole("COACH", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const roles = mockRoles();
    const ownClassOnly =
      roles.includes("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const ownedClassIds = ownClassOnly
      ? getTrainingProducts()
          .flatMap((product) => product.classes || [])
          .filter(
            (trainingClass: any) =>
              trainingClass.active !== false &&
              (trainingClass.coachId === mockUser().id ||
                trainingClass.assistantId === mockUser().id),
          )
          .map((trainingClass: any) => trainingClass.id)
      : [];
    return ok(
      ownClassOnly
        ? getEnrollments().filter(
            (enrollment) => ownedClassIds.includes(enrollment.classId),
          )
        : getEnrollments(),
    );
  }
  if (url === "/training/sessions" && method === "GET") {
    requireMockRole("COACH", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const roles = mockRoles();
    const ownClassOnly =
      roles.includes("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const ownedClassIds = ownClassOnly
      ? getTrainingProducts()
          .flatMap((product) => product.classes || [])
          .filter(
            (trainingClass: any) =>
              trainingClass.active !== false &&
              (trainingClass.coachId === mockUser().id ||
                trainingClass.assistantId === mockUser().id),
          )
          .map((trainingClass: any) => trainingClass.id)
      : [];
    return ok(
      ownClassOnly
        ? getTrainingSessions().filter(
            (trainingSession) => ownedClassIds.includes(trainingSession.classId),
          )
        : getTrainingSessions(),
    );
  }
  if (url === "/training/sessions" && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const classId = text(data.classId);
    const startsAt = new Date(String(data.startsAt || ""));
    const endsAt = new Date(String(data.endsAt || ""));
    const note = text(data.note) || undefined;
    const courtIds = Array.isArray(data.courtIds)
      ? data.courtIds.map((id: unknown) => text(id)).filter(Boolean)
      : [];
    if (
      !classId ||
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      endsAt <= startsAt
    )
      throw new Error("课次时间设置无效");
    if (new Set(courtIds).size !== courtIds.length || !courtIds.length)
      throw new Error("培训课次至少需要一个不重复场地");
    if (startsAt <= new Date())
      throw new Error("培训课次开始时间必须晚于当前时间");
    const sortedCourtIds = [...courtIds].sort();
    const reason = requireTrainingCreationReason(data.reason);
    const command = {
      classId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      courtIds: sortedCourtIds,
      note: note || null,
      reason,
    };
    const attempt = beginMockTrainingCreation(
      data.creationIdempotencyKey,
      "TRAINING_SESSION_CREATED",
      "TrainingSession",
      command,
    );
    if (attempt.replayed) return finishMockTrainingCreation(attempt, attempt.response, reason);
    const trainingClass = getTrainingProducts()
      .flatMap((product) => product.classes || [])
      .find((item: any) => item.id === classId && item.active !== false);
    if (!trainingClass) throw new Error("培训班不存在");
    const actorIsCoach =
      hasMockRole("COACH") && !hasMockRole("ADMIN", "SUPER_ADMIN");
    if (
      actorIsCoach &&
      trainingClass.coachId !== mockUser().id &&
      trainingClass.assistantId !== mockUser().id
    )
      throw new Error("教练只能为自己负责的班级排课");
    const calendar = availability(mockShanghaiBusinessDate(startsAt));
    const selectedCourts = calendar.courts.filter((court: any) =>
      sortedCourtIds.includes(court.id),
    );
    if (selectedCourts.length !== sortedCourtIds.length || selectedCourts.some((court: any) => !court.enabled))
      throw new Error("部分场地不存在或已停用");
    const closure = (calendar.closures || []).find(
      (item: any) =>
        sortedCourtIds.includes(item.courtId) &&
        item.status === "ACTIVE" &&
        new Date(item.startsAt).getTime() < endsAt.getTime() &&
        new Date(item.endsAt).getTime() > startsAt.getTime(),
    );
    if (closure) throw new Error(`所选场地时段已封场：${closure.reason}`);
    const bookingConflict = (calendar.bookings || []).some(
      (existing: any) =>
        existing.status !== "CANCELLED" &&
        sortedCourtIds.includes(existing.courtId) &&
        new Date(existing.startsAt).getTime() < endsAt.getTime() &&
        new Date(existing.endsAt).getTime() > startsAt.getTime(),
    );
    const sessionConflict = getTrainingSessions().some(
      (existing: any) =>
        existing.status !== "CANCELLED" &&
        new Date(existing.startsAt).getTime() < endsAt.getTime() &&
        new Date(existing.endsAt).getTime() > startsAt.getTime() &&
        (existing.courtIds || []).some((courtId: string) =>
          sortedCourtIds.includes(courtId),
        ),
    );
    if (bookingConflict || sessionConflict)
      throw new Error("所选场地与已有预订冲突");
    const enrollmentList = getEnrollments().filter(
      (enrollment) =>
        enrollment.classId === classId &&
        ["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status),
    );
    const sessionId = newId("session");
    const attendanceRows = enrollmentList.map((enrollment) => ({
      id: newId("attendance"),
      sessionId,
      enrollmentId: enrollment.id,
      status: "PENDING",
      consumedSessions: 0,
      operatorId: null,
    }));
    const session = {
      id: sessionId,
      classId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      courtIds: sortedCourtIds,
      courtCount: sortedCourtIds.length,
      occupiedCourtHours:
        sortedCourtIds.length * ((endsAt.getTime() - startsAt.getTime()) / 3_600_000),
      coachCostCents: Number(trainingClass.coachCostCents || 0),
      assistantCostCents: Number(trainingClass.assistantCostCents || 0),
      materialCostCents: Number(trainingClass.materialCostCents || 0),
      note,
      class: { id: classId, name: trainingClass.name || classId },
      status: "SCHEDULED",
      attendances: attendanceRows,
    };
    saveTrainingSessions([session, ...getTrainingSessions()]);
    saveVenueBookings([
      ...sortedCourtIds.map((courtId) => ({
        id: newId("training-booking"),
        courtId,
        status: "CONFIRMED",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        usage: "TRAINING",
        trainingClassId: classId,
        note: `培训课次 ${session.id}，仅记录资源占用，不生成培训场地费`,
      })),
      ...getVenueBookings(),
    ]);
    // Keep the enrollment attendance ledger in sync with the new session.
    const allEnrollments = getEnrollments();
    enrollmentList.forEach((enrollment) => {
      const row = attendanceRows.find(
        (attendance: any) => attendance.enrollmentId === enrollment.id,
      );
      enrollment.attendances = [...(enrollment.attendances || []), row];
    });
    saveEnrollments(allEnrollments);
    return finishMockTrainingCreation(attempt, session, reason);
  }
  if (url === "/training/purchase") {
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "TRAINING_PURCHASE",
      productId: text(data.productId),
      classId: text(data.classId) || null,
      studentId: text(data.studentId) || null,
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
    });
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const product = getTrainingProducts().find((item) => item.id === data.productId);
    if (!product) throw new Error("培训产品不存在或已下架");
    if (product.audience === "YOUTH" && !data.studentId)
      throw new Error("青少年课程必须选择学员");
    if (data.studentId) {
      const student = getStudents().find(
        (item) =>
          item.id === data.studentId &&
          item.guardianId === mockUser().id &&
          item.guardianConsentStatus === true,
      );
      if (!student) throw new Error("学员不存在或监护人授权未完成");
    }
    const selectedClass = data.classId
      ? product.classes?.find((item: any) => item.id === data.classId)
      : undefined;
    if (data.classId && !selectedClass)
      throw new Error("班级不属于所选培训产品");
    const seatReservedUntil = selectedClass
      ? new Date(Date.now() + 15 * 60_000).toISOString()
      : null;
    if (selectedClass) {
      const now = Date.now();
      const seatHolders = getEnrollments().filter(
        (item) =>
          item.classId === selectedClass.id &&
          (["ACTIVE", "PARTIALLY_REFUNDED"].includes(item.status) ||
            (item.status === "PENDING_PAYMENT" &&
              new Date(item.seatReservedUntil || 0).getTime() > now)),
      );
      const duplicate = seatHolders.some((item) =>
        data.studentId
          ? item.studentId === data.studentId
          : item.buyerId === mockUser().id && !item.studentId,
      );
      if (duplicate) throw new Error("该学员已报名本班或仍在名额保留期内");
      if (seatHolders.length >= Number(selectedClass.capacity || 0))
        throw new Error("班级名额已满");
    }
    const orderId = newId("order");
    const enrollment = {
      id: newId("enroll"),
      orderId,
      enrollmentNo: `EN${Date.now()}`,
      classId: data.classId || product.classes?.[0]?.id || null,
      status: "PENDING_PAYMENT",
      totalSessions: product.totalSessions,
      usedSessions: 0,
      consumedSessions: 0,
      totalAmountCents: product.priceCents,
      prepaidBalanceCents: 0,
      seatReservedUntil,
      expiresAt: new Date(
        Date.now() + product.validityDays * 86_400_000,
      ).toISOString(),
      product,
      buyerId: mockUser().id,
      studentId: data.studentId || null,
      buyer: { displayName: mockUser().displayName },
      attendances: [],
    };
    saveEnrollments([enrollment, ...getEnrollments()]);
    const order = {
      id: orderId,
      orderNo: newOrderNo("TR"),
      title: product.name,
      status: "PENDING",
      businessType: "TRAINING",
      trainingEnrollmentId: enrollment.id,
      payableCents: product.priceCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: {
        productId: product.id,
        classId: selectedClass?.id,
        totalSessions: product.totalSessions,
        seatReservedUntil,
      },
    };
    saveOrders([order, ...getOrders()]);
    return finishMockOrderCreation(creation, order);
  }
  const attendanceMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/attendance$/,
  );
  if (attendanceMatch && method === "POST") {
    requireMockRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const lessons = getTrainingSessions();
    const enrollmentList = getEnrollments();
    const lesson = lessons.find((item) => item.id === attendanceMatch[1]);
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const attendance = enrollment?.attendances?.find(
      (item: any) => item.sessionId === attendanceMatch[1],
    ) as any;
    if (!lesson || !enrollment || !attendance)
      throw new Error("课次签到记录不存在");
    if (
      hasMockRole("COACH") &&
      !hasMockRole("ADMIN", "SUPER_ADMIN", "FRONT_DESK") &&
      lesson.classId !== "class-adult"
    )
      throw new Error("只能操作自己负责班级的培训出勤");
    const requestedStatus = text(data.status);
    if (!["ATTENDED", "ABSENT", "CANCELLED", "LEAVE"].includes(requestedStatus))
      throw new Error("请使用出勤、缺勤或请假状态登记");
    const persistedStatus =
      requestedStatus === "LEAVE" ? "MAKEUP_REQUIRED" : requestedStatus;
    if (["LEAVE", "CANCELLED"].includes(requestedStatus) && !text(data.reason))
      throw new Error("请假或取消课次必须填写原因");
    if (attendance.consumedAt || Number(attendance.consumedSessions || 0) > 0)
      throw new Error("已消课记录不能修改出勤状态");
    const terminalStatuses = [
      "ATTENDED",
      "ABSENT",
      "CANCELLED",
      "MAKEUP_REQUIRED",
    ];
    if (
      terminalStatuses.includes(attendance.status) &&
      attendance.status !== persistedStatus
    )
      throw new Error("当前出勤状态已锁定，请提交更正申请");
    if (attendance.status === persistedStatus)
      return ok({
        id: attendance.id,
        sessionId: attendanceMatch[1],
        enrollmentId: data.enrollmentId,
        status: persistedStatus,
        lessonStatus: lesson.status,
      });
    Object.assign(attendance, {
      status: persistedStatus,
      feedback: text(data.feedback) || attendance.feedback,
      // Arrival evidence is not the financial consume proposal. The actor is
      // represented by the mock command history; operatorId stays reserved
      // for the explicit maker step below.
      operatorId: attendance.operatorId,
      checkedInAt:
        persistedStatus === "ATTENDED"
          ? attendance.checkedInAt || new Date().toISOString()
          : attendance.checkedInAt,
      reason: text(data.reason) || attendance.reason,
    });
    saveEnrollments(enrollmentList);
    return ok({
      id: attendance.id,
      sessionId: attendanceMatch[1],
      enrollmentId: data.enrollmentId,
      status: persistedStatus,
      lessonStatus: lesson.status,
    });
  }
  const makeupMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/attendance\/makeup$/,
  );
  if (makeupMatch && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const enrollmentList = getEnrollments();
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const original = enrollment?.attendances?.find(
      (item: any) => item.sessionId === makeupMatch[1],
    );
    if (!enrollment || !original) throw new Error("原课次签到记录不存在");
    if (!["MAKEUP_REQUIRED", "LEAVE"].includes(original.status)) {
      if (
        original.status === "MADE_UP" &&
        original.makeupSessionId === data.makeupSessionId
      )
        return ok({
          id: original.id,
          sessionId: makeupMatch[1],
          enrollmentId: data.enrollmentId,
          status: "MADE_UP",
          makeupSessionId: data.makeupSessionId,
        });
      throw new Error("只有已批准请假的课次可以安排补课");
    }
    if (text(data.makeupSessionId) === makeupMatch[1])
      throw new Error("补课课次必须晚于原课次");
    const targetSession = getTrainingSessions().find(
      (item) => item.id === data.makeupSessionId,
    );
    if (!targetSession) throw new Error("补课课次不存在");
    if (targetSession.classId !== enrollment.classId)
      throw new Error("补课必须安排在同一培训班");
    const originalSession = getTrainingSessions().find(
      (item) => item.id === makeupMatch[1],
    );
    if (
      originalSession &&
      new Date(targetSession.startsAt) <= new Date(originalSession.startsAt)
    )
      throw new Error("补课课次必须晚于原课次");
    if (["CANCELLED", "COMPLETED"].includes(targetSession.status))
      throw new Error("已取消或已结束的课次不能安排补课");
    const target = enrollment.attendances?.find(
      (item: any) => item.sessionId === targetSession.id,
    );
    if (!target) throw new Error("补课课次没有该学员的签到名额");
    if (target && !["PENDING", "LEAVE"].includes(target.status))
      throw new Error("补课课次的学员名额已被处理");
    Object.assign(original, {
      status: "MADE_UP",
      makeupSessionId: data.makeupSessionId,
      feedback: [original.feedback, `补课安排:${data.makeupSessionId}`]
        .filter(Boolean)
        .join("；"),
    });
    saveEnrollments(enrollmentList);
    return ok({
      id: original.id,
      sessionId: makeupMatch[1],
      enrollmentId: data.enrollmentId,
      status: "MADE_UP",
      makeupSessionId: data.makeupSessionId,
    });
  }
  const consumeMatch = url.match(/^\/training\/sessions\/([^/]+)\/consume$/);
  if (consumeMatch && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const enrollmentList = getEnrollments();
    const lesson = getTrainingSessions().find(
      (item) => item.id === consumeMatch[1],
    );
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const attendance = enrollment?.attendances?.find(
      (item: any) => item.sessionId === consumeMatch[1],
    ) as any;
    if (!lesson || !enrollment || !attendance)
      throw new Error("课次签到记录不存在");
    if (
      hasMockRole("COACH") &&
      !hasMockRole("ADMIN", "SUPER_ADMIN") &&
      lesson.classId !== "class-adult"
    )
      throw new Error("只能操作自己负责班级的培训课次");
    if (isExpired(enrollment.expiresAt)) throw new Error("培训报名已过期");
    if (!["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status))
      throw new Error("报名记录不是在读状态");
    if (attendance.consumedAt || Number(attendance.consumedSessions || 0) > 0) {
      const activeRecognition = activeMockConsumeRecognition(attendance);
      if (
        text(data.idempotencyKey) &&
        activeRecognition?.idempotencyKey !== text(data.idempotencyKey)
      )
        throw new Error("该课次已经消课，禁止重复确认");
      return ok({
        ...activeRecognition,
        workflowStatus: "CONFIRMED",
        effectiveRevenueCents: Number(
          attendance.confirmedRevenueCents || trainingUnitRevenue(enrollment),
        ),
        venueContributionCents: Math.round(
          Number(
            attendance.confirmedRevenueCents || trainingUnitRevenue(enrollment),
          ) * 0.2,
        ),
        venueFeeCents: 0,
      });
    }
    if (["COMPLETED", "CANCELLED"].includes(lesson.status))
      throw new Error("已结束或已取消的课次不能继续消课");
    if (attendance.status !== "ATTENDED")
      throw new Error("学员完成到场登记后才能提交消课建议");
    if (
      Number(enrollment.consumedSessions || enrollment.usedSessions || 0) >=
        Number(enrollment.totalSessions || 0) ||
      Number(enrollment.prepaidBalanceCents || 0) <= 0
    )
      throw new Error("可用课时或预收余额不足");
    if (hasMockRole("COACH") && !hasMockRole("ADMIN", "SUPER_ADMIN")) {
      if (attendance.operatorId && attendance.operatorId !== mockUser().id)
        throw new Error("该课次已有其他教练提交消课建议");
      // Maker step records who proposed the consumption but leaves attendance
      // and balances untouched until an administrator confirms it.
      Object.assign(attendance, {
        operatorId: mockUser().id,
        feedback: text(data.feedback) || attendance.feedback,
      });
      saveEnrollments(enrollmentList);
      return ok({
        ...attendance,
        workflowStatus: "PENDING_CONFIRMATION",
        proposedById: mockUser().id,
      });
    }
    if (attendance.operatorId === mockUser().id)
      throw new Error("消课建议提交人与确认人不能是同一账号");
    const recognition = postMockTrainingConsume(
      enrollment,
      attendance,
      data.idempotencyKey,
    );
    saveEnrollments(enrollmentList);
    return ok({
      ...recognition,
      workflowStatus: "CONFIRMED",
    });
  }
  const confirmConsumeMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/consume\/confirm$/,
  );
  if (confirmConsumeMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const enrollmentList = getEnrollments();
    const lesson = getTrainingSessions().find(
      (item) => item.id === confirmConsumeMatch[1],
    );
    const enrollment = enrollmentList.find(
      (item) => item.id === data.enrollmentId,
    ) as any;
    const attendance = enrollment?.attendances?.find(
      (item: any) => item.sessionId === confirmConsumeMatch[1],
    ) as any;
    if (!lesson || !enrollment || !attendance)
      throw new Error("课次签到记录不存在");
    if (attendance.consumedAt) {
      const activeRecognition = activeMockConsumeRecognition(attendance);
      if (
        text(data.idempotencyKey) &&
        activeRecognition?.idempotencyKey !== text(data.idempotencyKey)
      )
        throw new Error("该课次已经使用其他幂等键消课");
      const recognized = Number(attendance.confirmedRevenueCents || 0);
      return ok({
        ...activeRecognition,
        workflowStatus: "CONFIRMED",
        effectiveRevenueCents: recognized,
        venueContributionCents: Math.round(recognized * 0.2),
        venueFeeCents: 0,
      });
    }
    if (["COMPLETED", "CANCELLED"].includes(lesson.status))
      throw new Error("已结束或已取消的课次不能继续消课");
    if (attendance?.operatorId === mockUser().id)
      throw new Error("消课建议提交人与确认人不能是同一账号");
    if (!attendance?.operatorId)
      throw new Error("必须先由教练提交消课建议，再由培训主管确认入账");
    if (
      isExpired(enrollment.expiresAt) ||
      !["ACTIVE", "PARTIALLY_REFUNDED"].includes(enrollment.status)
    )
      throw new Error("报名记录不是在读状态");
    if (attendance.status !== "ATTENDED")
      throw new Error("当前考勤状态不能确认消课");
    if (
      Number(enrollment.consumedSessions || enrollment.usedSessions || 0) >=
        Number(enrollment.totalSessions || 0) ||
      Number(enrollment.prepaidBalanceCents || 0) <= 0
    )
      throw new Error("可用课时或预收余额不足");
    const recognition = postMockTrainingConsume(
      enrollment,
      attendance,
      data.idempotencyKey,
    );
    saveEnrollments(enrollmentList);
    return ok({
      ...recognition,
      workflowStatus: "CONFIRMED",
    });
  }
  if (url === "/training/consume-corrections" && method === "GET") {
    requireMockRole(
      "COACH",
      "FRONT_DESK",
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const coachOnly =
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const corrections = getTrainingConsumeCorrections()
      .filter((correction) => {
        if (!coachOnly) return true;
        const ledger = findMockTrainingLedger(correction.recognitionId);
        const lesson = ledger
          ? getTrainingSessions().find(
              (item) => item.id === ledger.attendance.sessionId,
            )
          : null;
        return lesson?.classId === "class-adult";
      })
      .sort((a, b) =>
        String(b.requestedAt).localeCompare(String(a.requestedAt)),
      )
      .map(trainingCorrectionView);
    return ok(corrections);
  }
  if (url === "/training/consume-corrections" && method === "POST") {
    requireMockRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const recognitionId = text(data.recognitionId);
    const reason = text(data.reason);
    const requestIdempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "冲正申请幂等键",
    );
    if (reason.length < 2 || reason.length > 300)
      throw new Error("冲正申请原因长度必须为2-300个字符");
    const corrections = getTrainingConsumeCorrections();
    const replay = corrections.find(
      (item) => item.requestIdempotencyKey === requestIdempotencyKey,
    );
    if (replay) {
      if (
        replay.requestedById !== mockUser().id ||
        replay.recognitionId !== recognitionId ||
        replay.reason !== reason
      )
        throw new Error("冲正申请幂等键已用于其他指令");
      return ok(trainingCorrectionView(replay));
    }
    const ledger = findMockTrainingLedger(recognitionId);
    if (!ledger || ledger.recognition.type !== "CONSUME")
      throw new Error("可冲正的消课确认流水不存在");
    if (ledger.recognition.reversedBy)
      throw new Error("该消课流水已冲正");
    if (
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN")
    ) {
      const lesson = getTrainingSessions().find(
        (item) => item.id === ledger.attendance.sessionId,
      );
      if (lesson?.classId !== "class-adult")
        throw new Error("教练只能申请自己负责班级的消课冲正");
    }
    if (
      corrections.some(
        (item) =>
          item.recognitionId === recognitionId &&
          ["REQUESTED", "APPROVED"].includes(item.status),
      )
    )
      throw new Error("该消课流水已有待处理或已批准的冲正申请");
    const now = new Date().toISOString();
    const correction = {
      id: newId("consume-correction"),
      recognitionId,
      attendanceId: ledger.attendance.id,
      status: "REQUESTED",
      reason,
      reviewReason: null,
      requestedById: mockUser().id,
      reviewedById: null,
      reversalRecognitionId: null,
      requestIdempotencyKey,
      decisionIdempotencyKey: null,
      decisionAction: null,
      requestedAt: now,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    saveTrainingConsumeCorrections([correction, ...corrections]);
    return ok(trainingCorrectionView(correction));
  }
  const trainingCorrectionDecisionMatch = url.match(
    /^\/training\/consume-corrections\/([^/]+)\/(approve|reject)$/,
  );
  if (trainingCorrectionDecisionMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const [, correctionId, action] = trainingCorrectionDecisionMatch;
    const reason = text(data.reason);
    const decisionIdempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "冲正决策幂等键",
    );
    if (reason && (reason.length < 2 || reason.length > 300))
      throw new Error("冲正复核原因长度必须为2-300个字符");
    if (action === "reject" && !reason)
      throw new Error("驳回冲正申请必须填写原因");
    const corrections = getTrainingConsumeCorrections();
    const keyReplay = corrections.find(
      (item) => item.decisionIdempotencyKey === decisionIdempotencyKey,
    );
    if (keyReplay) {
      if (
        keyReplay.id === correctionId &&
        keyReplay.decisionAction === action
      )
        return ok(trainingCorrectionView(keyReplay));
      throw new Error("冲正决策幂等键已用于其他申请或动作");
    }
    const correction = corrections.find((item) => item.id === correctionId);
    if (!correction) throw new Error("消课冲正申请不存在");
    if (correction.status !== "REQUESTED")
      throw new Error(
        action === "approve"
          ? "只有待复核申请可以批准"
          : "只有待复核申请可以驳回",
      );
    if (correction.requestedById === mockUser().id)
      throw new Error("消课冲正申请人与复核人不能为同一账号");
    const now = new Date().toISOString();
    if (action === "reject") {
      Object.assign(correction, {
        status: "REJECTED",
        reviewReason: reason,
        reviewedById: mockUser().id,
        reviewedAt: now,
        decisionIdempotencyKey,
        decisionAction: action,
        updatedAt: now,
      });
      saveTrainingConsumeCorrections(corrections);
      return ok(trainingCorrectionView(correction));
    }

    const ledger = findMockTrainingLedger(correction.recognitionId);
    if (
      !ledger ||
      ledger.recognition.type !== "CONSUME" ||
      ledger.recognition.reversedBy
    )
      throw new Error("目标消课流水已冲正或不可冲正");
    const recognized = Number(ledger.recognition.effectiveRevenueCents || 0);
    if (
      Number(ledger.attendance.consumedSessions || 0) !== 1 ||
      Number(ledger.attendance.confirmedRevenueCents || 0) !== recognized ||
      Number(ledger.enrollment.consumedSessions || 0) < 1 ||
      Number(ledger.enrollment.confirmedRevenueCents || 0) < recognized
    )
      throw new Error("当前消课余额与待冲正流水不一致");
    const sequence =
      Math.max(
        0,
        ...(ledger.attendance.revenueRecognitions || []).map((item: any) =>
          Number(item.sequence || 0),
        ),
      ) + 1;
    const reversal = {
      id: newId("recognition-reversal"),
      attendanceId: ledger.attendance.id,
      enrollmentId: ledger.enrollment.id,
      type: "REVERSAL",
      sequence,
      reversalOfId: ledger.recognition.id,
      reversedBy: null,
      effectiveRevenueCents: -recognized,
      recognizedRevenueCents: -recognized,
      contractRateBps: Number(ledger.recognition.contractRateBps || 2_000),
      venueContributionCents: -Number(
        ledger.recognition.venueContributionCents || 0,
      ),
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      idempotencyKey: `TRAINING_REVERSAL:${decisionIdempotencyKey}`,
      createdAt: now,
    };
    const growthPointsReversed = Number(
      ledger.attendance.growthPointsAwarded || 0,
    );
    ledger.recognition.reversedBy = { ...reversal };
    ledger.attendance.revenueRecognitions = [
      ...(ledger.attendance.revenueRecognitions || []),
      reversal,
    ];
    ledger.enrollment.usedSessions = Math.max(
      0,
      Number(
        ledger.enrollment.usedSessions || ledger.enrollment.consumedSessions,
      ) - 1,
    );
    ledger.enrollment.consumedSessions = ledger.enrollment.usedSessions;
    ledger.enrollment.confirmedRevenueCents = Math.max(
      0,
      Number(ledger.enrollment.confirmedRevenueCents || 0) - recognized,
    );
    ledger.enrollment.prepaidBalanceCents =
      Number(ledger.enrollment.prepaidBalanceCents || 0) + recognized;
    if (ledger.enrollment.status === "COMPLETED")
      ledger.enrollment.status =
        Number(ledger.enrollment.refundedCents || 0) > 0
          ? "PARTIALLY_REFUNDED"
          : "ACTIVE";
    ledger.enrollment.growthPointsBalance = Math.max(
      0,
      Number(ledger.enrollment.growthPointsBalance || 0) -
        growthPointsReversed,
    );
    Object.assign(ledger.attendance, {
      status: "ATTENDED",
      consumedSessions: 0,
      confirmedRevenueCents: 0,
      growthPointsAwarded: 0,
      operatorId: null,
      consumedAt: null,
    });
    Object.assign(correction, {
      status: "APPROVED",
      reviewReason: reason || "复核同意消课冲正",
      reviewedById: mockUser().id,
      reviewedAt: now,
      reversalRecognitionId: reversal.id,
      decisionIdempotencyKey,
      decisionAction: action,
      growthPointsReversed,
      updatedAt: now,
    });
    saveEnrollments(ledger.enrollments);
    saveTrainingConsumeCorrections(corrections);
    return ok(trainingCorrectionView(correction));
  }
  const completeSessionMatch = url.match(
    /^\/training\/sessions\/([^/]+)\/complete$/,
  );
  if (completeSessionMatch && method === "POST") {
    requireMockRole("COACH", "ADMIN", "SUPER_ADMIN");
    const list = getTrainingSessions();
    const trainingSession = list.find(
      (item) => item.id === completeSessionMatch[1],
    );
    if (!trainingSession) throw new Error("培训课次不存在");
    if (trainingSession.status === "COMPLETED") return ok(trainingSession);
    if (trainingSession.status === "CANCELLED")
      throw new Error("已取消课次不能结课");
    if (
      hasMockRole("COACH") &&
      !hasMockRole("ADMIN", "SUPER_ADMIN") &&
      trainingSession.classId !== "class-adult"
    )
      throw new Error("教练只能结束自己负责班级的课次");
    const pending = getEnrollments().some((enrollment) =>
      (enrollment.attendances || []).some(
        (attendance: any) =>
          attendance.sessionId === completeSessionMatch[1] &&
          (["PENDING", "MAKEUP_REQUIRED", "LEAVE"].includes(attendance.status) ||
            (attendance.status === "ATTENDED" &&
              Number(attendance.consumedSessions || 0) === 0)),
      ),
    );
    if (pending) throw new Error("仍有学员未完成点名或消课");
    trainingSession.status = "COMPLETED";
    saveTrainingSessions(list);
    return ok(trainingSession);
  }
  if (url === "/members/me/accounts/transactions")
    return ok([
      {
        id: "tx-1",
        amount: -8800,
        reason: "场地订单支付",
        createdAt: new Date().toISOString(),
        account: { type: "CASH_PRINCIPAL" },
      },
      {
        id: "tx-2",
        amount: 500,
        reason: "活动签到奖励",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        account: { type: "BADMINTON_COIN" },
      },
    ]);
  if (url === "/members/me/referrer" && method === "POST") {
    const referrerId = text(data.referrerId);
    if (!referrerId) throw new Error("推荐人不能为空");
    const actor = mockUser();
    if (referrerId === actor.id) throw new Error("不能推荐自己");
    const users = getGovernanceUsers();
    const user = users.find((item) => item.id === actor.id);
    const referrer = users.find((item) => item.id === referrerId);
    const hasMemberIdentity = (item: any) =>
      Array.isArray(item?.roles) &&
      item.roles.some(
        (role: any) => (typeof role === "string" ? role : role?.role) === "MEMBER",
      );
    if (!user || user.status !== "ACTIVE" || !hasMemberIdentity(user))
      throw new Error("会员不存在或已停用");
    if (!referrer || referrer.status !== "ACTIVE" || !hasMemberIdentity(referrer))
      throw new Error("推荐人不存在或已停用");
    const visited = new Set<string>();
    let ancestor: any = referrer;
    while (ancestor) {
      if (ancestor.id === actor.id || visited.has(String(ancestor.id)))
        throw new Error("推荐关系不能形成闭环");
      visited.add(String(ancestor.id));
      ancestor = ancestor.referrerId
        ? users.find((item) => item.id === ancestor.referrerId)
        : null;
    }
    if (user.referrerId === referrerId)
      return ok({ id: actor.id, referrerId });
    if (user.referrerId) throw new Error("直接推荐人已绑定，不能更换");
    user.referrerId = referrerId;
    user.updatedAt = new Date().toISOString();
    saveGovernanceUsers(users);
    saveAuditLogs([{
      id: newId("audit"), actorId: actor.id,
      actor: { id: actor.id, displayName: actor.displayName }, actorRole: "MEMBER",
      action: "DIRECT_REFERRAL_BOUND", objectType: "User", objectId: actor.id,
      oldValue: { referrerId: null }, newValue: { referrerId },
      reason: "会员本人确认一层直接推荐关系",
      result: "SUCCESS", createdAt: user.updatedAt,
    }, ...getAuditLogs()]);
    return ok({ id: actor.id, referrerId });
  }
  if (url === "/referrals/me/rewards") return ok([]);
  if (url === "/referrals/rewards/grant-matured" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    return ok({ processed: 0, results: [] });
  }
  if (url === "/alliance/merchants" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const category = text(data.category);
    const level = text(data.level);
    if (code.length < 2 || name.length < 2 || category.length < 2)
      throw new Error("商户编码、名称和分类至少需要2个字符");
    if (!["TRAFFIC_PARTNER", "MEMBER_BENEFIT", "SPONSOR"].includes(level))
      throw new Error("商户等级无效");
    if (getMerchants().some((item) => text(item.code).toUpperCase() === code))
      throw new Error("商户编码已存在");
    if (!data.settlementRule || typeof data.settlementRule !== "object")
      throw new Error("商户结算规则不能为空");
    const merchant = {
      ...data,
      id: newId("merchant"),
      code,
      name,
      category,
      level,
      status: "ACTIVE",
      _count: { couponTemplates: 0, couponRedemptions: 0 },
      createdAt: new Date().toISOString(),
    };
    saveMerchants([merchant, ...getMerchants()]);
    return ok(merchant);
  }
  const merchantStatusMatch = url.match(/^\/alliance\/merchants\/([^/]+)\/status$/);
  if (merchantStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    const reason = text(data.reason);
    const requestId = requireIdempotencyKey(data.idempotencyKey, "商户状态幂等键");
    if (!["ACTIVE", "DISABLED"].includes(status))
      throw new Error("商户仅允许启用或停用，不允许删除");
    if (reason.length < 2 || reason.length > 300)
      throw new Error("状态变更原因需要2-300个字符");
    const merchants = getMerchants();
    const merchant = merchants.find((item) => item.id === merchantStatusMatch[1]);
    if (!merchant) throw new Error("商户不存在");
    if (!["ACTIVE", "DISABLED"].includes(merchant.status || "ACTIVE"))
      throw new Error("已删除商户不能重新启用或停用");
    const action = "ALLIANCE_MERCHANT_STATUS_SET";
    const commandSignature = JSON.stringify({ action, merchantId: merchant.id, status, reason });
    const replay = getAuditLogs().find((item) => item.requestId === requestId);
    if (replay) {
      if (
        replay.actorId !== mockUser().id || replay.action !== action ||
        replay.objectType !== "Merchant" || replay.objectId !== merchant.id ||
        replay.newValue?.commandSignature !== commandSignature
      )
        throw new Error("幂等键已用于其他联盟状态操作");
      return ok(merchant);
    }
    const oldStatus = merchant.status || "ACTIVE";
    merchant.status = status;
    merchant.updatedAt = new Date().toISOString();
    saveMerchants(merchants);
    saveAuditLogs([{
      id: newId("audit"), actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: hasMockRole("SUPER_ADMIN") ? "SUPER_ADMIN" : "ADMIN",
      action, objectType: "Merchant", objectId: merchant.id,
      oldValue: { status: oldStatus }, newValue: { status, commandSignature },
      reason, requestId, result: "SUCCESS", createdAt: merchant.updatedAt,
    }, ...getAuditLogs()]);
    return ok(merchant);
  }
  if (url === "/alliance/merchants") {
    // Merchant accounts are scoped to their assigned merchant.  Other
    // internal roles may use the full directory for operations and finance;
    // members only need the public partner catalogue.
    const roles = mockRoles();
    const visible = getMerchants().filter((merchant) =>
      merchantDirectoryIsScoped()
        ? merchant.id === "merchant-coffee"
        : !merchant.status ||
          merchant.status === "ACTIVE" ||
          roles.some((role) =>
            ["ADMIN", "SUPER_ADMIN", "FINANCE"].includes(role),
          ),
    );
    const full = roles.some((role) =>
      ["ADMIN", "SUPER_ADMIN", "FINANCE"].includes(role),
    );
    return ok(
      full
        ? visible
        : visible.map((merchant) => {
            const { phone, contactName, settlementRule, ...catalogue } =
              merchant;
            return catalogue;
      }),
    );
  }
  if (url === "/alliance/coupon-templates" && method === "GET") {
    requireMockRole("MERCHANT", "ADMIN", "SUPER_ADMIN");
    const templates = templateDirectoryIsScoped()
      ? getCouponTemplates().filter((item) => item.merchantId === "merchant-coffee")
      : getCouponTemplates();
    return ok(
      templates
        .map((item: any) => ({
          ...item,
          merchant:
            item.merchant || getMerchants().find((merchant) => merchant.id === item.merchantId),
        }))
        .sort(
          (left: any, right: any) =>
            Number(Boolean(right.enabled)) - Number(Boolean(left.enabled)) ||
            new Date(right.validTo).getTime() - new Date(left.validTo).getTime(),
        ),
    );
  }
  if (url === "/alliance/coupon-templates" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const merchantId = text(data.merchantId);
    const merchant = getMerchants().find((item) => item.id === merchantId);
    if (!merchant) throw new Error("商户不存在");
    if (merchant.status && merchant.status !== "ACTIVE")
      throw new Error("停用商户不能创建券模板");
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const activityName = text(data.activityName);
    const benefitDescription = text(data.benefitDescription);
    if (
      code.length < 2 ||
      name.length < 2 ||
      activityName.length < 2 ||
      benefitDescription.length < 2
    )
      throw new Error("券模板编码、名称、活动和权益说明至少需要2个字符");
    if (getCouponTemplates().some((item) => text(item.code).toUpperCase() === code))
      throw new Error("券模板编码已存在");
    const validFrom = new Date(String(data.validFrom || ""));
    const validTo = new Date(String(data.validTo || ""));
    if (
      Number.isNaN(validFrom.getTime()) ||
      Number.isNaN(validTo.getTime()) ||
      validTo <= validFrom
    )
      throw new Error("券有效期设置无效");
    const faceValueCents = integer(data.faceValueCents ?? 0);
    const claimLimitPerUser = integer(data.claimLimitPerUser ?? 1);
    const issueLimit =
      integer(data.issueLimit) && Number(data.issueLimit) > 0
        ? Number(data.issueLimit) : NaN;
    if (faceValueCents < 0) throw new Error("券面值不能为负数");
    if (claimLimitPerUser < 1 || claimLimitPerUser > 100)
      throw new Error("每人领取上限必须为1-100");
    if (issueLimit < 1 || issueLimit > 100000)
      throw new Error("发行上限必须为1-100000");
    const template = {
      ...data,
      id: newId("coupon-template"),
      code,
      name,
      activityName,
      benefitDescription,
      merchantId,
      merchant,
      enabled: data.enabled !== false,
      validFrom: validFrom.toISOString(),
      validTo: validTo.toISOString(),
      faceValueCents,
      claimLimitPerUser,
      issueLimit,
      issuedCount: 0,
      claimedCount: 0,
      redeemedCount: 0,
    };
    saveCouponTemplates([template, ...getCouponTemplates()]);
    return ok(template);
  }
  const templateStatusMatch = url.match(
    /^\/alliance\/coupon-templates\/([^/]+)\/status$/,
  );
  if (templateStatusMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    if (typeof data.enabled !== "boolean") throw new Error("券模板启停状态无效");
    const enabled = data.enabled;
    const reason = text(data.reason);
    const requestId = requireIdempotencyKey(data.idempotencyKey, "券模板状态幂等键");
    if (reason.length < 2 || reason.length > 300)
      throw new Error("状态变更原因需要2-300个字符");
    const templates = getCouponTemplates();
    const template = templates.find((item) => item.id === templateStatusMatch[1]);
    if (!template) throw new Error("券模板不存在");
    const merchant = getMerchants().find((item) => item.id === template.merchantId);
    const action = "ALLIANCE_COUPON_TEMPLATE_STATUS_SET";
    const commandSignature = JSON.stringify({ action, templateId: template.id, enabled, reason });
    const replay = getAuditLogs().find((item) => item.requestId === requestId);
    if (replay) {
      if (
        replay.actorId !== mockUser().id || replay.action !== action ||
        replay.objectType !== "CouponTemplate" || replay.objectId !== template.id ||
        replay.newValue?.commandSignature !== commandSignature
      )
        throw new Error("幂等键已用于其他联盟状态操作");
      return ok(template);
    }
    if (enabled && merchant?.status && merchant.status !== "ACTIVE")
      throw new Error("停用商户的券模板不能启用");
    const oldEnabled = template.enabled !== false;
    template.enabled = enabled;
    template.updatedAt = new Date().toISOString();
    saveCouponTemplates(templates);
    saveAuditLogs([{
      id: newId("audit"), actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: hasMockRole("SUPER_ADMIN") ? "SUPER_ADMIN" : "ADMIN",
      action, objectType: "CouponTemplate", objectId: template.id,
      oldValue: { enabled: oldEnabled }, newValue: { enabled, commandSignature },
      reason, requestId, result: "SUCCESS", createdAt: template.updatedAt,
    }, ...getAuditLogs()]);
    return ok(template);
  }
  const generateCodesMatch = url.match(
    /^\/alliance\/coupon-templates\/([^/]+)\/codes$/,
  );
  if (generateCodesMatch && method === "POST") {
    requireMockRole("MERCHANT", "ADMIN", "SUPER_ADMIN");
    const templates = getCouponTemplates();
    const template = templates.find(
      (item) => item.id === generateCodesMatch[1],
    );
    if (!template) throw new Error("券模板不存在");
    if (!merchantCanManage(template.merchantId))
      throw new Error("只能操作本商户的券码");
    const requested = integer(data.quantity ?? data.count);
    if (!Number.isInteger(requested) || requested < 1 || requested > 2000)
      throw new Error("生成数量必须为1-2000");
    const requestId = requireIdempotencyKey(data.idempotencyKey, "批量发券幂等键");
    const action = "COUPON_CODES_GENERATED";
    const commandHash = creationCommandHash({
      kind: action,
      templateId: template.id,
      count: requested,
    });
    const replay = getAuditLogs().find((item) => item.requestId === requestId);
    if (replay) {
      if (
        replay.actorId !== mockUser().id || replay.action !== action ||
        replay.objectType !== "CouponTemplate" || replay.objectId !== template.id ||
        replay.newValue?.commandHash !== commandHash
      )
        throw new Error("幂等键已用于其他联盟操作");
      const replayCodes = Array.isArray(replay.newValue?.codes)
        ? replay.newValue.codes.filter((code: unknown) => typeof code === "string")
        : [];
      if (replayCodes.length !== requested)
        throw new Error("发行命令回放数据不完整，请联系管理员");
      return ok({
        templateId: template.id,
        generated: requested,
        count: requested,
        codes: replayCodes,
      });
    }
    if (template.enabled === false)
      throw new Error("券模板不存在或已下线");
    const templateMerchant = getMerchants().find(
      (item) => item.id === template.merchantId,
    );
    if (templateMerchant?.status && templateMerchant.status !== "ACTIVE")
      throw new Error("商户已停用");
    if (isExpired(template.validTo)) throw new Error("券模板已过期");
    if (
      Number(template.issuedCount || 0) + requested >
      Number(template.issueLimit || 2000)
    )
      throw new Error("生成数量超过模板发行上限");
    const existingCodes = new Set(getCoupons().map((item) => item.code));
    const batchToken = creationCommandHash({ requestId }).toUpperCase();
    const generated = Array.from({ length: requested }, (_, index) => {
      const code = `YQ-${batchToken}-${String(index + 1).padStart(4, "0")}`;
      if (existingCodes.has(code))
        throw new Error("发行命令与已有券码冲突，请刷新后重试");
      existingCodes.add(code);
      return {
        id: newId("coupon"),
        code,
        status: "ISSUED",
        templateId: template.id,
        merchantId: template.merchantId,
        expiresAt: template.validTo,
        template: {
          ...template,
          merchant:
            template.merchant ||
            getMerchants().find((item) => item.id === template.merchantId),
        },
      };
    });
    template.issuedCount = Number(template.issuedCount || 0) + requested;
    saveCouponTemplates(templates);
    saveCoupons([...generated, ...getCoupons()]);
    const generatedCodes = generated.map((item) => item.code);
    saveAuditLogs([{
      id: newId("audit"), actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: mockRoles()[0], action, objectType: "CouponTemplate",
      objectId: template.id,
      oldValue: { issuedCount: Number(template.issuedCount) - requested },
      newValue: { commandHash, count: requested, codes: generatedCodes },
      requestId, result: "SUCCESS", createdAt: new Date().toISOString(),
    }, ...getAuditLogs()]);
    return ok({
      templateId: template.id,
      generated: requested,
      count: requested,
      codes: generatedCodes,
    });
  }
  if (url === "/alliance/coupons/me")
    return ok(
      getCoupons().filter((coupon) => coupon.holderId === mockUser().id),
    );
  const claimCouponMatch = url.match(/^\/alliance\/coupons\/([^/]+)\/claim$/);
  if (claimCouponMatch && method === "POST") {
    const list = getCoupons();
    const coupon = list.find((item) => item.code === claimCouponMatch[1]);
    if (!coupon) throw new Error("券码不存在或已被领取");
    if (coupon.status === "CLAIMED" && coupon.holderId === mockUser().id)
      return ok(coupon);
    if (!["ISSUED", "AVAILABLE"].includes(coupon.status))
      throw new Error("券码不存在或已被领取");
    const template = couponTemplate(coupon);
    if (
      template?.enabled === false ||
      isExpired(template?.validTo) ||
      isExpired(coupon.expiresAt)
    )
      throw new Error("券活动未开始或已结束");
    const claimedByUser = list.filter(
      (item) =>
        item.holderId === mockUser().id &&
        ["CLAIMED", "REDEEMED"].includes(item.status) &&
        (item.templateId === coupon.templateId ||
          (coupon.templateId === undefined &&
            couponTemplate(item)?.merchant?.id ===
              couponTemplate(coupon)?.merchant?.id)),
    ).length;
    if (
      template?.claimLimitPerUser &&
      claimedByUser >= Number(template.claimLimitPerUser)
    )
      throw new Error("超过每人领取上限");
    Object.assign(coupon, {
      status: "CLAIMED",
      holderId: mockUser().id,
      claimedAt: new Date().toISOString(),
    });
    coupon.merchantId = couponMerchantId(coupon);
    saveCoupons(list);
    return ok(coupon);
  }
  if (url === "/alliance/coupons/redeem" && method === "POST") {
    requireMockRole("MERCHANT", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const list = getCoupons();
    const coupon = list.find((item) => item.code === data.code);
    if (!coupon) throw new Error("券码不存在");
    const merchantId = text(data.merchantId);
    if (!merchantId || !merchantCanRedeem(merchantId))
      throw new Error("只能操作本商户的券码");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "券核销幂等键",
    );
    const amountCents = integer(data.attributedAmountCents)
      ? Number(data.attributedAmountCents)
      : Number(data.attributedAmountCents || 0);
    if (!Number.isInteger(amountCents) || amountCents < 0)
      throw new Error("成交金额必须为非负整数");
    const existingByKey = list.find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    if (existingByKey) {
      if (existingByKey.code !== coupon.code)
        throw new Error("券核销幂等键已用于其他券码");
      if (existingByKey.redeemedMerchantId !== merchantId)
        throw new Error("券核销幂等键已用于其他商户");
      if (Number(existingByKey.attributedAmountCents || 0) !== amountCents)
        throw new Error("券核销幂等键已用于不同成交金额");
      return ok(existingByKey);
    }
    if (
      coupon.idempotencyKey === idempotencyKey &&
      coupon.status === "REDEEMED"
    )
      return ok(coupon);
    const merchant = getMerchants().find((item) => item.id === merchantId);
    if (!merchant) throw new Error("商户不存在");
    if (merchant.status && merchant.status !== "ACTIVE")
      throw new Error("商户已停用，不能核销券码");
    if (coupon.status !== "CLAIMED")
      throw new Error("券码未领取、已核销或已失效");
    if (
      isExpired(coupon.expiresAt) ||
      isExpired(couponTemplate(coupon)?.validTo)
    )
      throw new Error("券码已过期");
    const ownedMerchantId = couponMerchantId(coupon);
    if (ownedMerchantId && ownedMerchantId !== merchantId)
      throw new Error("券码不属于本商户");
    Object.assign(coupon, {
      status: "REDEEMED",
      redeemedMerchantId: merchantId,
      redeemedById: mockUser().id,
      redeemedAt: new Date().toISOString(),
      attributedAmountCents: amountCents,
      idempotencyKey,
    });
    coupon.merchantId = ownedMerchantId || merchantId;
    if (merchant?._count)
      merchant._count.couponRedemptions =
        Number(merchant._count.couponRedemptions || 0) + 1;
    saveMerchants(getMerchants());
    saveCoupons(list);
    return ok(coupon);
  }
  const couponQrMatch = url.match(/^\/alliance\/coupons\/([^/]+)\/qr$/);
  if (couponQrMatch && method === "GET") {
    const coupon = getCoupons().find((item) => item.code === couponQrMatch[1]);
    if (!coupon) throw new Error("券码不存在");
    if (
      coupon.holderId !== mockUser().id &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN") &&
      !merchantCanManage(couponMerchantId(coupon))
    )
      throw new Error("无权查看该券码");
    return ok({
      code: couponQrMatch[1],
      qrDataUrl: `mock://coupon/${couponQrMatch[1]}`,
    });
  }
  if (url === "/memberships/products") return ok(membershipProducts);
  if (url === "/memberships/purchase" && method === "POST") {
    const productId = text(data.productId);
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "MEMBERSHIP_PURCHASE",
      productId,
    });
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const product = membershipProducts.find((item) => item.id === productId);
    if (!product) throw new Error("会员产品不存在或已下架");
    const now = new Date();
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("MB"),
      title: product.name,
      status: "PENDING",
      businessType: "MEMBERSHIP",
      listAmountCents: product.priceCents,
      payableCents: product.priceCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt: now.toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: {
        productId: product.id,
        level: product.level,
        durationDays: product.durationDays,
        benefits: product.benefits,
      },
      membership: {
        status: "FROZEN",
        startsAt: now.toISOString(),
        endsAt: new Date(
          now.getTime() + product.durationDays * 86_400_000,
        ).toISOString(),
      },
    };
    saveOrders([order, ...getOrders()]);
    return finishMockOrderCreation(creation, order);
  }
  if (url === "/memberships/recharge" && method === "POST") {
    const principalCents = integer(data.principalCents);
    const giftCents = data.giftCents === undefined ? 0 : integer(data.giftCents);
    if (!Number.isFinite(principalCents) || principalCents < 100)
      throw new Error("充值本金至少为1元");
    if (!Number.isFinite(giftCents) || giftCents < 0)
      throw new Error("赠送余额不能为负数");
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "RECHARGE",
      principalCents,
      giftCents,
    });
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("RC"),
      title: `会员充值 ¥${(principalCents / 100).toFixed(2)}`,
      status: "PENDING",
      businessType: "RECHARGE",
      listAmountCents: principalCents,
      payableCents: principalCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: { principalCents, giftCents },
    };
    saveOrders([order, ...getOrders()]);
    return finishMockOrderCreation(creation, order);
  }
  if (url === "/goods") return ok(getGoods());
  if (url === "/inventory") {
    requireMockRole(
      "FRONT_DESK",
      "COACH",
      "EVENT_MANAGER",
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    );
    return ok(getGoods());
  }
  if (url === "/inventory/low-stock") {
    requireMockRole(
      "FRONT_DESK",
      "COACH",
      "EVENT_MANAGER",
      "FINANCE",
      "ADMIN",
      "SUPER_ADMIN",
    );
    return ok(getGoods().filter((item) => item.stock <= item.safeStock));
  }
  if (url === "/inventory/suppliers" && method === "GET") {
    requireInventoryRead();
    return ok(getInventorySuppliers());
  }
  if (url === "/inventory/locations" && method === "GET") {
    requireInventoryRead();
    return ok(getInventoryLocations());
  }
  if (url === "/inventory/purchase-orders" && method === "GET") {
    requireInventoryRead();
    return ok(getPurchaseOrders());
  }
  if (url === "/inventory/purchase-orders" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const supplier = getInventorySuppliers().find(
      (entry) => entry.id === text(data.supplierId) && entry.enabled !== false,
    );
    const inputLines = Array.isArray(data.lines) ? data.lines : [];
    if (!supplier || !inputLines.length)
      throw new Error("供应商不存在或采购明细为空");
    const goods = getGoods();
    const locations = getInventoryLocations();
    const lines = inputLines.map((line: any) => {
      const item = goods.find((entry) => entry.id === text(line.itemId));
      const location = locations.find(
        (entry) =>
          entry.id === text(line.locationId) && entry.enabled !== false,
      );
      const quantity = integer(line.orderedQuantity);
      if (!item || !location || quantity < 1)
        throw new Error("采购商品、库位或数量无效");
      return {
        id: newId("po-line"),
        itemId: item.id,
        item,
        locationId: location.id,
        location,
        orderedQuantity: quantity,
        receivedQuantity: 0,
        unitCostCents: integer(line.unitCostCents),
        batchCode: text(line.batchCode) || "DEFAULT",
        expiresAt: line.expiresAt || null,
      };
    });
    const keys = lines.map(
      (line: any) => `${line.itemId}:${line.locationId}:${line.batchCode}`,
    );
    if (new Set(keys).size !== keys.length) throw new Error("采购明细不能重复");
    const order = {
      id: newId("po"),
      orderNo: newOrderNo("PO"),
      status: "DRAFT",
      supplierId: supplier.id,
      supplier,
      lines,
      receipts: [],
      createdById: mockUser().id,
      createdAt: new Date().toISOString(),
      remark: text(data.remark) || null,
    };
    savePurchaseOrders([order, ...getPurchaseOrders()]);
    return ok(order);
  }
  const purchaseAction = url.match(
    /^\/inventory\/purchase-orders\/([^/]+)\/(submit|approve|receive|cancel)$/,
  );
  if (purchaseAction && method === "POST") {
    const orders = getPurchaseOrders();
    const order = orders.find((entry) => entry.id === purchaseAction[1]);
    if (!order) throw new Error("采购单不存在");
    const action = purchaseAction[2];
    if (action === "submit") {
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
      if (order.status !== "DRAFT" && order.status !== "SUBMITTED")
        throw new Error("当前采购单不能提交");
      Object.assign(order, {
        status: "SUBMITTED",
        submittedById: mockUser().id,
        submittedAt: new Date().toISOString(),
      });
    } else if (action === "approve") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (order.status !== "SUBMITTED" && order.status !== "APPROVED")
        throw new Error("只有已提交采购单可以审批");
      if (
        order.status === "SUBMITTED" &&
        (order.createdById === mockUser().id ||
          order.submittedById === mockUser().id)
      )
        throw new Error("采购制单/提交人与审批人不能为同一账号");
      Object.assign(order, {
        status: "APPROVED",
        approvedById: mockUser().id,
        approvedAt: new Date().toISOString(),
      });
    } else if (action === "cancel") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (
        !["DRAFT", "SUBMITTED", "APPROVED", "CANCELLED"].includes(order.status)
      )
        throw new Error("已收货采购单不能取消");
      Object.assign(order, {
        status: "CANCELLED",
        cancelReason: text(data.reason),
        cancelledAt: new Date().toISOString(),
      });
    } else {
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
      if (!["APPROVED", "PARTIAL_RECEIVED"].includes(order.status))
        throw new Error("采购单未审批或已完成，不能收货");
      const key = requireIdempotencyKey(data.idempotencyKey, "收货幂等键");
      const previous = (order.receipts || []).find(
        (entry: any) => entry.idempotencyKey === key,
      );
      if (previous) return ok(previous);
      const receiptLines = Array.isArray(data.lines) ? data.lines : [];
      if (
        !receiptLines.length ||
        new Set(receiptLines.map((entry: any) => entry.lineId)).size !==
          receiptLines.length
      )
        throw new Error("收货明细为空或重复");
      const goods = getGoods();
      const balances = getInventoryBalances();
      for (const input of receiptLines) {
        const line = order.lines.find(
          (entry: any) => entry.id === text(input.lineId),
        );
        const quantity = integer(input.quantity);
        if (
          !line ||
          quantity < 1 ||
          quantity > line.orderedQuantity - line.receivedQuantity
        )
          throw new Error("收货数量超过采购未收数量");
        const item = goods.find((entry) => entry.id === line.itemId);
        if (!item) throw new Error("库存商品不存在");
        let balance = balances.find(
          (entry) =>
            entry.itemId === line.itemId &&
            entry.locationId === line.locationId &&
            entry.batchCode === line.batchCode,
        );
        if (!balance) {
          balance = {
            id: newId("balance"),
            itemId: line.itemId,
            locationId: line.locationId,
            batchCode: line.batchCode,
            quantity: 0,
          };
          balances.push(balance);
        }
        item.stock = Number(item.stock || 0) + quantity;
        balance.quantity += quantity;
        line.receivedQuantity += quantity;
      }
      const receipt = {
        id: newId("receipt"),
        receiptNo: newOrderNo("PR"),
        purchaseOrderId: order.id,
        lines: receiptLines,
        idempotencyKey: key,
        operatorId: mockUser().id,
        receivedAt: new Date().toISOString(),
      };
      order.receipts = [receipt, ...(order.receipts || [])];
      order.status = order.lines.every(
        (line: any) => line.receivedQuantity >= line.orderedQuantity,
      )
        ? "RECEIVED"
        : "PARTIAL_RECEIVED";
      saveGoods(goods);
      saveInventoryBalances(balances);
      savePurchaseOrders(orders);
      return ok(receipt);
    }
    savePurchaseOrders(orders);
    return ok(order);
  }
  if (url === "/inventory/stocktakes" && method === "GET") {
    requireInventoryRead();
    return ok(getStocktakes());
  }
  if (url === "/inventory/stocktakes" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const location = getInventoryLocations().find(
      (entry) => entry.id === text(data.locationId) && entry.enabled !== false,
    );
    if (!location || text(data.reason).length < 2)
      throw new Error("盘点库位或原因无效");
    const stocktake = {
      id: newId("stocktake"),
      stocktakeNo: newOrderNo("ST"),
      status: "DRAFT",
      locationId: location.id,
      location,
      reason: text(data.reason),
      lines: [],
      createdById: mockUser().id,
      createdAt: new Date().toISOString(),
    };
    saveStocktakes([stocktake, ...getStocktakes()]);
    return ok(stocktake);
  }
  const stocktakeCount = url.match(
    /^\/inventory\/stocktakes\/([^/]+)\/lines\/([^/]+)\/count$/,
  );
  if (stocktakeCount && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const list = getStocktakes();
    const stocktake = list.find((entry) => entry.id === stocktakeCount[1]);
    const line = stocktake?.lines.find(
      (entry: any) => entry.id === stocktakeCount[2],
    );
    const counted = integer(data.countedQuantity);
    if (!stocktake || stocktake.status !== "COUNTING" || !line || counted < 0)
      throw new Error("盘点单不在录数状态或数量无效");
    Object.assign(line, {
      countedQuantity: counted,
      difference: counted - line.bookQuantity,
    });
    saveStocktakes(list);
    return ok(line);
  }
  const stocktakeAction = url.match(
    /^\/inventory\/stocktakes\/([^/]+)\/(start|submit|post)$/,
  );
  if (stocktakeAction && method === "POST") {
    const list = getStocktakes();
    const stocktake = list.find((entry) => entry.id === stocktakeAction[1]);
    if (!stocktake) throw new Error("盘点单不存在");
    const action = stocktakeAction[2];
    if (action === "start") {
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
      if (stocktake.status !== "DRAFT" && stocktake.status !== "COUNTING")
        throw new Error("当前盘点单不能开始");
      if (stocktake.status === "DRAFT") {
        const balances = getInventoryBalances();
        const goods = getGoods();
        stocktake.lines = goods.flatMap((item) => {
          const itemBalances = balances.filter(
            (entry) =>
              entry.itemId === item.id &&
              entry.locationId === stocktake.locationId,
          );
          const snapshots = itemBalances.length
            ? itemBalances
            : [{ batchCode: "DEFAULT", quantity: 0, expiresAt: null }];
          return snapshots.map((balance) => ({
            id: newId("stocktake-line"),
            itemId: item.id,
            item,
            batchCode: balance.batchCode || "DEFAULT",
            expiresAt: balance.expiresAt || null,
            bookQuantity: Number(balance.quantity || 0),
            countedQuantity: null,
            difference: null,
          }));
        });
        Object.assign(stocktake, {
          status: "COUNTING",
          startedAt: new Date().toISOString(),
        });
      }
    } else if (action === "submit") {
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
      if (
        stocktake.status !== "COUNTING" ||
        stocktake.lines.some((line: any) => line.countedQuantity === null)
      )
        throw new Error("仍有盘点明细未录入");
      Object.assign(stocktake, {
        status: "REVIEW",
        submittedById: mockUser().id,
        submittedAt: new Date().toISOString(),
      });
    } else {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      const key = requireIdempotencyKey(data.idempotencyKey, "盘点过账幂等键");
      if (stocktake.status === "POSTED") {
        if (stocktake.postIdempotencyKey !== key)
          throw new Error("盘点单已过账");
        return ok(stocktake);
      }
      if (stocktake.status !== "REVIEW") throw new Error("盘点单尚未提交复核");
      if (
        stocktake.createdById === mockUser().id ||
        stocktake.submittedById === mockUser().id
      )
        throw new Error("盘点制单/提交人与过账审批人不能为同一账号");
      const goods = getGoods();
      const balances = getInventoryBalances();
      for (const line of stocktake.lines) {
        const balance = balances.find(
          (entry) =>
            entry.itemId === line.itemId &&
            entry.locationId === stocktake.locationId &&
            entry.batchCode === line.batchCode,
        );
        if (Number(balance?.quantity || 0) !== line.bookQuantity)
          throw new Error("盘点期间库存已变化");
        const item = goods.find((entry) => entry.id === line.itemId);
        const difference = line.countedQuantity - line.bookQuantity;
        if (!item || Number(item.stock) + difference < 0)
          throw new Error("盘点差异会导致库存为负");
        item.stock += difference;
        if (balance) balance.quantity = line.countedQuantity;
      }
      Object.assign(stocktake, {
        status: "POSTED",
        postIdempotencyKey: key,
        reviewedById: mockUser().id,
        postedById: mockUser().id,
        postedAt: new Date().toISOString(),
      });
      saveGoods(goods);
      saveInventoryBalances(balances);
    }
    saveStocktakes(list);
    return ok(stocktake);
  }
  if (url === "/inventory/operations" && method === "GET") {
    requireInventoryRead();
    return ok(getInventoryOperations());
  }
  if (url === "/inventory/operations" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const item = getGoods().find((entry) => entry.id === text(data.itemId));
    const locations = getInventoryLocations();
    const source = locations.find(
      (entry) => entry.id === text(data.sourceLocationId),
    );
    const target = locations.find(
      (entry) => entry.id === text(data.targetLocationId),
    );
    const type = text(data.type);
    const quantity = integer(data.quantity);
    if (
      !item ||
      !source ||
      !["TRANSFER", "LOSS"].includes(type) ||
      quantity < 1 ||
      text(data.reason).length < 2 ||
      (type === "TRANSFER" && (!target || target.id === source.id)) ||
      (type === "LOSS" && target)
    )
      throw new Error("调拨/报损单参数无效");
    const operation = {
      id: newId("inventory-op"),
      documentNo: newOrderNo(type === "TRANSFER" ? "TR" : "LS"),
      status: "DRAFT",
      type,
      itemId: item.id,
      item,
      quantity,
      sourceLocationId: source.id,
      sourceLocation: source,
      targetLocationId: target?.id || null,
      targetLocation: target || null,
      batchCode: text(data.batchCode) || "DEFAULT",
      reason: text(data.reason),
      referenceType: text(data.referenceType) || null,
      referenceId: text(data.referenceId) || null,
      createdById: mockUser().id,
      createdAt: new Date().toISOString(),
    };
    saveInventoryOperations([operation, ...getInventoryOperations()]);
    return ok(operation);
  }
  const operationAction = url.match(
    /^\/inventory\/operations\/([^/]+)\/(submit|approve|post|cancel)$/,
  );
  if (operationAction && method === "POST") {
    const list = getInventoryOperations();
    const operation = list.find((entry) => entry.id === operationAction[1]);
    if (!operation) throw new Error("库存业务单不存在");
    const action = operationAction[2];
    if (action === "submit") {
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
      if (!["DRAFT", "SUBMITTED"].includes(operation.status))
        throw new Error("业务单不能提交");
      Object.assign(operation, {
        status: "SUBMITTED",
        submittedAt: new Date().toISOString(),
      });
    } else if (action === "approve") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (!["SUBMITTED", "APPROVED"].includes(operation.status))
        throw new Error("业务单尚未提交");
      if (
        operation.status === "SUBMITTED" &&
        operation.createdById === mockUser().id
      )
        throw new Error("库存业务制单人与审批人不能为同一账号");
      Object.assign(operation, {
        status: "APPROVED",
        approvedById: mockUser().id,
        approvedAt: new Date().toISOString(),
      });
    } else if (action === "cancel") {
      requireMockRole("ADMIN", "SUPER_ADMIN");
      if (operation.status === "POSTED")
        throw new Error("已过账业务单不能取消");
      Object.assign(operation, {
        status: "CANCELLED",
        cancelReason: text(data.reason),
      });
    } else {
      requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
      const key = requireIdempotencyKey(
        data.idempotencyKey,
        "业务单过账幂等键",
      );
      if (operation.status === "POSTED") {
        if (operation.postIdempotencyKey !== key)
          throw new Error("业务单已过账");
        return ok(operation);
      }
      if (operation.status !== "APPROVED") throw new Error("业务单尚未审批");
      const goods = getGoods();
      const item = goods.find((entry) => entry.id === operation.itemId);
      const balances = getInventoryBalances();
      const source = balances.find(
        (entry) =>
          entry.itemId === operation.itemId &&
          entry.locationId === operation.sourceLocationId &&
          entry.batchCode === operation.batchCode,
      );
      if (!item || !source || source.quantity < operation.quantity)
        throw new Error("来源库位库存不足");
      source.quantity -= operation.quantity;
      if (operation.type === "TRANSFER") {
        let target = balances.find(
          (entry) =>
            entry.itemId === operation.itemId &&
            entry.locationId === operation.targetLocationId &&
            entry.batchCode === operation.batchCode,
        );
        if (!target) {
          target = {
            id: newId("balance"),
            itemId: operation.itemId,
            locationId: operation.targetLocationId,
            batchCode: operation.batchCode,
            quantity: 0,
          };
          balances.push(target);
        }
        target.quantity += operation.quantity;
      } else {
        item.stock -= operation.quantity;
      }
      Object.assign(operation, {
        status: "POSTED",
        postIdempotencyKey: key,
        postedById: mockUser().id,
        postedAt: new Date().toISOString(),
      });
      saveGoods(goods);
      saveInventoryBalances(balances);
    }
    saveInventoryOperations(list);
    return ok(operation);
  }
  if (url === "/goods/orders" && method === "POST") {
    if (!Array.isArray(data.items) || !data.items.length)
      throw new Error("商品订单不能为空");
    const quantities = new Map<string, number>();
    for (const rawItem of data.items) {
      const itemId = text(rawItem?.itemId);
      const quantity = integer(rawItem?.quantity);
      if (!itemId || !Number.isFinite(quantity) || quantity < 1 || quantity > 100)
        throw new Error("商品和数量无效");
      quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
    }
    const commandItems = [...quantities.entries()]
      .map(([itemId, quantity]) => ({ itemId, quantity }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId));
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "GOODS_ORDER",
      items: commandItems,
    });
    if (creation.tracked && creation.replayed) return ok(creation.response);
    const products = getGoods().filter((item) => quantities.has(item.id));
    if (products.length !== quantities.size)
      throw new Error("部分商品不存在或已下架");
    const items = products.map((product) => {
      const quantity = quantities.get(product.id)!;
      if (Number(product.stock || 0) < quantity)
        throw new Error(`${product.name} 库存不足`);
      return {
        itemType: "INVENTORY_GOODS",
        itemId: product.id,
        name: product.name,
        quantity,
        unitPriceCents: product.salePriceCents,
        amountCents: product.salePriceCents * quantity,
      };
    });
    const amount = items.reduce((sum, item) => sum + item.amountCents, 0);
    const order = {
      id: newId("order"),
      orderNo: newOrderNo("GD"),
      title: `场馆商品 ${items.length} 种`,
      status: "PENDING",
      businessType: "GOODS",
      listAmountCents: amount,
      payableCents: amount,
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      items,
      parameterSnapshot: { pricing: "SERVER_SNAPSHOT", itemCount: items.length },
    };
    saveOrders([order, ...getOrders()]);
    return finishMockOrderCreation(creation, order);
  }
  const inventoryMatch = url.match(/^\/inventory\/([^/]+)\/transactions$/);
  if (inventoryMatch && method === "POST") {
    requireMockRole(
      "FRONT_DESK",
      "COACH",
      "EVENT_MANAGER",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const list = getGoods();
    const item = list.find((entry) => entry.id === inventoryMatch[1]);
    if (!item) throw new Error("库存商品不存在");
    const type = text(data.type);
    const validTypes = [
      "PURCHASE_IN",
      "CONSIGNMENT_IN",
      "SALE_OUT",
      "TRAINING_USAGE",
      "EVENT_USAGE",
      "ADJUSTMENT",
      "RETURN_OUT",
      "STOCKTAKE",
    ];
    if (!validTypes.includes(type)) throw new Error("库存变动类型无效");
    const allowed =
      type === "TRAINING_USAGE"
        ? ["COACH", "ADMIN", "SUPER_ADMIN"]
        : type === "EVENT_USAGE"
          ? ["EVENT_MANAGER", "ADMIN", "SUPER_ADMIN"]
          : ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"];
    requireMockRole(...(allowed as AppRole[]));
    const idempotency = requireIdempotencyKey(
      data.idempotencyKey,
      "库存幂等键",
    );
    const transactions = getInventoryTransactions();
    const previous = transactions.find(
      (entry) => entry.idempotencyKey === idempotency,
    );
    if (previous) {
      if (
        previous.itemId !== item.id ||
        previous.type !== type ||
        Number(previous.quantity) !== Number(data.quantity)
      )
        throw new Error("库存幂等键已用于其他库存动作");
      return ok(previous);
    }
    const quantity = Number(data.quantity);
    if (!Number.isInteger(quantity) || quantity === 0)
      throw new Error("库存数量必须为非零整数");
    if (["PURCHASE_IN", "CONSIGNMENT_IN"].includes(type) && quantity < 0)
      throw new Error("入库数量必须为正数");
    if (
      ["SALE_OUT", "TRAINING_USAGE", "EVENT_USAGE", "RETURN_OUT"].includes(
        type,
      ) &&
      quantity > 0
    )
      throw new Error("出库数量必须为负数");
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("库存变动原因不能为空");
    if (
      ["TRAINING_USAGE", "EVENT_USAGE"].includes(type) &&
      (!text(data.referenceId) || !text(data.referenceType))
    )
      throw new Error("培训或赛事领用必须关联业务单据");
    if (
      data.unitCostCents !== undefined &&
      (!Number.isInteger(Number(data.unitCostCents)) ||
        Number(data.unitCostCents) < 0)
    )
      throw new Error("单位成本必须为非负整数");
    const nextStock = Number(item.stock || 0) + quantity;
    if (nextStock < 0) throw new Error("库存不足");
    const transaction = {
      id: newId("stock-tx"),
      itemId: item.id,
      type,
      quantity,
      stockBefore: item.stock,
      stockAfter: nextStock,
      unitCostCents: data.unitCostCents,
      reason,
      idempotencyKey: idempotency,
      metadata: {
        ...(data.metadata || {}),
        ...(data.referenceId ? { referenceId: data.referenceId } : {}),
        ...(data.referenceType ? { referenceType: data.referenceType } : {}),
        operatorId: mockUser().id,
      },
    };
    item.stock = nextStock;
    saveGoods(list);
    saveInventoryTransactions([transaction, ...transactions]);
    return ok(transaction);
  }
  if (url === "/members/account-adjustments" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const status = text(data.status);
    if (
      status &&
      !["REQUESTED", "POSTED", "REJECTED"].includes(status)
    )
      throw new Error("账户调整状态无效");
    const requests = getAccountAdjustmentRequests()
      .filter((request) => !status || request.status === status)
      .sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      )
      .map(accountAdjustmentView);
    return ok(requests);
  }

  const accountAdjustmentCreateMatch = url.match(
    /^\/members\/([^/]+)\/accounts\/adjust$/,
  );
  if (accountAdjustmentCreateMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const memberId = accountAdjustmentCreateMatch[1];
    const accountType = text(data.accountType);
    const amount = integer(data.amount);
    const reason = text(data.reason);
    const idempotencyKey = requireIdempotencyKey(data.idempotencyKey);
    if (!Number.isSafeInteger(amount) || amount === 0)
      throw new Error("调整金额不能为 0");
    if (reason.length < 2 || reason.length > 200)
      throw new Error("调整原因至少需要2个字符且不能超过200个字符");
    const memberAccounts = getMemberAccounts();
    const account = (memberAccounts[memberId] || []).find(
      (item) => item.type === accountType,
    );
    if (!account) throw new Error("账户不存在");
    const commandHash = creationCommandHash({
      version: 1,
      userId: memberId,
      accountType,
      amount,
      reason,
    });
    const requests = getAccountAdjustmentRequests();
    const existing = requests.find(
      (request) => request.requestIdempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (
        existing.requestedById !== mockUser().id ||
        existing.accountId !== account.id ||
        existing.commandHash !== commandHash
      )
        throw new Error("幂等键已用于不同的账户调整申请");
      return ok(accountAdjustmentView(existing));
    }
    const now = new Date().toISOString();
    const request = {
      id: newId("account-adjustment"),
      accountId: account.id,
      amount,
      reason,
      status: "REQUESTED",
      requestedById: mockUser().id,
      reviewedById: null,
      requestIdempotencyKey: idempotencyKey,
      commandHash,
      reviewReason: null,
      transactionId: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    saveAccountAdjustmentRequests([request, ...requests]);
    return ok(accountAdjustmentView(request));
  }

  const accountAdjustmentReviewMatch = url.match(
    /^\/members\/account-adjustments\/([^/]+)\/(approve|reject)$/,
  );
  if (accountAdjustmentReviewMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const [, requestId, action] = accountAdjustmentReviewMatch;
    const reviewReason = text(data.reason);
    if (reviewReason.length < 2 || reviewReason.length > 200)
      throw new Error(
        `${action === "approve" ? "复核" : "驳回"}原因至少需要2个字符且不能超过200个字符`,
      );
    const requests = getAccountAdjustmentRequests();
    const request = requests.find((item) => item.id === requestId);
    if (!request) throw new Error("账户调整申请不存在");

    if (action === "approve") {
      if (request.status === "POSTED")
        return ok(accountAdjustmentView(request));
      if (request.status === "REJECTED")
        throw new Error("已驳回的账户调整不能入账");
    } else {
      if (request.status === "REJECTED")
        return ok(accountAdjustmentView(request));
      if (request.status === "POSTED")
        throw new Error("已入账的账户调整不能驳回；请提交反向调整申请");
    }
    if (request.requestedById === mockUser().id)
      throw new Error("账户调整申请人与复核人不能是同一账号");

    const now = new Date().toISOString();
    if (action === "reject") {
      Object.assign(request, {
        status: "REJECTED",
        reviewedById: mockUser().id,
        reviewedAt: now,
        reviewReason,
        updatedAt: now,
      });
      saveAccountAdjustmentRequests(requests);
      return ok(accountAdjustmentView(request));
    }

    const memberAccounts = getMemberAccounts();
    const account = Object.values(memberAccounts)
      .flat()
      .find((item: any) => item.id === request.accountId) as any;
    if (!account) throw new Error("账户不存在");
    const balanceBefore = Number(account.balance || 0);
    const balanceAfter = balanceBefore + Number(request.amount);
    if (balanceAfter < 0) throw new Error("账户余额不足");
    const transaction = {
      id: newId("account-transaction"),
      accountId: account.id,
      kind: Number(request.amount) > 0 ? "CREDIT" : "DEBIT",
      amount: Number(request.amount),
      balanceBefore,
      balanceAfter,
      reasonCode: "MANUAL_ADJUSTMENT",
      reason: request.reason,
      operatorId: mockUser().id,
      idempotencyKey: `ACCOUNT_ADJUSTMENT:${request.id}`,
      metadata: { requestId: request.id, reviewReason },
      createdAt: now,
    };
    account.balance = balanceAfter;
    account.version = Number(account.version || 0) + 1;
    Object.assign(request, {
      status: "POSTED",
      reviewedById: mockUser().id,
      reviewedAt: now,
      reviewReason,
      transactionId: transaction.id,
      updatedAt: now,
    });
    saveMemberAccounts(memberAccounts);
    saveMemberAccountTransactions([
      transaction,
      ...getMemberAccountTransactions(),
    ]);
    saveAccountAdjustmentRequests(requests);
    return ok(accountAdjustmentView(request));
  }

  const memberAccountTransactionsMatch = url.match(
    /^\/members\/([^/]+)\/accounts\/transactions$/,
  );
  if (memberAccountTransactionsMatch && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const memberId = memberAccountTransactionsMatch[1];
    const accountById = new Map(
      (getMemberAccounts()[memberId] || []).map((account) => [
        account.id,
        account,
      ]),
    );
    return ok(
      getMemberAccountTransactions()
        .filter((transaction) => accountById.has(transaction.accountId))
        .map((transaction) => ({
          ...transaction,
          account: { type: accountById.get(transaction.accountId)?.type },
          operator: mockActorIdentity(transaction.operatorId),
        })),
    );
  }

  const member360Match = url.match(/^\/members\/([^/]+)\/360$/);
  if (member360Match && method === "GET") {
    requireMockRole("FRONT_DESK", "COACH", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const id = member360Match[1];
    if (!["member-1", "member-2"].includes(id)) throw new Error("会员不存在");
    const coachOnly =
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    if (coachOnly && id !== "member-1")
      throw new Error("会员不在当前教练负责的班级中");
    const member =
      id === "member-1"
        ? {
            id,
            displayName: "延庆会员小林",
            phone: coachOnly ? null : "13800000005",
            memberProfile: {
              level: "GOLD",
              visitCount: 18,
              lastVisitAt: new Date().toISOString(),
            },
          }
        : {
            id,
            displayName: "羽友小周",
            phone: "13800000007",
            memberProfile: {
              level: "REGULAR",
              visitCount: 6,
              lastVisitAt: new Date(Date.now() - 86400000).toISOString(),
            },
          };
    return ok({
      member,
      accounts: coachOnly ? [] : getMemberAccounts()[id] || [],
      recentOrders: coachOnly ? [] : getOrders().slice(0, 5),
      recentTraining: id === "member-1" ? getEnrollments().slice(0, 5) : [],
      recentGames: coachOnly
        ? []
        : getGames()
            .slice(0, 3)
            .map((game) => ({
              id: `reg-${game.id}`,
              status: "CHECKED_IN",
              game,
            })),
      recentEvents: coachOnly
        ? []
        : getEvents()
            .slice(0, 3)
            .map((event) => ({
              id: `team-${event.id}`,
              status: "COMPLETED",
              event,
            })),
      recentCoupons: coachOnly ? [] : getCoupons().slice(0, 5),
      financialsRedacted: coachOnly,
    });
  }
  if (url === "/members/leads" && method === "GET") {
    requireMockRole("FRONT_DESK", "COACH", "ADMIN", "SUPER_ADMIN");
    const coachOnly =
      hasMockRole("COACH") &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const terminal = ["CONVERTED", "LOST", "ARCHIVED"];
    const keyword = text(data.keyword).toLowerCase();
    let leads = getCustomerLeads().filter(
      (lead) =>
        !coachOnly ||
        lead.ownerId === mockUser().id ||
        lead.convertedMemberId === "member-1",
    );
    if (data.status)
      leads = leads.filter((lead) => lead.status === data.status);
    if (data.sourceChannel)
      leads = leads.filter((lead) => lead.sourceChannel === data.sourceChannel);
    if (data.ownerId)
      leads = leads.filter((lead) => lead.ownerId === data.ownerId);
    if (data.overdue === "true")
      leads = leads.filter(
        (lead) =>
          !terminal.includes(lead.status) &&
          new Date(lead.slaDueAt).getTime() < Date.now(),
      );
    if (keyword)
      leads = leads.filter((lead) =>
        `${lead.displayName}${coachOnly ? "" : lead.phone || ""}${lead.campaign || ""}`
          .toLowerCase()
          .includes(keyword),
      );
    if (coachOnly)
      leads = leads.map((lead) => ({
        ...lead,
        phone: lead.phone ? "已登记（教练不可见）" : null,
      }));
    return ok({ items: leads, total: leads.length, page: 1, pageSize: 100 });
  }
  if (url === "/members/leads" && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    if (!text(data.displayName)) throw new Error("客户姓名不能为空");
    if (!text(data.sourceChannel)) throw new Error("客户来源不能为空");
    const leads = getCustomerLeads();
    if (
      text(data.phone) &&
      leads.some(
        (lead) =>
          lead.phone === text(data.phone) &&
          !["CONVERTED", "LOST", "ARCHIVED"].includes(lead.status),
      )
    )
      throw new Error("该手机号已有未结束线索");
    const now = new Date();
    const lead = {
      id: newId("lead"),
      displayName: text(data.displayName),
      phone: text(data.phone) || null,
      status: "NEW",
      sourceChannel: data.sourceChannel,
      campaign: text(data.campaign) || null,
      referrerId: data.referrerId || null,
      ownerId: data.ownerId || null,
      owner: data.ownerId
        ? {
            id: data.ownerId,
            displayName:
              data.ownerId === mockUser().id
                ? mockUser().displayName
                : "已分配员工",
          }
        : null,
      convertedMemberId: null,
      nextFollowUpAt: data.nextFollowUpAt || null,
      slaDueAt:
        data.slaDueAt || new Date(now.getTime() + 86400000).toISOString(),
      followUps: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    saveCustomerLeads([lead, ...leads]);
    return ok(lead);
  }
  const leadActionMatch = url.match(
    /^\/members\/leads\/([^/]+)\/(claim|assign|follow-ups|convert|lost|archive)$/,
  );
  if (leadActionMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const [, leadId, action] = leadActionMatch;
    const leads = getCustomerLeads();
    const lead = leads.find((item) => item.id === leadId);
    if (!lead) throw new Error("客户线索不存在");
    const terminal = ["CONVERTED", "LOST", "ARCHIVED"];
    if (action === "claim") {
      if (terminal.includes(lead.status)) throw new Error("终态线索不能认领");
      if (lead.ownerId && lead.ownerId !== mockUser().id)
        throw new Error("线索已由其他员工认领");
      lead.ownerId = mockUser().id;
      lead.owner = { id: mockUser().id, displayName: mockUser().displayName };
    } else if (action === "assign") {
      if (terminal.includes(lead.status))
        throw new Error("终态线索不能重新分配");
      if (!text(data.ownerId)) throw new Error("负责人不能为空");
      lead.ownerId = data.ownerId;
      lead.owner = {
        id: data.ownerId,
        displayName:
          data.ownerId === mockUser().id
            ? mockUser().displayName
            : "已分配员工",
      };
    } else if (action === "follow-ups") {
      if (terminal.includes(lead.status))
        throw new Error("终态线索不能继续跟进");
      if (!text(data.content)) throw new Error("跟进内容不能为空");
      const rank: Record<string, number> = {
        NEW: 0,
        CONTACTING: 1,
        TRIAL_RESERVED: 2,
        ATTENDED: 3,
      };
      const nextStatus =
        data.nextStatus || (lead.status === "NEW" ? "CONTACTING" : lead.status);
      if (
        rank[nextStatus] === undefined ||
        rank[nextStatus] < rank[lead.status]
      )
        throw new Error("跟进状态不能回退或直接进入终态");
      const followUp = {
        id: newId("follow-up"),
        kind: text(data.kind) || "OTHER",
        content: text(data.content),
        statusBefore: lead.status,
        statusAfter: nextStatus,
        nextFollowUpAt: data.nextFollowUpAt || lead.nextFollowUpAt,
        createdAt: new Date().toISOString(),
        actor: { id: mockUser().id, displayName: mockUser().displayName },
      };
      lead.status = nextStatus;
      lead.nextFollowUpAt = followUp.nextFollowUpAt;
      lead.followUps = [followUp, ...(lead.followUps || [])];
    } else if (action === "convert") {
      if (
        lead.status === "CONVERTED" &&
        lead.convertedMemberId === data.memberId
      )
        return ok(lead);
      if (terminal.includes(lead.status)) throw new Error("终态线索不能转换");
      if (!["member-1", "member-2"].includes(data.memberId))
        throw new Error("转换目标不是有效会员");
      lead.status = "CONVERTED";
      lead.convertedMemberId = data.memberId;
      lead.convertedAt = new Date().toISOString();
      lead.nextFollowUpAt = null;
    } else if (action === "lost") {
      if (terminal.includes(lead.status))
        throw new Error("终态线索不能标记丢失");
      if (text(data.reason).length < 2) throw new Error("丢失原因不能为空");
      lead.status = "LOST";
      lead.lostReason = text(data.reason);
      lead.lostAt = new Date().toISOString();
      lead.nextFollowUpAt = null;
    } else {
      if (!["CONVERTED", "LOST", "ARCHIVED"].includes(lead.status))
        throw new Error("只有已转换或已丢失线索可以归档");
      lead.status = "ARCHIVED";
      lead.archivedAt = new Date().toISOString();
    }
    lead.updatedAt = new Date().toISOString();
    saveCustomerLeads(leads);
    return ok(lead);
  }
  if (url === "/members") {
    requireMockRole("FRONT_DESK", "COACH", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const members =
      mockRoles().includes("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN")
        ? [
            {
              id: "member-1",
              displayName: "延庆会员小林",
              level: "GOLD",
              status: "ACTIVE",
              memberProfile: { level: "GOLD" },
              trainingContext: "当前负责班级",
            },
          ]
        : MOCK_ACTIVE_MEMBERS.map((member) => ({ ...member }));
    return ok({ items: members, total: members.length });
  }
  if (url === "/dashboard") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    return ok({
      venue: { revenueCents: 2866000, utilizationRate: 73 },
      training: {
        confirmedRevenueCents: 1680000,
        venueContributionCents: 336000,
        venueFeeCents: 0,
      },
      goods: { revenueCents: 368000, lowStockCount: 1 },
    });
  }
  if (url === "/training/financial-summary") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    return ok({
      effectiveRevenueCents: 1680000,
      confirmedRevenueCents: 1680000,
      venueContractContributionCents: 336000,
      venueContributionCents: 336000,
      venueFeeCents: 0,
    });
  }
  if (url === "/training/settlements" && method === "GET") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const periodStart = data.periodStart
      ? new Date(String(data.periodStart))
      : null;
    const periodEnd = data.periodEnd ? new Date(String(data.periodEnd)) : null;
    if (
      (periodStart && !Number.isFinite(periodStart.getTime())) ||
      (periodEnd && !Number.isFinite(periodEnd.getTime())) ||
      (periodStart && periodEnd && periodEnd <= periodStart)
    ) {
      throw new Error("培训结算查询周期无效");
    }
    return ok(
      getTrainingSettlements()
        .filter(
          (settlement) =>
            (!data.status || settlement.status === data.status) &&
            (!periodStart ||
              new Date(settlement.periodStart).getTime() >=
                periodStart.getTime()) &&
            (!periodEnd ||
              new Date(settlement.periodEnd).getTime() <= periodEnd.getTime()),
        )
        .sort(
          (left, right) =>
            new Date(right.periodEnd).getTime() -
            new Date(left.periodEnd).getTime(),
        ),
    );
  }
  if (url === "/training/settlements" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const periodStart = new Date(String(data.periodStart || ""));
    const periodEnd = new Date(String(data.periodEnd || ""));
    if (
      !Number.isFinite(periodStart.getTime()) ||
      !Number.isFinite(periodEnd.getTime()) ||
      periodEnd <= periodStart
    ) {
      throw new Error("结算结束时间必须晚于开始时间");
    }
    const acquisitionCostCents = integer(data.acquisitionCostCents ?? 0);
    const marketingCostCents = integer(data.marketingCostCents ?? 0);
    if (acquisitionCostCents < 0 || marketingCostCents < 0) {
      throw new Error("获客和营销费用必须为非负整数");
    }
    assertTrainingSettlementPeriodUnlocked(periodStart, periodEnd);
    const list = getTrainingSettlements();
    const existing = list.find(
      (settlement) =>
        settlement.periodStart === periodStart.toISOString() &&
        settlement.periodEnd === periodEnd.toISOString(),
    );
    if (existing) {
      if (
        Number(existing.acquisitionCostCents) !== acquisitionCostCents ||
        Number(existing.marketingCostCents) !== marketingCostCents
      ) {
        throw new Error("该培训结算周期已生成，费用口径不同，不能覆盖原草稿");
      }
      return ok(existing);
    }
    const now = new Date().toISOString();
    const effectiveRevenueCents = 168_000;
    const coachCostCents = 36_000;
    const assistantCostCents = 8_000;
    const materialCostCents = 5_000;
    const venueContributionCents = Math.round(
      (effectiveRevenueCents * 2_000) / 10_000,
    );
    const actor = mockUser();
    const settlement = {
      id: newId("training-settlement"),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      effectiveRevenueCents,
      contractRateBps: 2_000,
      venueContributionCents,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
      acquisitionCostCents,
      marketingCostCents,
      occupiedCourtHours: 6,
      cashContributionMarginCents:
        effectiveRevenueCents -
        coachCostCents -
        assistantCostCents -
        materialCostCents -
        acquisitionCostCents -
        marketingCostCents,
      status: "DRAFT",
      confirmedById: null,
      confirmedAt: null,
      createdById: actor.id,
      createdBy: { id: actor.id, displayName: actor.displayName },
      workflowHistory: [
        {
          action: "TRAINING_SETTLEMENT_CREATED",
          actorId: actor.id,
          actorName: actor.displayName,
          reason: null,
          oldValue: null,
          newValue: { status: "DRAFT" },
          at: now,
        },
      ],
      processedIdempotencyKeys: {},
      createdAt: now,
      updatedAt: now,
    };
    saveTrainingSettlements([settlement, ...list]);
    return ok(settlement);
  }
  const trainingSettlementAction = url.match(
    /^\/training\/settlements\/([^/]+)\/(submit|confirm|settle|return|void)$/,
  );
  if (trainingSettlementAction && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const list = getTrainingSettlements();
    const settlement = list.find(
      (item) => item.id === trainingSettlementAction[1],
    );
    if (!settlement) throw new Error("培训结算单不存在");
    const action = trainingSettlementAction[2];
    const transitions: Record<
      string,
      { from: string; to: string; auditAction: string }
    > = {
      submit: {
        from: "DRAFT",
        to: "PENDING_CONFIRMATION",
        auditAction: "TRAINING_SETTLEMENT_SUBMITTED",
      },
      confirm: {
        from: "PENDING_CONFIRMATION",
        to: "CONFIRMED",
        auditAction: "TRAINING_SETTLEMENT_CONFIRMED",
      },
      settle: {
        from: "CONFIRMED",
        to: "SETTLED",
        auditAction: "TRAINING_SETTLEMENT_SETTLED",
      },
      return: {
        from: "PENDING_CONFIRMATION",
        to: "DRAFT",
        auditAction: "TRAINING_SETTLEMENT_RETURNED",
      },
      void: {
        from: "DRAFT",
        to: "VOID",
        auditAction: "TRAINING_SETTLEMENT_VOIDED",
      },
    };
    const transition = transitions[action];
    const actor = mockUser();
    if (
      ["confirm", "settle", "return"].includes(action) &&
      settlement.createdById === actor.id
    ) {
      throw new Error("制单人不能确认、结算或退回自己的培训结算单");
    }
    const reason = text(data.reason);
    if (["return", "void"].includes(action) && reason.length < 2) {
      throw new Error("退回或作废结算单必须填写原因");
    }
    const idempotencyKey = data.idempotencyKey
      ? requireIdempotencyKey(data.idempotencyKey, "培训结算动作幂等键")
      : "";
    const processed = (settlement.processedIdempotencyKeys || {}) as Record<
      string,
      string
    >;
    if (idempotencyKey && processed[idempotencyKey]) {
      if (processed[idempotencyKey] !== transition.auditAction) {
        throw new Error("幂等键已用于其他培训结算动作");
      }
      return ok(settlement);
    }
    if (settlement.status === transition.to) return ok(settlement);
    if (settlement.status !== transition.from) {
      throw new Error(
        `培训结算单当前状态为 ${settlement.status}，不能执行该操作`,
      );
    }
    assertTrainingSettlementPeriodUnlocked(
      new Date(settlement.periodStart),
      new Date(settlement.periodEnd),
    );
    const oldStatus = settlement.status;
    const now = new Date().toISOString();
    settlement.status = transition.to;
    settlement.updatedAt = now;
    if (action === "confirm") {
      settlement.confirmedById = actor.id;
      settlement.confirmedAt = now;
    } else if (action === "return") {
      settlement.confirmedById = null;
      settlement.confirmedAt = null;
    }
    settlement.workflowHistory = [
      ...(Array.isArray(settlement.workflowHistory)
        ? settlement.workflowHistory
        : []),
      {
        action: transition.auditAction,
        actorId: actor.id,
        actorName: actor.displayName,
        reason: reason || null,
        oldValue: { status: oldStatus },
        newValue: { status: transition.to },
        at: now,
      },
    ];
    if (idempotencyKey) processed[idempotencyKey] = transition.auditAction;
    settlement.processedIdempotencyKeys = processed;
    saveTrainingSettlements(list);
    return ok(settlement);
  }
  if (url === "/alliance/settlements" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const merchant = getMerchants().find((item) => item.id === data.merchantId);
    if (!merchant) throw new Error("商户不存在");
    const periodStart = new Date(String(data.periodStart || ""));
    const periodEnd = new Date(String(data.periodEnd || ""));
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd <= periodStart
    )
      throw new Error("结算周期无效");
    const grossProfit = integer(data.attributedGrossProfitCents)
      ? Number(data.attributedGrossProfitCents)
      : 0;
    if (grossProfit < 0) throw new Error("归因毛利必须为非负整数");
    const existing = getSettlements().find(
      (item) =>
        item.merchantId === merchant.id &&
        item.periodStart === periodStart.toISOString() &&
        item.periodEnd === periodEnd.toISOString(),
    );
    if (existing) {
      if (Number(existing.attributedGrossProfitCents || 0) !== grossProfit)
        throw new Error("该商户结算周期已生成，利润口径不同，请先提出调整申请");
      return ok(existing);
    }
    const settlement = {
      id: newId("settlement"),
      merchantId: merchant.id,
      merchant,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      attributedGrossProfitCents: grossProfit,
      cooperationFeeCents: 12000,
      issuedCount: 0,
      claimedCount: 0,
      redeemedCount: 0,
      effectiveNewCustomers: 0,
      attributedGmvCents: 0,
      roi: 0,
      status: "DRAFT",
      detail: { workflowHistory: [] },
    };
    saveSettlements([settlement, ...getSettlements()]);
    return ok(settlement);
  }
  if (url === "/alliance/settlements" && method === "GET") {
    requireMockRole("MERCHANT", "FINANCE", "ADMIN", "SUPER_ADMIN");
    if (settlementDirectoryIsScoped()) {
      return ok(
        getSettlements().filter(
          (settlement) => settlement.merchantId === "merchant-coffee",
        ),
      );
    }
    return ok(getSettlements());
  }
  const settlementAction = url.match(
    /^\/alliance\/settlements\/([^/]+)\/(submit|confirm|dispute|settle)$/,
  );
  if (settlementAction && method === "POST") {
    const list = getSettlements();
    const settlement = list.find((item) => item.id === settlementAction[1]);
    if (!settlement) throw new Error("联盟结算单不存在");
    const action = settlementAction[2];
    const transitions: Record<string, { from: string; to: string }> = {
      submit: { from: "DRAFT", to: "PENDING_CONFIRMATION" },
      confirm: { from: "PENDING_CONFIRMATION", to: "CONFIRMED" },
      dispute: { from: "PENDING_CONFIRMATION", to: "DRAFT" },
      settle: { from: "CONFIRMED", to: "SETTLED" },
    };
    if (
      ["confirm", "dispute"].includes(settlementAction[2]) &&
      !merchantCanManage(settlement.merchantId)
    )
      throw new Error("只能操作本商户的结算单");
    const transition = transitions[action];
    if (["confirm", "dispute"].includes(action))
      requireMockRole("MERCHANT", "ADMIN", "SUPER_ADMIN");
    if (["submit", "settle"].includes(action))
      requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    if (settlement.status === transition.to) return ok(settlement);
    if (settlement.status !== transition.from)
      throw new Error(`结算单当前状态为 ${settlement.status}，不能执行该操作`);
    if (action === "dispute" && text(data.reason).length < 2)
      throw new Error("提出争议必须填写原因");
    settlement.status = transition.to;
    const history = Array.isArray(settlement.detail?.workflowHistory)
      ? settlement.detail.workflowHistory
      : [];
    settlement.detail = {
      ...(settlement.detail || {}),
      workflowHistory: [
        ...history,
        {
          action,
          state: transition.to,
          reason: data.reason,
          actorId: mockUser().id,
          at: new Date().toISOString(),
        },
      ],
    };
    saveSettlements(list);
    return ok(settlement);
  }
  const venueCheckInMatch = url.match(/^\/venues\/orders\/([^/]+)\/check-in$/);
  if (venueCheckInMatch && method === "POST") {
    requireMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) => item.id === venueCheckInMatch[1]);
    if (!order || order.businessType !== "VENUE")
      throw new Error("订场订单不存在");
    if (order.status === "CHECKED_IN") return ok(order);
    if (order.status !== "PAID") throw new Error("订单未支付或状态不可签到");
    const checkInShift = requireMockOpenFrontDeskShift();
    order.status = "CHECKED_IN";
    order.checkedInAt = new Date().toISOString();
    order.checkedInById = mockUser().id;
    order.checkInFrontDeskShiftId = checkInShift?.id || null;
    order.checkInAdminEmergencyBypass = !checkInShift;
    const bookings = getVenueBookings().map((booking) =>
      booking.orderId === order.id && booking.status === "CONFIRMED"
        ? { ...booking, status: "CHECKED_IN" }
        : booking,
    );
    saveVenueBookings(bookings);
    order.bookings = (order.bookings || []).map((booking: any) => ({
      ...booking,
      status: booking.status === "CONFIRMED" ? "CHECKED_IN" : booking.status,
    }));
    saveOrders(orders);
    return ok(order);
  }
  const gameCheckInMatch = url.match(/^\/games\/([^/]+)\/check-in\/([^/]+)$/);
  if (gameCheckInMatch && method === "POST") {
    requireMockRole("HOST", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const list = getGames();
    const game = list.find((item) => item.id === gameCheckInMatch[1]);
    if (!game) throw new Error("球局不存在");
    if (
      hasMockRole("HOST") &&
      !hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN") &&
      game.hostId &&
      game.hostId !== mockUser().id
    )
      throw new Error("主理人只能操作自己负责的球局");
    if (["DRAFT", "CANCELLED", "COMPLETED"].includes(game.status))
      throw new Error("当前球局状态不可签到");
    const registration = game?.registrations?.find(
      (item: any) => item.userId === gameCheckInMatch[2],
    );
    if (registration?.status === "CHECKED_IN") return ok(registration);
    if (!registration) throw new Error("报名记录不存在");
    if (registration.status !== "PAID") throw new Error("报名未支付或不存在");
    Object.assign(registration, {
      status: "CHECKED_IN",
      checkedInAt: new Date().toISOString(),
    });
    saveGames(list);
    return ok(registration);
  }
  throw new Error(`模拟接口尚未实现：${method} ${url}`);
}
