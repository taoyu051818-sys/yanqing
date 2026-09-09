import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, HostStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadHostApplications(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewHosts'>,
) {
  const { limit, canReviewHosts } = context;
  return canReviewHosts
    ? prisma.hostProfile.findMany({
        where: { status: HostStatus.APPLIED },
        include: {
          user: {
            select: {
              displayName: true,
              memberProfile: { select: { level: true, visitCount: true } },
            },
          },
        },
        orderBy: { appliedAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapHostApplicationsWorkItems(
  hostApplications: Awaited<ReturnType<typeof loadHostApplications>>,
): WorkItem[] {
  return hostApplications.map((application) => ({
    id: `host-application:${application.id}`,
    kind: 'HOST_APPLICATION_REVIEW' as const,
    objectType: 'HostProfile',
    objectId: application.id,
    status: application.status,
    priority: 88,
    title: `主理人申请待审核 · ${application.user.displayName}`,
    description: `${application.user.memberProfile?.level || '普通会员'} · 到店 ${application.user.memberProfile?.visitCount || 0} 次`,
    ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: application.appliedAt.toISOString(),
    action: `/games/hosts/${application.userId}/approve`,
    metadata: { userId: application.userId },
  }));
}
