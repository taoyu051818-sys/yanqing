const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

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
