import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, RefundStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadRefunds(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewMoney'>,
) {
  const { limit, canReviewMoney } = context;
  return canReviewMoney
    ? prisma.refund.findMany({
        where: { status: RefundStatus.REQUESTED },
        include: {
          order: { select: { orderNo: true, title: true, memberId: true } },
        },
        orderBy: { requestedAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapRefundsWorkItems(
  refunds: Awaited<ReturnType<typeof loadRefunds>>,
): WorkItem[] {
  return refunds.map((refund) => ({
    id: `refund:${refund.id}`,
    kind: 'REFUND_REVIEW' as const,
    objectType: 'Refund',
    objectId: refund.id,
    status: refund.status,
    priority: 100,
    title: `退款待审核 · ${refund.order.orderNo}`,
    description: `${refund.order.title}，申请金额 ¥${(refund.amountCents / 100).toFixed(2)}`,
    ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: refund.requestedAt.toISOString(),
    amountCents: refund.amountCents,
    action: `/orders/refunds/${refund.id}/approve`,
    metadata: {
      orderNo: refund.order.orderNo,
      memberId: refund.order.memberId,
    },
  }));
}
