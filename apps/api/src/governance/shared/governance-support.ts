import { createHash } from 'node:crypto';
import { AppRole } from '../../generated/prisma/client.js';

export type RiskAction = 'REVIEW' | 'RESOLVE' | 'DISMISS';

export type GovernanceCommandReplay = {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  newValue: unknown;
};

export const canonicalRoles = (roles: AppRole[]) => [...new Set(roles)].sort();

export const roleKey = (role: AppRole, merchantId?: string | null) =>
  `${role}:${role === AppRole.MERCHANT ? (merchantId ?? '') : ''}`;

export const commandHash = (command: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(command)).digest('hex');

export const isPrismaErrorCode = (error: unknown, code: string) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code,
  );

export const SENSITIVE_EVIDENCE_KEY =
  /(?:authorization|cookie|password|secret|token|session|openid|unionid)/i;

export const redactEvidence = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_EVIDENCE_KEY.test(key) ? '[REDACTED]' : redactEvidence(nested),
    ]),
  );
};
