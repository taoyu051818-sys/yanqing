import { BadRequestException } from '@nestjs/common';
import {
  AppRole,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ReconciliationPeriodStatus,
  RefundStatus,
} from '../generated/prisma/client.js';

export const CLOSE_ROLES = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
] as const;

export const PENDING_REFUNDS = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
] as const;

export const PENDING_PAYMENTS = [
  PaymentStatus.CREATED,
  PaymentStatus.PROCESSING,
] as const;

export const FINAL_ORDER_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.REFUND_PENDING,
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.REFUNDED,
] as const;

export const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ReconciliationTotals {
  orderPaidCents: number;
  orderRefundedCents: number;
  successfulPaymentCents: number;
  completedRefundCents: number;
  trainingEffectiveRevenueCents: number;
  trainingVenueContributionCents: number;
  trainingSettlementVenueContributionCents: number;
  allianceAttributedGmvCents: number;
  allianceCooperationFeeCents: number;
  consignmentPayableCents: number;
  consignmentSettledPayableCents: number;
  inventoryTransactionCount: number;
  inventoryCostCents: number;
}

export type ReconciliationBlockerKind =
  | 'PENDING_REFUNDS'
  | 'PENDING_PAYMENTS'
  | 'OPEN_FRONT_DESK_SHIFTS'
  | 'UNREVIEWED_CASH_VARIANCES'
  | 'UNFULFILLED_ORDERS'
  | 'UNFULFILLED_TRAINING_SESSIONS';

export interface ReconciliationBlocker {
  kind: ReconciliationBlockerKind;
  count: number;
  message: string;
}

export interface ReconciliationView {
  id?: string;
  businessDate: Date;
  status: ReconciliationPeriodStatus;
  totals: ReconciliationTotals | Record<string, unknown>;
  exceptionCount: number;
  closedById: string | null;
  closedAt: Date | null;
  detail: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
  blocked?: boolean;
  blockers?: ReconciliationBlocker[];
}

export interface BusinessDay {
  label: string;
  start: Date;
  end: Date;
}

export interface Snapshot {
  totals: ReconciliationTotals;
  blockers: ReconciliationBlocker[];
}

export function parseBusinessDay(input: string): BusinessDay {
  const match = DATE_PATTERN.exec(input);
  if (!match) throw new BadRequestException('业务日期必须为 YYYY-MM-DD');
  const start = new Date(`${input}T00:00:00+08:00`);
  const end = new Date(`${input}T24:00:00+08:00`);
  if (Number.isNaN(start.getTime()) || formatShanghaiDate(start) !== input) {
    throw new BadRequestException('业务日期无效');
  }
  return { label: input, start, end };
}

export function formatShanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
