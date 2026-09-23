/** Derive a readable code from the persisted creation key, so a retry keeps the same code. */
export function automaticCode(prefix: 'CLS' | 'MEM' | 'RCG', creationKey: string): string {
  return `${prefix}-${creationKey.replace(/^create-/, '')}`.toUpperCase();
}
