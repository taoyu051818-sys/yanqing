import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  EventStatus,
  MatchStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadMatches(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canOperateEvents'>,
) {
  const { limit, canOperateEvents } = context;
  return canOperateEvents
    ? prisma.eventMatch.findMany({
        where: {
          status: { in: [MatchStatus.PENDING, MatchStatus.SUBMITTED] },
          event: {
            status: { in: [EventStatus.IN_PROGRESS, EventStatus.FULL] },
          },
        },
        include: { event: { select: { name: true, startsAt: true } } },
        orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapMatchesWorkItems(
  matches: Awaited<ReturnType<typeof loadMatches>>,
): WorkItem[] {
  return matches.map((match) => ({
    id: `event-score:${match.id}`,
    kind: 'EVENT_SCORE' as const,
    objectType: 'EventMatch',
    objectId: match.id,
    status: match.status,
    priority: 85,
    title: `第${match.round}轮待录比分 · ${match.event.name}`,
    description: `赛事开始于 ${match.event.startsAt.toISOString()}`,
    ownerRoles: [
      AppRole.EVENT_MANAGER,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ],
    createdAt: match.createdAt.toISOString(),
    action: `/events/matches/${match.id}/score`,
    metadata: {
      eventId: match.eventId,
      round: match.round,
      courtLabel: match.courtLabel,
    },
  }));
}
