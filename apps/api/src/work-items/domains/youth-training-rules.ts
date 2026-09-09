import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  YouthTrainingRuleStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadYouthTrainingRules(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewYouthRules'>,
) {
  const { limit, canReviewYouthRules } = context;
  return canReviewYouthRules && prisma.youthTrainingRule?.findMany
    ? prisma.youthTrainingRule.findMany({
        where: { status: YouthTrainingRuleStatus.DRAFT },
        include: { requestedBy: { select: { displayName: true } } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapYouthTrainingRulesWorkItems(
  youthTrainingRules: Awaited<ReturnType<typeof loadYouthTrainingRules>>,
): WorkItem[] {
  return youthTrainingRules.map((rule) => ({
    id: `youth-training-rule:${rule.id}`,
    kind: 'YOUTH_TRAINING_RULE_REVIEW' as const,
    objectType: 'YouthTrainingRule',
    objectId: rule.id,
    status: rule.status,
    priority: 93,
    title: `青少年培训规则待复核 · ${rule.version}`,
    description: `${rule.requestedBy.displayName}提交 · 课时${rule.maxTotalSessions} · 有效期${rule.maxValidityDays}天 · 金额上限¥${(rule.maxContractAmountCents / 100).toFixed(2)}`,
    ownerRoles: [AppRole.SUPER_ADMIN],
    createdAt: rule.createdAt.toISOString(),
    dueAt: rule.effectiveFrom.toISOString(),
    action: `/packages/ops/pages/governance/index?focus=youth-training-rule&id=${rule.id}`,
    metadata: {
      requestedById: rule.requestedById,
      effectiveFrom: rule.effectiveFrom.toISOString(),
      hardBlock: rule.hardBlock,
    },
  }));
}
