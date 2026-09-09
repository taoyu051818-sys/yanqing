import { membershipProducts as seedMembershipProducts } from "../catalog";
import { type JsonRecord, KEYS, read, write } from "./storage.js";

export const initialCustomerLeads = (): JsonRecord[] => [
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

export const initialRechargePlans = (): JsonRecord[] => [
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

export const initialMembershipProducts = (): JsonRecord[] =>
  seedMembershipProducts.map((product) => ({
    ...product,
    creationIdempotencyKey: `SEED:${product.code}:V${product.version}`,
    creationCommandHash: "c".repeat(64),
  }));

export const initialMemberAccounts = (): Record<string, JsonRecord[]> => {
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

export function getCustomerLeads(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.customerLeads, initialCustomerLeads());
}

export function saveCustomerLeads(value: JsonRecord[]) {
  return write(KEYS.customerLeads, value);
}

export function getRechargePlans(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.rechargePlans, initialRechargePlans());
}

export function getMembershipProducts(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.membershipProducts,
    initialMembershipProducts(),
  );
}

export function saveMembershipProducts(value: JsonRecord[]) {
  return write(KEYS.membershipProducts, value);
}

export function saveRechargePlans(value: JsonRecord[]) {
  return write(KEYS.rechargePlans, value);
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

export function getReferralRewards(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.referralRewards, []);
}

export function saveReferralRewards(value: JsonRecord[]) {
  return write(KEYS.referralRewards, value);
}

export function getReferralInvites(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.referralInvites, []);
}

export function saveReferralInvites(value: JsonRecord[]) {
  return write(KEYS.referralInvites, value);
}
