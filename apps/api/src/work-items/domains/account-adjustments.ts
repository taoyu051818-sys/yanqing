import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  AccountAdjustmentStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadAccountAdjustments(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'actor' | 'limit' | 'canReviewMoney'>,
) {
  const { actor, limit, canReviewMoney } = context;
  return canReviewMoney
    ? prisma.accountAdjustmentRequest.findMany({
        where: {
          status: AccountAdjustmentStatus.REQUESTED,
          requestedById: { not: actor.sub },
        },
        include: {
          account: { include: { user: { select: { displayName: true } } } },
          requestedBy: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapAccountAdjustmentsWorkItems(
  accountAdjustments: Awaited<ReturnType<typeof loadAccountAdjustments>>,
): WorkItem[] {
  return accountAdjustments.map((request) => ({
    id: `account-adjustment:${request.id}`,
    kind: 'ACCOUNT_ADJUSTMENT_REVIEW' as const,
    objectType: 'AccountAdjustmentRequest',
    objectId: request.id,
    status: request.status,
    priority: 98,
    title: `账户调整待复核 · ${request.account.user.displayName}`,
    description: `${request.account.type} ${request.amount > 0 ? '+' : ''}${request.amount} · ${request.reason}`,
    ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: request.createdAt.toISOString(),
    amountCents:
      request.account.type === 'CASH_PRINCIPAL' ||
      request.account.type === 'GIFT_BALANCE'
        ? request.amount
        : undefined,
    action: `/members/account-adjustments/${request.id}/approve`,
    metadata: {
      requestedBy: request.requestedBy.displayName,
      requestedById: request.requestedById,
    },
  }));
}
