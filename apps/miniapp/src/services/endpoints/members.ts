import type { TrainingLeadSummary } from "../../types/training-operations";
import { api } from "../http";
import type { Member360View, MemberDirectory } from "../../types/domain";

export const membersEndpoints = {
  accountTransactions: () =>
    api.get<any[]>("/members/me/accounts/transactions"),
  referralRewards: () => api.get<any[]>("/referrals/me/rewards"),
  createReferralInvite: () =>
    api.post<{ inviteCode: string; expiresAt: string }>(
      "/referrals/me/invites",
    ),
  bindReferral: (inviteCode: string) =>
    api.post<{ bound: true }>("/members/me/referrer", {
      inviteCode,
    }),
  grantMaturedReferralRewards: () =>
    api.post("/referrals/rewards/grant-matured"),
  members: (params: Record<string, any> = {}) =>
    api.get<MemberDirectory>("/members", params),
  member360: (id: string) => api.get<Member360View>(`/members/${id}/360`),
  leadOwners: (params: Record<string, any> = {}) =>
    api.get<any>("/members/leads/owners", params),
  customerLeads: (params: Record<string, any> = {}) =>
    api.get<{
      items: TrainingLeadSummary[];
      total: number;
      page: number;
      pageSize: number;
    }>("/members/leads", params),
  createCustomerLead: (data: object) => api.post("/members/leads", data),
  claimCustomerLead: (id: string) => api.post(`/members/leads/${id}/claim`),
  assignCustomerLead: (id: string, ownerId: string) =>
    api.post(`/members/leads/${id}/assign`, { ownerId }),
  followUpCustomerLead: (id: string, data: object) =>
    api.post(`/members/leads/${id}/follow-ups`, data),
  convertCustomerLead: (id: string, memberId: string) =>
    api.post(`/members/leads/${id}/convert`, { memberId }),
  loseCustomerLead: (id: string, reason: string) =>
    api.post(`/members/leads/${id}/lost`, { reason }),
  archiveCustomerLead: (id: string, reason: string) =>
    api.post(`/members/leads/${id}/archive`, { reason }),
  accountAdjustments: (status = "REQUESTED") =>
    api.get<any[]>("/members/account-adjustments", { status }),
  createAccountAdjustment: (memberId: string, data: object) =>
    api.post(`/members/${memberId}/accounts/adjust`, data),
  approveAccountAdjustment: (requestId: string, reason: string) =>
    api.post(`/members/account-adjustments/${requestId}/approve`, { reason }),
  rejectAccountAdjustment: (requestId: string, reason: string) =>
    api.post(`/members/account-adjustments/${requestId}/reject`, { reason }),
  membershipProducts: () => api.get<any[]>("/memberships/products"),
  manageMembershipProducts: () =>
    api.get<any[]>("/memberships/products/manage"),
  createMembershipProduct: (data: object) =>
    api.post("/memberships/products", data),
  createMembershipProductVersion: (id: string, data: object) =>
    api.post(`/memberships/products/${id}/versions`, data),
  setMembershipProductStatus: (id: string, data: object) =>
    api.post(`/memberships/products/${id}/status`, data),
  rechargePlans: () => api.get<any[]>("/memberships/recharge-plans"),
  manageRechargePlans: () =>
    api.get<any[]>("/memberships/recharge-plans/manage"),
  createRechargePlan: (data: object) =>
    api.post("/memberships/recharge-plans", data),
  setRechargePlanStatus: (id: string, data: object) =>
    api.post(`/memberships/recharge-plans/${id}/status`, data),
  purchaseMembership: (productId: string, creationIdempotencyKey?: string) =>
    api.post("/memberships/purchase", { productId, creationIdempotencyKey }),
  recharge: (planId: string, creationIdempotencyKey?: string) =>
    api.post("/memberships/recharge", {
      planId,
      creationIdempotencyKey,
    }),
};
