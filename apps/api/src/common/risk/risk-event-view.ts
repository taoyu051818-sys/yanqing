const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const PENDING_RISK_STATUSES = ['OPEN', 'REVIEWING'] as const;
export const isPendingRisk = (event: { status: string }) =>
  PENDING_RISK_STATUSES.some((status) => status === event.status);

/** Keep actionable events ahead of handled history, then prefer higher severity. */
export function prioritizeRiskEvents<
  T extends { status: string; severity: string },
>(events: T[]): T[] {
  const severity: Record<string, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };
  return [...events].sort(
    (a, b) =>
      Number(isPendingRisk(b)) - Number(isPendingRisk(a)) ||
      (severity[b.severity] ?? 0) - (severity[a.severity] ?? 0),
  );
}

/** Preserve the public evidence shape while keeping each writer's data separate. */
export function riskEventView<
  T extends { evidence: unknown; handling?: unknown },
>(row: T) {
  const { handling, ...rest } = row;
  return {
    ...rest,
    evidence: handling
      ? { ...object(row.evidence), ...object(handling) }
      : row.evidence,
  };
}
