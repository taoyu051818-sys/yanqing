import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AppRole } from '../generated/prisma/enums.js';

/**
 * There is currently no dedicated TRAINING_SUPERVISOR value in the persisted
 * AppRole enum.  Until that enum is introduced, ADMIN and SUPER_ADMIN are the
 * only roles allowed to post a training consumption into the financial ledger.
 */
const TRAINING_APPROVER_ROLES: readonly AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export function isTrainingApprover(actor: AuthUser): boolean {
  return actor.roles.some((role) => TRAINING_APPROVER_ROLES.includes(role));
}

export function assertTrainingApprover(actor: AuthUser): void {
  if (!isTrainingApprover(actor)) {
    throw new ForbiddenException('仅培训主管或管理员可确认消课入账');
  }
}

export function hasAnyRole(
  actor: AuthUser,
  roles: readonly AppRole[],
): boolean {
  return actor.roles.some((role) => roles.includes(role));
}
