import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, EventPrizeStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadPrizeReceipts(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canOperateEvents'>,
) {
  const { limit, canOperateEvents } = context;
  return canOperateEvents
    ? prisma.eventPrizeAward.findMany({
        where: { status: EventPrizeStatus.ISSUED },
        include: {
          event: { select: { name: true } },
          team: { select: { name: true } },
          inventoryItem: { select: { name: true, sku: true } },
        },
        orderBy: { issuedAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapPrizeReceiptsWorkItems(
  prizeReceipts: Awaited<ReturnType<typeof loadPrizeReceipts>>,
): WorkItem[] {
  return prizeReceipts.map((award) => ({
    id: `event-prize-receipt:${award.id}`,
    kind: 'EVENT_PRIZE_RECEIPT' as const,
    objectType: 'EventPrizeAward',
    objectId: award.id,
    status: award.status,
    priority: 82,
    title: `奖品待签收 · ${award.event.name}`,
    description: `${award.team.name} · ${award.awardName} · ${award.inventoryItem.name} × ${award.quantity}`,
    ownerRoles: [
      AppRole.EVENT_MANAGER,
      AppRole.FRONT_DESK,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ],
    createdAt: award.issuedAt.toISOString(),
    action: `/events/${award.eventId}/prizes/${award.id}/receive`,
    metadata: {
      eventId: award.eventId,
      teamId: award.teamId,
      sku: award.inventoryItem.sku,
      recipientNames: award.recipientNames,
    },
  }));
}
