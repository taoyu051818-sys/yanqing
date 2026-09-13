import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';

export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

export const lifecycleCommandHash = (command: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(command)).digest('hex');

export const couponBatchCode = (requestId: string, index: number) =>
  `YQ-${createHash('sha256').update(requestId).digest('hex').toUpperCase()}-${String(index + 1).padStart(4, '0')}`;

export const NEWCOMER_COUPON_PREFIX = 'NEWCOMER';

export const NEWCOMER_VALIDITY_PARAMETER = 'newcomer.experience.valid_days';

export const DEFAULT_NEWCOMER_VALIDITY_DAYS = 7;

export const couponRedemptionResponse = <T extends Record<string, unknown>>(
  coupon: T,
) => {
  const { idempotencyKey: _idempotencyKey, ...response } = coupon;
  return response;
};

export const allianceSettlementResponse = (settlement: any) => {
  const detail =
    settlement.detail &&
    typeof settlement.detail === 'object' &&
    !Array.isArray(settlement.detail)
      ? (settlement.detail as Record<string, unknown>)
      : {};
  const workflowHistory = Array.isArray(detail.workflowHistory)
    ? detail.workflowHistory.map((entry: any) => ({
        action: entry.action,
        state: entry.state,
        reason: entry.reason ?? null,
        at: entry.at,
      }))
    : [];
  return {
    id: settlement.id,
    merchantId: settlement.merchantId,
    merchant: settlement.merchant
      ? {
          id: settlement.merchant.id,
          code: settlement.merchant.code,
          name: settlement.merchant.name,
        }
      : undefined,
    periodStart: settlement.periodStart,
    periodEnd: settlement.periodEnd,
    issuedCount: settlement.issuedCount,
    claimedCount: settlement.claimedCount,
    redeemedCount: settlement.redeemedCount,
    effectiveNewCustomers: settlement.effectiveNewCustomers,
    attributedGmvCents: settlement.attributedGmvCents,
    attributedGrossProfitCents: settlement.attributedGrossProfitCents,
    cooperationFeeCents: settlement.cooperationFeeCents,
    roi: settlement.roi,
    status: settlement.status,
    confirmedAt: settlement.confirmedAt ?? null,
    settledAt: settlement.settledAt ?? null,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
    detail: {
      workflowState: detail.workflowState ?? settlement.status,
      workflowHistory,
      revisionHistory: Array.isArray(detail.revisionHistory)
        ? detail.revisionHistory.map((entry: any) => ({
            version: entry.version,
            reason: entry.reason,
            at: entry.at,
            before: entry.before,
            after: entry.after,
          }))
        : [],
    },
  };
};
