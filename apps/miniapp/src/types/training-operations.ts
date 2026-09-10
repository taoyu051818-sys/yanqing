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
export interface TrainingCorrectionView {
  id: string;
  status: string;
  reason: string;
  reviewReason: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  recognitionId: string;
  recognition: {
    id: string;
    type: string;
    sequence: number;
    effectiveRevenueCents: number;
    createdAt: string;
  };
  reversalRecognition: TrainingCorrectionView["recognition"] | null;
  attendance: {
    id: string;
    status: string;
    consumedSessions: number;
    confirmedRevenueCents: number;
    growthPointsAwarded: number;
    feedback: string | null;
    session: {
      id: string;
      startsAt: string;
      endsAt: string;
      status: string;
      class: { id: string; name: string };
    };
    enrollment: {
      id: string;
      status: string;
      student: PersonSummary | null;
      buyer: PersonSummary;
    };
  };
  requestedBy: PersonSummary;
  reviewedBy: PersonSummary | null;
}
export interface YouthTrainingRuleView {
  id: string;
  version: string;
  status: string;
  maxTotalSessions: number;
  maxValidityDays: number;
  maxContractAmountCents: number;
  warningThresholdDays: number;
  hardBlock: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface YouthTrainingRuleManagementView extends YouthTrainingRuleView {
  requestReason: string;
  reviewReason: string | null;
  isOwnRequester: boolean;
  requestedBy: { displayName: string } | null;
  reviewedBy: { displayName: string } | null;
}
