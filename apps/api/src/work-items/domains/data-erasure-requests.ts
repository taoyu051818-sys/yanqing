import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  DataErasureRequestStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadDataErasureRequests(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewErasure'>,
) {
  const { limit, canReviewErasure } = context;
  return canReviewErasure && prisma.dataErasureRequest?.findMany
    ? prisma.dataErasureRequest.findMany({
        where: { status: DataErasureRequestStatus.REQUESTED },
        include: {
          user: {
            select: {
              displayName: true,
              status: true,
              primaryRole: true,
            },
          },
        },
        orderBy: { requestedAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapDataErasureRequestsWorkItems(
  dataErasureRequests: Awaited<ReturnType<typeof loadDataErasureRequests>>,
): WorkItem[] {
  return dataErasureRequests.map((request) => ({
    id: `data-erasure:${request.id}`,
    kind: 'DATA_ERASURE_REVIEW' as const,
    objectType: 'DataErasureRequest',
    objectId: request.id,
    status: request.status,
    priority: 99,
    title: `账号注销待复核 · ${request.user.displayName}`,
    description: `${request.user.status} · ${request.user.primaryRole} · ${request.reason}`,
    ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: request.requestedAt.toISOString(),
    action: `/packages/ops/pages/governance/index?focus=privacy&id=${request.id}`,
    metadata: { userId: request.userId, requestedById: request.userId },
  }));
}
