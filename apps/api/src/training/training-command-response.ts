type JsonRecord = Record<string, any>;

const record = (value: unknown): JsonRecord =>
  value && typeof value === 'object' ? (value as JsonRecord) : {};

const compact = <T extends JsonRecord>(value: T): T => {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
};

/**
 * Training command responses intentionally contain only the identifiers and
 * business state needed by the caller. Persistence metadata, cost allocation,
 * class/product relations and command idempotency data stay server-side.
 */
export const trainingSessionCommandResponse = (value: unknown) => {
  const session = record(value);
  return compact({
    id: session.id,
    status: session.status,
  });
};

const trainingAttendanceResponse = (value: unknown) => {
  const attendance = record(value);
  return compact({
    id: attendance.id,
    sessionId: attendance.sessionId,
    enrollmentId: attendance.enrollmentId,
    status: attendance.status,
  });
};

export const trainingAttendanceCommandResponse = (value: unknown) =>
  trainingAttendanceResponse(value);

export const trainingConsumeProposalResponse = (value: unknown) => ({
  ...trainingAttendanceResponse(value),
  workflowStatus: 'PENDING_CONFIRMATION' as const,
});

export const trainingMakeupCommandResponse = (
  value: unknown,
  makeupSessionId: string,
) => ({
  ...trainingAttendanceResponse(value),
  workflowStatus: 'MAKEUP_SCHEDULED' as const,
  makeupSessionId,
});

export const trainingConsumeConfirmationResponse = (value: unknown) => {
  const recognition = record(value);
  return compact({
    id: recognition.id,
    type: recognition.type,
    sequence: recognition.sequence,
    workflowStatus: 'CONFIRMED' as const,
    effectiveRevenueCents: recognition.effectiveRevenueCents,
    venueContributionCents: recognition.venueContributionCents,
    venueFeeCents: recognition.venueFeeCents,
  });
};

export const trainingSettlementListResponse = (
  value: unknown,
  context: {
    isOwnCreator: boolean;
    createdByDisplayName: string | null;
    workflowHistory: unknown[];
  },
) => {
  const settlement = record(value);
  return compact({
    id: settlement.id,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    effectiveRevenueCents: settlement.effectiveRevenueCents,
    contractRateBps: settlement.contractRateBps,
    venueContributionCents: settlement.venueContributionCents,
    venueFeeCents: settlement.venueFeeCents,
    trainingPayableVenueCents: settlement.trainingPayableVenueCents,
    coachCostCents: settlement.coachCostCents,
    assistantCostCents: settlement.assistantCostCents,
    materialCostCents: settlement.materialCostCents,
    acquisitionCostCents: settlement.acquisitionCostCents,
    marketingCostCents: settlement.marketingCostCents,
    occupiedCourtHours: settlement.occupiedCourtHours,
    cashContributionMarginCents: settlement.cashContributionMarginCents,
    status: settlement.status,
    confirmedAt: settlement.confirmedAt,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    isOwnCreator: context.isOwnCreator,
    createdBy: context.createdByDisplayName
      ? { displayName: context.createdByDisplayName }
      : null,
    workflowHistory: context.workflowHistory,
  });
};
