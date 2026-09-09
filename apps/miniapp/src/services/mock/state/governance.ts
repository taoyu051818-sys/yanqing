import { type JsonRecord, KEYS, read, write } from "./storage.js";

export const initialGovernanceUsers = (): JsonRecord[] => [
  {
    id: "user-member",
    displayName: "延庆会员小林",
    phone: "13800000005",
    status: "ACTIVE",
    primaryRole: "MEMBER",
    roles: [{ role: "MEMBER", merchantId: null }],
    wechatBound: true,
  },
  {
    id: "user-frontdesk",
    displayName: "前台小羽",
    phone: "13800000001",
    status: "ACTIVE",
    primaryRole: "FRONT_DESK",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "FRONT_DESK", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-coach",
    displayName: "王教练",
    phone: "13800000002",
    status: "ACTIVE",
    primaryRole: "COACH",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "COACH", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-host",
    displayName: "周末主理人阿凯",
    phone: "13800000003",
    status: "ACTIVE",
    primaryRole: "HOST",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "HOST", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-merchant",
    displayName: "山脚咖啡商户",
    phone: "13800000004",
    status: "ACTIVE",
    primaryRole: "MERCHANT",
    roles: [
      { role: "MEMBER", merchantId: null },
      {
        role: "MERCHANT",
        merchantId: "merchant-coffee",
        merchant: { id: "merchant-coffee", name: "山脚咖啡" },
      },
    ],
    wechatBound: true,
  },
  {
    id: "user-finance",
    displayName: "金羽财务",
    phone: "13800000006",
    status: "ACTIVE",
    primaryRole: "FINANCE",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "FINANCE", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-event",
    displayName: "赛事管理员",
    phone: "13800000007",
    status: "ACTIVE",
    primaryRole: "EVENT_MANAGER",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "EVENT_MANAGER", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-admin",
    displayName: "金羽管理员",
    phone: "13800000008",
    status: "ACTIVE",
    primaryRole: "ADMIN",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "ADMIN", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-super",
    displayName: "超级管理员",
    phone: "13800000009",
    status: "ACTIVE",
    primaryRole: "SUPER_ADMIN",
    roles: [
      { role: "MEMBER", merchantId: null },
      { role: "SUPER_ADMIN", merchantId: null },
    ],
    wechatBound: true,
  },
  {
    id: "user-privacy",
    displayName: "待注销演示会员",
    phone: "13800000010",
    status: "DISABLED",
    primaryRole: "MEMBER",
    roles: [{ role: "MEMBER", merchantId: null }],
    wechatBound: true,
  },
];

export const initialDataErasureRequests = (): JsonRecord[] => [
  {
    id: "erasure-mock-ready",
    userId: "user-privacy",
    user: {
      id: "user-privacy",
      displayName: "待注销演示会员",
      phone: "13800000010",
      status: "DISABLED",
    },
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
  },
];

export const initialSystemParameters = (): JsonRecord[] => [
  {
    id: "parameter-operating-share-rate",
    key: "finance.operating_share_rate_bps",
    value: 1500,
    type: "INTEGER",
    description: "按已履约净收入计提的经营分成比例",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-training-rate",
    key: "training.contract_rate_bps",
    value: 2000,
    type: "INTEGER",
    description: "培训有效流水计入场馆合同收入比例",
    locked: true,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-training-venue-fee",
    key: "training.venue_fee_cents",
    value: 0,
    type: "INTEGER",
    description: "培训场地费硬禁用",
    locked: true,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-newcomer-valid-days",
    key: "newcomer.experience.valid_days",
    value: 7,
    type: "INTEGER",
    description: "新客体验权益领取后有效天数",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-newcomer-periods",
    key: "newcomer.experience.allowed_slot_periods",
    value: ["EARLY", "DAYTIME"],
    type: "JSON",
    description: "新客体验权益允许使用的非黄金时段",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-referral-inviter-reward",
    key: "referral.first_payment.coin_reward",
    value: 50,
    type: "INTEGER",
    description: "直接推荐新客首单邀请人奖励羽球币",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-referral-new-user-reward",
    key: "referral.new_user.first_payment.coin_reward",
    value: 50,
    type: "INTEGER",
    description: "直接推荐新客首单新客奖励羽球币",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-referral-observation",
    key: "referral.refund_observation_days",
    value: 7,
    type: "INTEGER",
    description: "首单完成后的退款观察期",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-booking-hold",
    key: "booking.hold_minutes",
    value: 10,
    type: "INTEGER",
    description: "待支付订单占场分钟数",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-venue-check-in-window-v1",
    key: "operations.venue_check_in_window.v1",
    value: { version: 1, earlyMinutes: 30, lateMinutes: 30 },
    type: "JSON",
    description: "场地签到窗口 v1（提前/延后均不超过240分钟）",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-game-check-in-window-v1",
    key: "operations.game_check_in_window.v1",
    value: { version: 1, earlyMinutes: 30, lateMinutes: 30 },
    type: "JSON",
    description: "球局签到窗口 v1（提前/延后均不超过240分钟）",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-event-check-in-window-v1",
    key: "operations.event_check_in_window.v1",
    value: { version: 1, earlyMinutes: 30, lateMinutes: 30 },
    type: "JSON",
    description: "赛事签到窗口 v1（提前/延后均不超过240分钟）",
    locked: false,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-training-attendance-window-v1",
    key: "training.attendance_window.v1",
    value: { version: 1, earlyMinutes: 30, lateMinutes: 120 },
    type: "JSON",
    description: "培训点名与试听签到窗口 v1（提前/延后均不超过240分钟）",
    locked: true,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
  {
    id: "parameter-training-completion-window-v1",
    key: "training.completion_window.v1",
    value: { version: 1, earlyMinutes: 0, lateMinutes: 240 },
    type: "JSON",
    description: "培训消课、结课与试听未到窗口 v1（提前/延后均不超过240分钟）",
    locked: true,
    effectiveFrom: "2026-01-01T00:00:00+08:00",
    effectiveTo: null,
  },
];

export const initialAuditLogs = (): JsonRecord[] => [
  {
    id: "audit-mock-1",
    actorId: "user-admin",
    actor: { id: "user-admin", displayName: "金羽管理员" },
    actorRole: "ADMIN",
    action: "PARAMETER_VERSION_CREATED",
    objectType: "SystemParameter",
    objectId: "parameter-booking-hold",
    reason: "初始化预约规则",
    result: "SUCCESS",
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
];

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
  return read<JsonRecord[]>(
    KEYS.dataErasureRequests,
    initialDataErasureRequests(),
  );
}

export function saveDataErasureRequests(value: JsonRecord[]) {
  return write(KEYS.dataErasureRequests, value);
}

export function getAuditLogs(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.auditLogs, initialAuditLogs());
}

export function saveAuditLogs(value: JsonRecord[]) {
  return write(KEYS.auditLogs, value);
}
