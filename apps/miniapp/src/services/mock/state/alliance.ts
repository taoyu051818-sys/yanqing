import { coupons as seedCoupons, merchants as seedMerchants } from "../catalog";
import { type JsonRecord, KEYS, read, write } from "./storage.js";

export const initialSettlement = () => [
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

export const defaultCouponTemplates = (): JsonRecord[] =>
  seedCoupons.map((coupon: any, index) => ({
    id: coupon.templateId || `coupon-template-${index + 1}`,
    code: coupon.template?.code || `COUPON-${index + 1}`,
    name:
      coupon.template?.name ||
      coupon.template?.benefitDescription ||
      "商户专属消费券",
    allowVenueBooking: false,
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

export function getSettlements(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.settlements, initialSettlement());
}

export function saveSettlements(value: JsonRecord[]) {
  return write(KEYS.settlements, value);
}
