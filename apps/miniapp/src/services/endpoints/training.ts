import type {
  OrderView,
  TrainingStudentView,
  CreateTrainingStudentCommand,
  PurchaseTrainingCommand,
} from "@yanqing/shared";
import type {
  TrainingCorrectionView,
  TrainingTrialView,
  TrainingStudentSummary,
  YouthTrainingRuleView,
  YouthTrainingRuleManagementView,
} from "../../types/training-operations";
import type {
  TrainingProductView,
  TrainingSessionView,
  TrainingSessionQuery,
  TrainingSessionPage,
  TrainingEnrollmentView,
} from "@yanqing/shared";
import { api } from "../http";

export const trainingEndpoints = {
  trainingProducts: () => api.get<TrainingProductView[]>("/training/products"),
  publicTrainingProducts: () =>
    api.get<TrainingProductView[]>("/training/products/public"),
  createTrainingProduct: (data: object) => api.post("/training/products", data),
  updateTrainingProduct: (id: string, data: object) =>
    api.patch(`/training/products/${id}`, data),
  createTrainingClass: (data: object) => api.post("/training/classes", data),
  trainingStudents: () => api.get<TrainingStudentView[]>("/training/students"),
  adminTrainingStudents: (guardianId?: string) =>
    api.get<TrainingStudentSummary[]>(
      "/training/admin/students",
      guardianId ? { guardianId } : {},
    ),
  createTrainingStudent: (data: CreateTrainingStudentCommand) =>
    api.post<TrainingStudentView>("/training/students", data),
  updateTrainingStudent: (studentId: string, data: object) =>
    api.patch(`/training/students/${studentId}`, data),
  trainingEnrollments: () =>
    api.get<TrainingEnrollmentView[]>("/training/enrollments"),
  purchaseTraining: (data: PurchaseTrainingCommand) =>
    api.post<OrderView>("/training/purchase", data),
  createTrainingSession: (data: object) => api.post("/training/sessions", data),
  trainingTrials: (params: Record<string, any> = {}) =>
    api.get<TrainingTrialView[]>("/training/trials", params),
  myTrainingTrials: (params: Record<string, any> = {}) =>
    api.get<TrainingTrialView[]>("/training/trials/mine", params),
  createTrainingTrial: (data: object) => api.post("/training/trials", data),
  checkInTrainingTrial: (id: string, data: object) =>
    api.post(`/training/trials/${id}/check-in`, data),
  noShowTrainingTrial: (id: string, data: object) =>
    api.post(`/training/trials/${id}/no-show`, data),
  assessTrainingTrial: (id: string, data: object) =>
    api.post(`/training/trials/${id}/assess`, data),
  convertTrainingTrial: (id: string, data: object) =>
    api.post(`/training/trials/${id}/convert`, data),
  loseTrainingTrial: (id: string, data: object) =>
    api.post(`/training/trials/${id}/lost`, data),
  cancelTrainingTrial: (id: string, data: object) =>
    api.post(`/training/trials/${id}/cancel`, data),
  activeYouthTrainingRule: () =>
    api.get<YouthTrainingRuleView | null>("/training/youth-rules/active"),
  youthTrainingRules: (params: Record<string, any> = {}) =>
    api.get<YouthTrainingRuleManagementView[]>("/training/youth-rules", params),
  createYouthTrainingRule: (data: object) =>
    api.post("/training/youth-rules", data),
  publishYouthTrainingRule: (id: string, data: object) =>
    api.post(`/training/youth-rules/${id}/publish`, data),
  rejectYouthTrainingRule: (id: string, data: object) =>
    api.post(`/training/youth-rules/${id}/reject`, data),
  adminEnrollments: () =>
    api.get<TrainingEnrollmentView[]>("/training/admin/enrollments"),
  trainingFinancials: (periodStart: string, periodEnd: string) =>
    api.get<any>("/training/financial-summary", { periodStart, periodEnd }),
  trainingSettlements: (params: Record<string, any> = {}) =>
    api.get<any[]>("/training/settlements", params),
  createTrainingSettlement: (data: object) =>
    api.post("/training/settlements", data),
  submitTrainingSettlement: (id: string, data: object = {}) =>
    api.post(`/training/settlements/${id}/submit`, data),
  confirmTrainingSettlement: (id: string, data: object = {}) =>
    api.post(`/training/settlements/${id}/confirm`, data),
  settleTrainingSettlement: (id: string, data: object = {}) =>
    api.post(`/training/settlements/${id}/settle`, data),
  returnTrainingSettlement: (id: string, data: object) =>
    api.post(`/training/settlements/${id}/return`, data),
  voidTrainingSettlement: (id: string, data: object) =>
    api.post(`/training/settlements/${id}/void`, data),
  trainingBatch: (
    sessionId: string,
    action: import("../../types/training-batch").TrainingBatchAction,
    data: import("../../types/training-batch").TrainingBatchCommand,
  ) =>
    api.post<{
      results: import("../../types/training-batch").TrainingBatchResult[];
    }>(`/training/sessions/${sessionId}/batch/${action}`, data),
  consumeTraining: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/consume`, data),
  confirmTrainingConsume: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/consume/confirm`, data),
  trainingConsumeCorrections: () =>
    api.get<TrainingCorrectionView[]>("/training/consume-corrections"),
  requestTrainingConsumeCorrection: (data: object) =>
    api.post("/training/consume-corrections", data),
  approveTrainingConsumeCorrection: (id: string, data: object) =>
    api.post(`/training/consume-corrections/${id}/approve`, data),
  rejectTrainingConsumeCorrection: (id: string, data: object) =>
    api.post(`/training/consume-corrections/${id}/reject`, data),
  markTrainingAttendance: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/attendance`, data),
  scheduleTrainingMakeup: (sessionId: string, data: object) =>
    api.post(`/training/sessions/${sessionId}/attendance/makeup`, data),
  completeTrainingSession: (sessionId: string, data: object = {}) =>
    api.post(`/training/sessions/${sessionId}/complete`, data),
  trainingSessionPage: (query: TrainingSessionQuery = {}) => api.get<TrainingSessionPage>("/training/sessions/search", query),
  trainingSession: (id: string) => api.get<TrainingSessionView>(`/training/sessions/${encodeURIComponent(id)}`),
  // Selector consumers need the full eligible set, not an arbitrary first 100.
  trainingSessions: async (query: TrainingSessionQuery = {}) => {
    const items: TrainingSessionView[] = [];
    for (let page = 1; ; page++) {
      const result = await api.get<TrainingSessionPage>("/training/sessions/search", { ...query, page, pageSize: 100 });
      items.push(...result.items);
      if (!result.hasMore) return [...new Map(items.map(item => [item.id, item])).values()];
    }
  },
};
