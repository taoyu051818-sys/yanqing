import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, SettlementStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadAllianceSettlements(
  prisma: PrismaService,
  context: Pick<
    WorkItemContext,
    'limit' | 'merchantIds' | 'isMerchantOnly' | 'canReviewAlliance'
  >,
) {
  const { limit, merchantIds, isMerchantOnly, canReviewAlliance } = context;
  return canReviewAlliance
    ? prisma.allianceSettlement.findMany({
        where: isMerchantOnly
          ? {
              merchantId: { in: merchantIds || [] },
              status: SettlementStatus.PENDING_CONFIRMATION,
            }
          : {
              status: {
                in: [
                  SettlementStatus.DRAFT,
                  SettlementStatus.PENDING_CONFIRMATION,
                ],
              },
            },
        include: { merchant: { select: { name: true } } },
        orderBy: { periodEnd: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapAllianceSettlementsWorkItems(
  allianceSettlements: Awaited<ReturnType<typeof loadAllianceSettlements>>,
  context: Pick<WorkItemContext, 'isMerchantOnly'>,
): WorkItem[] {
  const { isMerchantOnly } = context;
  return allianceSettlements.map((settlement) => ({
    id: `alliance-settlement:${settlement.id}`,
    kind: 'ALLIANCE_SETTLEMENT' as const,
    objectType: 'AllianceSettlement',
    objectId: settlement.id,
    status: settlement.status,
    priority: 70,
    title: `联盟结算待处理 · ${settlement.merchant.name}`,
    description: `周期 ${settlement.periodStart.toISOString().slice(0, 10)} 至 ${settlement.periodEnd.toISOString().slice(0, 10)}`,
    ownerRoles: isMerchantOnly
      ? [AppRole.MERCHANT, AppRole.ADMIN, AppRole.SUPER_ADMIN]
      : [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: settlement.createdAt.toISOString(),
    dueAt: settlement.periodEnd.toISOString(),
    amountCents: settlement.cooperationFeeCents,
    action:
      settlement.status === SettlementStatus.PENDING_CONFIRMATION
        ? `/alliance/settlements/${settlement.id}/confirm`
        : `/alliance/settlements/${settlement.id}`,
    metadata: {
      merchantId: settlement.merchantId,
      effectiveNewCustomers: settlement.effectiveNewCustomers,
    },
  }));
}
