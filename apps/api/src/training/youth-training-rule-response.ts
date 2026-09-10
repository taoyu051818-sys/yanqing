import type {
  YouthTrainingRuleView,
  YouthTrainingRuleManagementView,
} from '@yanqing/shared';

// A structural projection input: persistence secrets are not part of this contract.
type ManagementRuleSource = YouthTrainingRuleView<Date> & {
  requestReason: string;
  reviewReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  requestedById: string;
  requestedBy?: { displayName: string } | null;
  reviewedBy?: { displayName: string } | null;
};
const displayNameView = (
  person?: { displayName: string } | null,
  fallback?: string | null,
) => {
  const displayName = person?.displayName?.trim()
    ? person.displayName
    : fallback;
  return displayName ? { displayName } : null;
};

/** Public policy fields needed to explain and enforce the active rule. */
export const youthTrainingRulePublicResponse = (
  rule: YouthTrainingRuleView<Date>,
): YouthTrainingRuleView<Date> => {
  return {
    id: rule.id,
    version: rule.version,
    status: rule.status,
    maxTotalSessions: rule.maxTotalSessions,
    maxValidityDays: rule.maxValidityDays,
    maxContractAmountCents: rule.maxContractAmountCents,
    warningThresholdDays: rule.warningThresholdDays,
    hardBlock: rule.hardBlock,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo ?? null,
  };
};

/**
 * Management projection for list and command responses. Idempotency material,
 * command hashes and persistence user ids intentionally never leave the API.
 */
export const youthTrainingRuleManagementResponse = (
  rule: ManagementRuleSource,
  context: {
    actorId: string;
    requestedByDisplayName?: string | null;
    reviewedByDisplayName?: string | null;
  },
): YouthTrainingRuleManagementView<Date> => {
  return {
    ...youthTrainingRulePublicResponse(rule),
    requestReason: rule.requestReason,
    reviewReason: rule.reviewReason ?? null,
    reviewedAt: rule.reviewedAt ?? null,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    isOwnRequester: rule.requestedById === context.actorId,
    requestedBy: displayNameView(
      rule.requestedBy,
      context.requestedByDisplayName,
    ),
    reviewedBy: displayNameView(rule.reviewedBy, context.reviewedByDisplayName),
  };
};
