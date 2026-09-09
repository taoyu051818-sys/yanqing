import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, SettlementStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadConsignmentSettlements(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'actor' | 'limit' | 'canReviewMoney'>,
) {
  const { actor, limit, canReviewMoney } = context;
  return canReviewMoney && prisma.consignmentSettlement?.findMany
    ? prisma.consignmentSettlement.findMany({
        where: {
          OR: [
            { status: SettlementStatus.DRAFT },
            {
              status: {
                in: [
                  SettlementStatus.PENDING_CONFIRMATION,
                  SettlementStatus.CONFIRMED,
                ],
              },
              createdById: { not: actor.sub },
            },
          ],
        },
        include: { supplier: { select: { name: true, code: true } } },
        orderBy: [{ periodEnd: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapConsignmentSettlementsWorkItems(
  consignmentSettlements: Awaited<
    ReturnType<typeof loadConsignmentSettlements>
  >,
): WorkItem[] {
  return consignmentSettlements.map((settlement) => ({
    id: `consignment-settlement:${settlement.id}`,
    kind: 'CONSIGNMENT_SETTLEMENT' as const,
    objectType: 'ConsignmentSettlement',
    objectId: settlement.id,
    status: settlement.status,
    priority: 78,
    title:
      settlement.status === SettlementStatus.DRAFT
        ? `寄售结算草稿待提交 · ${settlement.supplier.name}`
        : settlement.status === SettlementStatus.PENDING_CONFIRMATION
          ? `寄售结算待复核 · ${settlement.supplier.name}`
          : `寄售结算待付款 · ${settlement.supplier.name}`,
    description: `${settlement.statementNo} · ${settlement.entryCount} 条明细 · 应付 ¥${(settlement.payableCents / 100).toFixed(2)}`,
    ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: settlement.createdAt.toISOString(),
    dueAt: settlement.periodEnd.toISOString(),
    amountCents: settlement.payableCents,
    action: `/packages/ops/pages/finance/index?focus=consignment-settlement&id=${settlement.id}`,
    metadata: {
      statementNo: settlement.statementNo,
      supplierId: settlement.supplierId,
      supplierCode: settlement.supplier.code,
      createdById: settlement.createdById,
      entryCount: settlement.entryCount,
    },
  }));
}
