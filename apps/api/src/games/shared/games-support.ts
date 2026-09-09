import { randomBytes } from 'node:crypto';
import {
  AppRole,
  GameStatus,
  OrderStatus,
  RegistrationStatus,
  RefundStatus,
} from '../../generated/prisma/client.js';
import { orderResponse } from '../../orders/order-response.js';

export const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const gameCommandResponse = (game: any) => ({
  id: game.id,
  code: game.code,
  title: game.title,
  level: game.level,
  status: game.status,
  startsAt: game.startsAt,
  endsAt: game.endsAt,
  capacity: game.capacity,
  feeCents: game.feeCents,
  newcomerOnly: game.newcomerOnly,
  description: game.description,
  cancelReason: game.cancelReason,
  cancelledAt: game.cancelledAt,
});

export const gameCancellationResponse = (value: any) => {
  const policy =
    value?.game?.cancelPolicySnapshot &&
    typeof value.game.cancelPolicySnapshot === 'object'
      ? value.game.cancelPolicySnapshot
      : {};
  return {
    game: gameCommandResponse(value.game),
    cancelledBookingCount: Number(value.cancelledBookingCount ?? 0),
    cancelledPendingOrders: Number(
      value.cancelledPendingOrders ?? policy.pendingOrderCount ?? 0,
    ),
    cancelledRegistrationCount: Number(
      value.cancelledRegistrationCount ??
        value.cancelledRegistrationIds?.length ??
        policy.registrationCount ??
        0,
    ),
    refundRequestCount: Number(
      value.refundRequestCount ??
        value.refundRequests?.length ??
        policy.refundRequestCount ??
        0,
    ),
    refundRequestedCents: Number(
      value.refundRequests?.reduce(
        (total: number, refund: any) => total + Number(refund.amountCents || 0),
        0,
      ) ??
        policy.refundRequestedCents ??
        0,
    ),
    idempotent: Boolean(value.idempotent),
  };
};

export const gameRegistrationCommandResponse = (registration: any) => ({
  id: registration.id,
  status: registration.status,
  checkedInAt: registration.checkedInAt,
});

export const gameRegistrationResponse = (value: any) => {
  if (!value?.registration) return orderResponse(value);
  return {
    status: value.status ?? value.registration.status,
    waitlistPosition: value.waitlistPosition ?? null,
    registration: { status: value.registration.status },
  };
};

export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

export const DEFAULT_HOST_REWARD_OBSERVATION_DAYS = 7;

export const HOST_REWARD_OBSERVATION_PARAMETER_KEYS = [
  'game.host_reward.refund_observation_days',
  // Keep compatibility with the parameter already shipped in the first
  // migration.  Operators can introduce the game-specific key later without
  // changing the reward workflow.
  'referral.refund_observation_days',
] as const;

export const GAME_STATUSES_ALLOWED_TO_COMPLETE: readonly GameStatus[] = [
  GameStatus.OPEN,
  GameStatus.FULL,
  GameStatus.IN_PROGRESS,
];

export const GAME_STATUSES_NOT_PUBLISHABLE: readonly GameStatus[] = [
  GameStatus.CANCELLED,
  GameStatus.FULL,
  GameStatus.IN_PROGRESS,
  GameStatus.COMPLETED,
];

export const GAME_STATUSES_ALLOWED_TO_CANCEL: readonly GameStatus[] = [
  GameStatus.DRAFT,
  GameStatus.OPEN,
  GameStatus.FULL,
];

export const ACTIVE_GAME_CANCEL_REFUND_STATUSES: readonly RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
];

export const ORDER_STATUSES_REFUNDED: readonly OrderStatus[] = [
  OrderStatus.REFUNDED,
  // A checked-in registration that has been partially refunded must not
  // continue to earn the full host incentive.  The current reward model is
  // count-based (not prorated), so it is conservatively excluded and remains
  // visible in the audit evidence for a manual adjustment if needed.
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.CANCELLED,
];

export const ORDER_STATUSES_REFUND_PENDING: readonly OrderStatus[] = [
  OrderStatus.REFUND_PENDING,
];

export const ORDER_STATUSES_WITHOUT_FULFILLMENT: ReadonlySet<OrderStatus> =
  new Set([
    OrderStatus.REFUND_PENDING,
    OrderStatus.REFUNDED,
    OrderStatus.CANCELLED,
  ]);

export const ORDER_STATUSES_WITHOUT_NO_SHOW: ReadonlySet<OrderStatus> = new Set(
  [OrderStatus.REFUND_PENDING, OrderStatus.REFUNDED, OrderStatus.CANCELLED],
);

export const GAME_DETAIL_STATUSES = [
  GameStatus.OPEN,
  GameStatus.FULL,
  GameStatus.IN_PROGRESS,
  GameStatus.COMPLETED,
  GameStatus.CANCELLED,
];

export const FINANCIAL_ROLES: readonly AppRole[] = [
  AppRole.FINANCE,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export type RewardRuleSnapshot = {
  rewardType: string;
  perCheckedIn: number;
  cap: number;
};

export type RegistrationForReward = {
  id: string;
  userId: string;
  status: RegistrationStatus;
  checkedInAt?: Date | null;
  order?: {
    id: string;
    status: OrderStatus;
    paidCents?: number;
    refundedCents?: number;
  } | null;
};

export type RewardEligibility = {
  eligible: RegistrationForReward[];
  excludedRefunded: RegistrationForReward[];
  pendingRefund: RegistrationForReward[];
  excludedSelf: RegistrationForReward[];
};
