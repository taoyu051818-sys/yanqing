import { randomBytes } from 'node:crypto';
import { AppRole, Prisma } from '../../generated/prisma/client.js';

export const SETTLEMENT_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const statementNo = () =>
  `CS${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

export const asRecord = (
  value: Prisma.JsonValue | null,
): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const readableConsignmentRule = (snapshot: unknown) => {
  const rule = asRecord((snapshot ?? null) as Prisma.JsonValue | null);
  return {
    supplierCode: String(rule.supplierCode || ''),
    supplierName: String(rule.supplierName || ''),
    settlementCycle: String(rule.settlementCycle || ''),
    commissionRateBps: Number(rule.commissionRateBps || 0),
    commissionMeaning: String(rule.commissionMeaning || 'VENUE_COMMISSION'),
  };
};

export const payableResponse = (entry: any) => ({
  id: entry.id,
  type: entry.type,
  quantity: entry.quantity,
  unitSalePriceCents: entry.unitSalePriceCents,
  grossSaleCents: entry.grossSaleCents,
  commissionRateBps: entry.commissionRateBps,
  commissionCents: entry.commissionCents,
  payableCents: entry.payableCents,
  occurredAt: entry.occurredAt,
  createdAt: entry.createdAt,
  businessRule: readableConsignmentRule(entry.ruleSnapshot),
  supplier: entry.supplier,
  item: entry.item,
  order: entry.order,
  refund: entry.refund ?? null,
  settlementLines: (entry.settlementLines || []).map((line: any) => ({
    id: line.id,
    quantity: line.quantity,
    grossSaleCents: line.grossSaleCents,
    commissionCents: line.commissionCents,
    payableCents: line.payableCents,
    releasedAt: line.releasedAt ?? null,
    createdAt: line.createdAt,
    settlement: line.settlement,
  })),
});

export const settlementResponse = (settlement: any, actorId: string) => ({
  id: settlement.id,
  statementNo: settlement.statementNo,
  supplier: settlement.supplier,
  periodStart: settlement.periodStart,
  periodEnd: settlement.periodEnd,
  version: settlement.version,
  status: settlement.status,
  entryCount: settlement.entryCount,
  netQuantity: settlement.netQuantity,
  grossSaleCents: settlement.grossSaleCents,
  commissionCents: settlement.commissionCents,
  payableCents: settlement.payableCents,
  businessRule: readableConsignmentRule(settlement.ruleSnapshot),
  creationReason: settlement.creationReason,
  submittedAt: settlement.submittedAt ?? null,
  confirmedAt: settlement.confirmedAt ?? null,
  settledAt: settlement.settledAt ?? null,
  voidedAt: settlement.voidedAt ?? null,
  paymentReference: settlement.paymentReference ?? null,
  createdAt: settlement.createdAt,
  updatedAt: settlement.updatedAt,
  isOwnCreator: settlement.createdById === actorId,
  createdBy: settlement.createdBy
    ? { displayName: settlement.createdBy.displayName }
    : null,
  submittedBy: settlement.submittedBy
    ? { displayName: settlement.submittedBy.displayName }
    : null,
  confirmedBy: settlement.confirmedBy
    ? { displayName: settlement.confirmedBy.displayName }
    : null,
  settledBy: settlement.settledBy
    ? { displayName: settlement.settledBy.displayName }
    : null,
  voidedBy: settlement.voidedBy
    ? { displayName: settlement.voidedBy.displayName }
    : null,
  transitions: (Array.isArray(settlement.transitions)
    ? settlement.transitions
    : []
  ).map((transition: any) => ({
    id: transition.id,
    action: transition.action,
    fromStatus: transition.fromStatus ?? null,
    toStatus: transition.toStatus,
    reason: transition.reason,
    actor: transition.actor
      ? { displayName: transition.actor.displayName }
      : null,
    createdAt: transition.createdAt,
  })),
  lines: (Array.isArray(settlement.lines) ? settlement.lines : []).map(
    (line: any) => ({
      id: line.id,
      quantity: line.quantity,
      grossSaleCents: line.grossSaleCents,
      commissionCents: line.commissionCents,
      payableCents: line.payableCents,
      releasedAt: line.releasedAt ?? null,
      createdAt: line.createdAt,
      payableEntry: line.payableEntry
        ? payableResponse(line.payableEntry)
        : undefined,
    }),
  ),
});
