import { createHash } from 'node:crypto';
import {
  AccountType,
  AppRole,
  OrderStatus,
  SourceChannel,
  TrainingEnrollmentStatus,
} from '../../generated/prisma/client.js';

export const LEAD_WRITE_ROLES: AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const LEAD_VIEW_ROLES: AppRole[] = [...LEAD_WRITE_ROLES, AppRole.COACH];

export const referralInviteTokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const ACTIVE_TRAINING_STATUSES: TrainingEnrollmentStatus[] = [
  TrainingEnrollmentStatus.ACTIVE,
  TrainingEnrollmentStatus.COMPLETED,
  TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
];

export const FUNNEL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

export const FRONT_DESK_ACCOUNT_TYPES: AccountType[] = [
  AccountType.CASH_PRINCIPAL,
  AccountType.GIFT_BALANCE,
  AccountType.BADMINTON_COIN,
];

export const maskPhone = (phone: string | null | undefined) => {
  if (!phone) return null;
  if (phone.length <= 4) return '*'.repeat(phone.length);
  if (phone.length <= 7) return `${phone.slice(0, 2)}***${phone.slice(-2)}`;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

export const frontDeskPaymentSummary = (
  accounts: Array<{
    type: AccountType;
    balance: number;
    frozenBalance: number;
  }>,
) => ({
  storedValueAvailableCents: accounts
    .filter((account) =>
      (
        [AccountType.CASH_PRINCIPAL, AccountType.GIFT_BALANCE] as AccountType[]
      ).includes(account.type),
    )
    .reduce(
      (total, account) =>
        total + Math.max(0, account.balance - account.frozenBalance),
      0,
    ),
  badmintonCoinAvailable: accounts
    .filter((account) => account.type === AccountType.BADMINTON_COIN)
    .reduce(
      (total, account) =>
        total + Math.max(0, account.balance - account.frozenBalance),
      0,
    ),
});

export const accountTransactionResponse = (transaction: any) => ({
  id: transaction.id,
  kind: transaction.kind,
  amount: transaction.amount,
  balanceBefore: transaction.balanceBefore,
  balanceAfter: transaction.balanceAfter,
  reasonCode: transaction.reasonCode,
  reason: transaction.reason,
  expiresAt: transaction.expiresAt ?? null,
  createdAt: transaction.createdAt,
  account: transaction.account ? { type: transaction.account.type } : undefined,
  operator: transaction.operator
    ? { displayName: transaction.operator.displayName }
    : null,
});

export const accountAdjustmentResponse = (request: any, actorId?: string) => ({
  id: request.id,
  amount: request.amount,
  reason: request.reason,
  status: request.status,
  reviewReason: request.reviewReason ?? null,
  reviewedAt: request.reviewedAt ?? null,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  isOwnRequest: actorId ? request.requestedById === actorId : undefined,
  account: request.account
    ? {
        type: request.account.type,
        balance: request.account.balance,
        frozenBalance: request.account.frozenBalance,
        user: request.account.user
          ? {
              displayName: request.account.user.displayName,
              phone: request.account.user.phone,
            }
          : undefined,
      }
    : undefined,
  requestedBy: request.requestedBy
    ? { displayName: request.requestedBy.displayName }
    : undefined,
  reviewedBy: request.reviewedBy
    ? { displayName: request.reviewedBy.displayName }
    : null,
  transaction: request.transaction
    ? accountTransactionResponse(request.transaction)
    : null,
});

export type FunnelBucket = {
  sourceChannel: SourceChannel;
  campaign: string | null;
  leads: number;
  contacted: number;
  trialReserved: number;
  attended: number;
  converted: number;
  lost: number;
  registeredMembers: number;
  firstVisits: number;
  payingMemberIds: Set<string>;
  paidOrders: number;
  netGmvCents: number;
  trainingMemberIds: Set<string>;
  trainingNetGmvCents: number;
};
