import type { TrainingStaffSummary } from "../../types/training-operations";
import { api, download } from "../http";
import type { WorkItem, ReconciliationPeriod } from "../api-contracts";

export const operationsEndpoints = {
  dashboard: (period?: { periodStart: string; periodEnd: string }) =>
    api.get<Record<string, any>>("/dashboard", period),
  reconciliationPeriod: (date: string) =>
    api.get<ReconciliationPeriod>(`/reconciliation/periods/${date}`),
  closeReconciliationPeriod: (date: string, data: object = {}) =>
    api.post<ReconciliationPeriod>(
      `/reconciliation/periods/${date}/close`,
      data,
    ),
  workItems: (limit = 50) => api.get<WorkItem[]>("/work-items", { limit }),
  currentFrontDeskShift: () => api.get<any>("/operations/shifts/current"),
  frontDeskShiftHistory: (params: Record<string, any> = {}) =>
    api.get<any[]>("/operations/shifts/history", params),
  openFrontDeskShift: (openingCashCents: number) =>
    api.post("/operations/shifts/open", { openingCashCents }),
  closeFrontDeskShift: (id: string, data: object) =>
    api.post(`/operations/shifts/${id}/close`, data),
  reviewFrontDeskShiftVariance: (id: string, data: object) =>
    api.post(`/operations/shifts/${id}/review-variance`, data),
  parameters: (params: Record<string, any> = {}) =>
    api.get<any[]>("/parameters", params),
  createParameter: (data: object) => api.post("/parameters", data),
  auditLogs: (params: Record<string, any> = {}) =>
    api.get<any>("/audit-logs", params),
  governanceUsers: (params: Record<string, any> = {}) =>
    api.get<{
      items: TrainingStaffSummary[];
      total: number;
      page: number;
      pageSize: number;
    }>("/governance/users", params),
  setGovernanceUserRoles: (id: string, data: object) =>
    api.post(`/governance/users/${id}/roles`, data),
  setGovernanceUserStatus: (id: string, data: object) =>
    api.post(`/governance/users/${id}/status`, data),
  riskEvents: (params: Record<string, any> = {}) =>
    api.get<any>("/governance/risk-events", params),
  transitionRiskEvent: (
    id: string,
    action: "review" | "resolve" | "dismiss",
    data: object,
  ) => api.post(`/governance/risk-events/${id}/${action}`, data),
  downloadReport: (scope: string) => download(`/reports/exports/${scope}.xlsx`),
};
