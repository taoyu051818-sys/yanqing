import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  AccountType,
  AppRole,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import {
  ORDER_STATUSES_REFUNDED,
  ORDER_STATUSES_REFUND_PENDING,
  RewardRuleSnapshot,
  RegistrationForReward,
  RewardEligibility,
} from './games-support.js';

export function assertGameOperator(
  hostId: string,
  actor: AuthUser,
  options: { allowFrontDesk?: boolean } = {},
): void {
  const elevated = actor.roles.some((role) =>
    [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
  );
  const frontDesk =
    options.allowFrontDesk && actor.roles.includes(AppRole.FRONT_DESK);
  if (hostId !== actor.sub && !elevated && !frontDesk) {
    throw new ForbiddenException('只有本局主理人或管理员可操作该球局');
  }
}

export function rewardEligibility(
  registrations: ReadonlyArray<RegistrationForReward>,
  hostId: string,
): RewardEligibility {
  const checkedIn = registrations.filter(
    (item) =>
      item.status === RegistrationStatus.CHECKED_IN ||
      item.status === RegistrationStatus.COMPLETED,
  );
  const excludedSelf = checkedIn.filter((item) => item.userId === hostId);
  const excludedRefunded = checkedIn.filter((item) =>
    Boolean(item.order && ORDER_STATUSES_REFUNDED.includes(item.order.status)),
  );
  const pendingRefund = checkedIn.filter((item) =>
    Boolean(
      item.order && ORDER_STATUSES_REFUND_PENDING.includes(item.order.status),
    ),
  );
  const excludedIds = new Set([
    ...excludedRefunded.map((item) => item.id),
    ...excludedSelf.map((item) => item.id),
  ]);
  return {
    eligible: checkedIn.filter((item) => !excludedIds.has(item.id)),
    excludedRefunded,
    pendingRefund,
    excludedSelf,
  };
}

export function rewardRuleSnapshot(value: unknown): RewardRuleSnapshot {
  const rule =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const perCheckedIn =
    typeof rule.perCheckedIn === 'number' && Number.isFinite(rule.perCheckedIn)
      ? Math.max(0, Math.round(rule.perCheckedIn))
      : 20;
  const cap =
    typeof rule.cap === 'number' && Number.isFinite(rule.cap)
      ? Math.max(0, Math.round(rule.cap))
      : 500;
  const rewardType =
    typeof rule.type === 'string' && rule.type.trim()
      ? rule.type.trim()
      : AccountType.BADMINTON_COIN;
  return { rewardType, perCheckedIn, cap };
}
