import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, SettlementStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadTrainingSettlements(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewMoney'>,
) {
  const { limit, canReviewMoney } = context;
  return canReviewMoney
    ? prisma.trainingSettlement.findMany({
        where: {
          status: {
            in: [
              SettlementStatus.DRAFT,
              SettlementStatus.PENDING_CONFIRMATION,
              SettlementStatus.CONFIRMED,
            ],
          },
        },
        orderBy: { periodEnd: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapTrainingSettlementsWorkItems(
  trainingSettlements: Awaited<ReturnType<typeof loadTrainingSettlements>>,
): WorkItem[] {
  return trainingSettlements.map((settlement) => ({
    id: `training-settlement:${settlement.id}`,
    kind: 'TRAINING_SETTLEMENT' as const,
    objectType: 'TrainingSettlement',
    objectId: settlement.id,
    status: settlement.status,
    priority: 75,
    title:
      settlement.status === SettlementStatus.DRAFT
        ? '培训结算草稿待提交'
        : settlement.status === SettlementStatus.PENDING_CONFIRMATION
          ? '培训结算待复核确认'
          : '培训结算待入账',
    description: `有效流水 ¥${(settlement.effectiveRevenueCents / 100).toFixed(2)} · 场馆20% ¥${(settlement.venueContributionCents / 100).toFixed(2)}`,
    ownerRoles: [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: settlement.createdAt.toISOString(),
    dueAt: settlement.periodEnd.toISOString(),
    amountCents: settlement.venueContributionCents,
    action: `/packages/ops/pages/finance/index?focus=training-settlement&id=${settlement.id}`,
    metadata: {
      venueFeeCents: settlement.venueFeeCents,
      trainingPayableVenueCents: settlement.trainingPayableVenueCents,
    },
  }));
}
