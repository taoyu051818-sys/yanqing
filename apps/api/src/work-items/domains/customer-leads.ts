import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, LeadStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadCustomerLeads(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canOperateCustomers'>,
) {
  const { limit, canOperateCustomers } = context;
  return canOperateCustomers
    ? prisma.customerLead.findMany({
        where: {
          status: {
            notIn: [LeadStatus.CONVERTED, LeadStatus.LOST, LeadStatus.ARCHIVED],
          },
        },
        include: { owner: { select: { id: true, displayName: true } } },
        orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapCustomerLeadsWorkItems(
  customerLeads: Awaited<ReturnType<typeof loadCustomerLeads>>,
  context: Pick<WorkItemContext, 'now'>,
): WorkItem[] {
  const { now } = context;
  return customerLeads.map((lead) => ({
    id: `customer-lead:${lead.id}`,
    kind: 'CUSTOMER_LEAD_SLA' as const,
    objectType: 'CustomerLead',
    objectId: lead.id,
    status: lead.status,
    priority: lead.slaDueAt.getTime() < now ? 95 : 65,
    title: `${lead.slaDueAt.getTime() < now ? '线索已逾期' : '客户待跟进'} · ${lead.displayName}`,
    description: `${lead.campaign || lead.sourceChannel} · 负责人 ${lead.owner?.displayName || '待认领'}`,
    ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: lead.createdAt.toISOString(),
    dueAt: lead.slaDueAt.toISOString(),
    action: `/members/leads/${lead.id}`,
    metadata: {
      ownerId: lead.ownerId,
      sourceChannel: lead.sourceChannel,
      campaign: lead.campaign,
      overdue: lead.slaDueAt.getTime() < now,
    },
  }));
}
