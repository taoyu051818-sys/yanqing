import type { GameListItem } from '@yanqing/shared';
import type { PrismaService } from '../../database/prisma.service.js';
import { GameStatus, type Prisma } from '../../generated/prisma/client.js';
import { GAME_SEAT_STATUSES } from '../game-registration-policy.js';

// Guests receive published activity metadata and counts, never member/order records.
export const PUBLIC_GAME_LIST_SELECT = {
  id: true,
  title: true,
  level: true,
  status: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  feeCents: true,
  newcomerOnly: true,
  description: true,
  host: { select: { displayName: true, avatarUrl: true } },
  _count: {
    select: {
      registrations: { where: { status: { in: [...GAME_SEAT_STATUSES] } } },
    },
  },
} satisfies Prisma.GameSelect;

export async function publicGameList(
  prisma: PrismaService,
): Promise<GameListItem<Date>[]> {
  const games = await prisma.game.findMany({
    where: {
      status: {
        in: [
          GameStatus.OPEN,
          GameStatus.FULL,
          GameStatus.IN_PROGRESS,
          GameStatus.COMPLETED,
        ],
      },
    },
    select: PUBLIC_GAME_LIST_SELECT,
    orderBy: { startsAt: 'desc' },
  });
  return games.map((game) => ({ ...game, myRegistration: null }));
}
