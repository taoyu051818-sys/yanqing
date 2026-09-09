import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/client.js';

export function isCoachOnly(actor: AuthUser) {
  return (
    actor.roles.includes(AppRole.COACH) &&
    !actor.roles.some((role) =>
      (
        [
          AppRole.FRONT_DESK,
          AppRole.FINANCE,
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
        ] as AppRole[]
      ).includes(role),
    )
  );
}

export function assertAnyRole(
  actor: AuthUser,
  allowed: readonly AppRole[],
  message: string,
) {
  if (!actor.roles.some((role) => allowed.includes(role)))
    throw new ForbiddenException(message);
}
