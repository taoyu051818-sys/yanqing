type RuleRecord = Record<string, any>;

const record = (value: unknown): RuleRecord =>
  value && typeof value === 'object' ? (value as RuleRecord) : {};

const displayNameView = (value: unknown, fallback?: string | null) => {
  const person = record(value);
  const displayName =
    typeof person.displayName === 'string' && person.displayName.trim()
      ? person.displayName
      : fallback;
  return displayName ? { displayName } : null;
};

/** Public policy fields needed to explain and enforce the active rule. */
export const youthTrainingRulePublicResponse = (value: unknown) => {
  const rule = record(value);
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
  value: unknown,
  context: {
    actorId: string;
    requestedByDisplayName?: string | null;
    reviewedByDisplayName?: string | null;
  },
) => {
  const rule = record(value);
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
