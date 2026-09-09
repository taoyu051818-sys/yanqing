import { PrismaService } from '../../database/prisma.service.js';
import { AppRole } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadInventory(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canOperateInventory'>,
) {
  const { limit, canOperateInventory } = context;
  return canOperateInventory
    ? prisma.inventoryItem.findMany({
        where: { enabled: true },
        select: {
          id: true,
          name: true,
          sku: true,
          stock: true,
          safeStock: true,
          updatedAt: true,
        },
        orderBy: { stock: 'asc' },
        take: Math.min(limit * 2, 200),
      })
    : Promise.resolve([]);
}

export function mapInventoryWorkItems(
  inventory: Awaited<ReturnType<typeof loadInventory>>,
  context: Pick<WorkItemContext, 'limit'>,
): WorkItem[] {
  const { limit } = context;
  return inventory
    .filter((item) => item.stock <= item.safeStock)
    .slice(0, limit)
    .map((item) => ({
      id: `stock:${item.id}`,
      kind: 'LOW_STOCK' as const,
      objectType: 'InventoryItem',
      objectId: item.id,
      status: 'OPEN',
      priority: 60,
      title: `库存低于安全线 · ${item.name}`,
      description: `当前 ${item.stock} 件，安全线 ${item.safeStock} 件`,
      ownerRoles: [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN],
      createdAt: item.updatedAt.toISOString(),
      action: `/packages/ops/pages/inventory/index?focus=low-stock&id=${item.id}`,
      metadata: {
        sku: item.sku,
        stock: item.stock,
        safeStock: item.safeStock,
      },
    }));
}
