/** Read contracts shared by management APIs and the miniapp; JSON timestamps use strings. */
interface PersonSummary {
  id: string;
  displayName: string;
}

export interface TrainingCorrectionView<D = string> {
  id: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  reason: string;
  reviewReason: string | null;
  requestedAt: D;
  reviewedAt: D | null;
  recognitionId: string;
  recognition: {
    id: string;
    type: string;
    sequence: number;
    effectiveRevenueCents: number;
    createdAt: D;
  };
  reversalRecognition: TrainingCorrectionView<D>["recognition"] | null;
  attendance: {
    id: string;
    status: string;
    consumedSessions: number;
    confirmedRevenueCents: number;
    growthPointsAwarded: number;
    feedback: string | null;
    session: {
      id: string;
      startsAt: D;
      endsAt: D;
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
export interface YouthTrainingRuleView<D = string> {
  id: string;
  version: string;
  status: "DRAFT" | "PUBLISHED" | "REJECTED" | "SUPERSEDED";
  maxTotalSessions: number;
  maxValidityDays: number;
  maxContractAmountCents: number;
  warningThresholdDays: number;
  hardBlock: boolean;
  effectiveFrom: D;
  effectiveTo: D | null;
}
export interface YouthTrainingRuleManagementView<
  D = string,
> extends YouthTrainingRuleView<D> {
  reviewedAt: D | null;
  createdAt: D;
  updatedAt: D;
  requestReason: string;
  reviewReason: string | null;
  isOwnRequester: boolean;
  requestedBy: { displayName: string } | null;
  reviewedBy: { displayName: string } | null;
}
