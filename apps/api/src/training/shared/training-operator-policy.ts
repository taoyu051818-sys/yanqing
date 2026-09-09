import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole } from '../../generated/prisma/client.js';

export function assertTrainingRole(
  actor: AuthUser,
  allowed: readonly AppRole[],
  message: string,
): void {
  if (!actor.roles.some((role) => allowed.includes(role))) {
    throw new ForbiddenException(message);
  }
}

export function trainingActorRole(
  actor: AuthUser,
  allowed: readonly AppRole[],
): AppRole | undefined {
  return actor.roles.find((role) => allowed.includes(role)) ?? actor.roles[0];
}
