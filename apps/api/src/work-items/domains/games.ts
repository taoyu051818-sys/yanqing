import { GAME_MANAGEMENT_ROLES } from '../../common/auth/operation-scopes.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  GameStatus,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadGames(
  prisma: PrismaService,
  context: Pick<
    WorkItemContext,
    | 'actor'
    | 'limit'
    | 'roles'
    | 'nowDate'
    | 'canOperateGames'
    | 'isOperationsAdmin'
  >,
) {
  const { actor, limit, roles, nowDate, canOperateGames, isOperationsAdmin } =
    context;
  return canOperateGames && prisma.game?.findMany
    ? prisma.game.findMany({
        where: {
          status: {
            in: [GameStatus.OPEN, GameStatus.FULL, GameStatus.IN_PROGRESS],
          },
          startsAt: { lte: nowDate },
          ...(roles.includes(AppRole.HOST) && !isOperationsAdmin
            ? { hostId: actor.sub }
            : {}),
        },
        select: {
          id: true,
          title: true,
          hostId: true,
          status: true,
          startsAt: true,
          endsAt: true,
          _count: {
            select: {
              registrations: {
                where: {
                  status: {
                    in: [
                      RegistrationStatus.PAID,
                      RegistrationStatus.CHECKED_IN,
                    ],
                  },
                },
              },
            },
          },
        },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapGamesWorkItems(
  games: Awaited<ReturnType<typeof loadGames>>,
  context: Pick<WorkItemContext, 'now'>,
): WorkItem[] {
  const { now } = context;
  return games.map((game) => {
    const ended = game.endsAt.getTime() <= now;
    return {
      id: `game-operation:${game.id}`,
      kind: 'GAME_OPERATION' as const,
      objectType: 'Game',
      objectId: game.id,
      status: game.status,
      priority: ended ? 90 : 84,
      title: `${ended ? '球局待完赛' : '球局现场待处理'} · ${game.title}`,
      description: `${game._count.registrations} 名已支付/签到 · 主理人现场队列`,
      ownerRoles: [...GAME_MANAGEMENT_ROLES],
      createdAt: game.startsAt.toISOString(),
      dueAt: (ended ? game.endsAt : game.startsAt).toISOString(),
      action: `/packages/ops/pages/host/index?focus=game&gameId=${game.id}`,
      metadata: {
        gameId: game.id,
        hostId: game.hostId,
        activeRegistrationCount: game._count.registrations,
        startsAt: game.startsAt.toISOString(),
        endsAt: game.endsAt.toISOString(),
      },
    };
  });
}
