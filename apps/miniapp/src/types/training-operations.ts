import type {
  TrainingClassSummary,
  TrainingProductView,
} from "@yanqing/shared";

export interface PersonSummary {
  id: string;
  displayName: string;
}
export interface TrainingLeadSummary extends PersonSummary {
  status: string;
  convertedMemberId: string | null;
}
export interface TrainingStudentSummary extends PersonSummary {
  guardianId: string;
  guardian: PersonSummary;
}
export interface TrainingStaffSummary extends PersonSummary {
  status: string;
  primaryRole: string;
  roles: Array<string | { role: string }>;
}
export interface TrainingTrialView {
  id: string;
  trialNo: string;
  status: string;
  sourceChannel: string;
  scheduledStartsAt: string;
  scheduledEndsAt: string;
  productId: string;
  studentId: string | null;
  guardianId: string | null;
  memberId: string | null;
  coachId: string;
  product: Omit<TrainingProductView, "enabled" | "classes"> | null;
  class:
    (TrainingClassSummary & { product: TrainingTrialView["product"] }) | null;
  student: PersonSummary | null;
  guardian: PersonSummary | null;
  member: PersonSummary | null;
  coach: PersonSummary | null;
  lead: TrainingLeadSummary | null;
  assessmentDimensions: Array<{
    key: string;
    label: string;
    score: number;
    note: string | null;
  }> | null;
  recommendation: string | null;
  assessmentNote: string | null;
  transitions: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    action: string;
    reason: string;
    actor: PersonSummary | null;
    createdAt: string;
  }>;
}
export type {
  TrainingCorrectionView,
  YouthTrainingRuleView,
  YouthTrainingRuleManagementView,
} from "@yanqing/shared";
