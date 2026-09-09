import { getCouponTemplates } from "../state";
import { hasMockRole } from "./common.js";

export const assignedMerchant = (merchantId: unknown) =>
  Boolean(merchantId) && String(merchantId) === "merchant-coffee";

export const merchantDirectoryIsScoped = () =>
  hasMockRole("MERCHANT") && !hasMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");

export const templateDirectoryIsScoped = () =>
  !hasMockRole("ADMIN", "SUPER_ADMIN");

export const settlementDirectoryIsScoped = () =>
  !hasMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");

export const merchantCanManage = (merchantId: unknown) => {
  if (!merchantId) return false;
  if (hasMockRole("ADMIN", "SUPER_ADMIN")) return true;
  // The fixture merchant account represents 山脚咖啡.  In production this is
  // resolved from UserRole.merchantId; keeping the same boundary in the mock
  // prevents a role switch from exposing another merchant's ledger.
  return hasMockRole("MERCHANT") && assignedMerchant(merchantId);
};

export const merchantCanRedeem = (merchantId: unknown) =>
  hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN") ||
  merchantCanManage(merchantId);

export const allianceSettlementView = (settlement: any) => ({
  id: settlement.id,
  merchantId: settlement.merchantId,
  merchant: settlement.merchant
    ? {
        id: settlement.merchant.id,
        code: settlement.merchant.code,
        name: settlement.merchant.name,
      }
    : undefined,
  periodStart: settlement.periodStart,
  periodEnd: settlement.periodEnd,
  issuedCount: settlement.issuedCount,
  claimedCount: settlement.claimedCount,
  redeemedCount: settlement.redeemedCount,
  effectiveNewCustomers: settlement.effectiveNewCustomers,
  attributedGmvCents: settlement.attributedGmvCents,
  attributedGrossProfitCents: settlement.attributedGrossProfitCents,
  cooperationFeeCents: settlement.cooperationFeeCents,
  roi: settlement.roi,
  status: settlement.status,
  confirmedAt: settlement.confirmedAt || null,
  settledAt: settlement.settledAt || null,
  createdAt: settlement.createdAt,
  updatedAt: settlement.updatedAt,
  detail: {
    workflowState: settlement.detail?.workflowState || settlement.status,
    workflowHistory: (settlement.detail?.workflowHistory || []).map(
      (entry: any) => ({
        action: entry.action,
        state: entry.state,
        reason: entry.reason || null,
        at: entry.at,
      }),
    ),
  },
});

export const couponRedemptionView = (coupon: any) => {
  const { idempotencyKey: _idempotencyKey, ...response } = coupon;
  return response;
};

export const couponMerchantId = (coupon: any) =>
  coupon.merchantId ||
  coupon.template?.merchantId ||
  coupon.template?.merchant?.id;

export const couponTemplate = (coupon: any) =>
  getCouponTemplates().find((item) => item.id === coupon.templateId) ||
  coupon.template;
