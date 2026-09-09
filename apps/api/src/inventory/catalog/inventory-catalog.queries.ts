import { NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import { InventoryMode } from '../../generated/prisma/client.js';
import {
  READ_ROLES,
  AWARD_OPTION_ROLES,
  LOW_STOCK_ROLES,
  inventoryItemResponse,
} from '../shared/inventory-support.js';
import { requireRole } from './inventory-catalog.policy.js';

export function list(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, READ_ROLES);
  return prisma.inventoryItem
    .findMany({
      include: {
        supplierRecord: true,
        defaultLocation: true,
        stockBalances: { include: { location: true } },
        transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
      orderBy: [{ enabled: 'desc' }, { stock: 'asc' }],
    })
    .then((items) => items.map(inventoryItemResponse));
}

export async function detail(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
) {
  requireRole(actor, READ_ROLES);
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: {
      supplierRecord: true,
      defaultLocation: true,
      stockBalances: {
        include: { location: true },
        orderBy: [{ location: { code: 'asc' } }, { batchCode: 'asc' }],
      },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      purchaseOrderLines: {
        include: {
          purchaseOrder: { include: { supplier: true } },
          location: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      inventoryDocuments: {
        include: { sourceLocation: true, targetLocation: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!item) throw new NotFoundException('库存商品不存在');
  return inventoryItemResponse(item);
}

export function lowStock(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, LOW_STOCK_ROLES);
  return prisma.$queryRaw<
    {
      id: string;
      sku: string;
      name: string;
      mode: InventoryMode;
      stock: number;
      safeStock: number;
    }[]
  >`SELECT id, sku, name, mode, stock, "safeStock" FROM "InventoryItem" WHERE enabled = true AND stock <= "safeStock" ORDER BY stock ASC`;
}

export function awardOptions(prisma: PrismaService, actor: AuthUser) {
  requireRole(actor, AWARD_OPTION_ROLES);
  return prisma.inventoryItem.findMany({
    where: { enabled: true },
    select: {
      id: true,
      sku: true,
      name: true,
      stock: true,
      enabled: true,
    },
    orderBy: [{ stock: 'desc' }, { name: 'asc' }],
  });
}
