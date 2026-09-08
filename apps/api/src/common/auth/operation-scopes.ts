import type { AuthUser } from './auth-user.js';
import { AppRole, type Prisma } from '../../generated/prisma/client.js';

export const GAME_MANAGEMENT_ROLES = [
  AppRole.HOST,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
] as const;
export const canManageGames = (roles: readonly AppRole[]) =>
  roles.some((role) =>
    (GAME_MANAGEMENT_ROLES as readonly AppRole[]).includes(role),
  );

/** Match the training list and its pending-work queue, including assistants. */
export function trainingSessionScope(
  actor?: AuthUser,
): Prisma.TrainingSessionWhereInput | undefined {
  const scoped =
    actor?.roles.includes(AppRole.COACH) &&
    !actor.roles.some((role) =>
      [
        AppRole.FRONT_DESK,
        AppRole.FINANCE,
        AppRole.ADMIN,
        AppRole.SUPER_ADMIN,
      ].includes(role as never),
    );
  return scoped
    ? { class: { OR: [{ coachId: actor!.sub }, { assistantId: actor!.sub }] } }
    : undefined;
}
