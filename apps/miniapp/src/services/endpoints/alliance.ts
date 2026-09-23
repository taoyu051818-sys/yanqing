import type { MemberCouponView } from "@yanqing/shared";
import { api } from "../http";

export const allianceEndpoints = {
  merchants: () => api.get<any[]>("/alliance/merchants"),
  createMerchant: (data: object) => api.post("/alliance/merchants", data),
  setMerchantStatus: (merchantId: string, data: object) =>
    api.post(`/alliance/merchants/${merchantId}/status`, data),
  couponTemplates: () => api.get<any[]>("/alliance/coupon-templates"),
  createCouponTemplate: (data: object) =>
    api.post("/alliance/coupon-templates", data),
  setCouponTemplateStatus: (templateId: string, data: object) =>
    api.post(`/alliance/coupon-templates/${templateId}/status`, data),
  generateCouponCodes: (templateId: string, data: object) =>
    api.post(`/alliance/coupon-templates/${templateId}/codes`, data),
  claimCoupon: (code: string) =>
    api.post(`/alliance/coupons/${encodeURIComponent(code)}/claim`),
  myCoupons: () => api.get<MemberCouponView[]>("/alliance/coupons/me"),
  couponQr: (code: string) =>
    api.get<Record<string, any>>(`/alliance/coupons/${code}/qr`),
  redeemCoupon: (data: object) => api.post("/alliance/coupons/redeem", data),
  createAllianceSettlement: (data: object) =>
    api.post("/alliance/settlements", data),
  allianceSettlements: () => api.get<any[]>("/alliance/settlements"),
  reviseAllianceSettlement: (
    id: string,
    data: {
      attributedGrossProfitCents: number;
      reason: string;
      idempotencyKey: string;
    },
  ) => api.post<any>(`/alliance/settlements/${id}/revise`, data),
  submitAllianceSettlement: (id: string) =>
    api.post(`/alliance/settlements/${id}/submit`),
  confirmAllianceSettlement: (id: string) =>
    api.post(`/alliance/settlements/${id}/confirm`),
  disputeAllianceSettlement: (id: string, data: object) =>
    api.post(`/alliance/settlements/${id}/dispute`, data),
  settleAllianceSettlement: (id: string) =>
    api.post(`/alliance/settlements/${id}/settle`),
};
