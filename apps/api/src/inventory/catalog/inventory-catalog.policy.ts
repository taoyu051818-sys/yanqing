import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  InventoryMode,
  InventoryOperationStatus,
  OrderStatus,
  Prisma,
  PurchaseOrderStatus,
  StocktakeStatus,
  SupplierType,
} from '../../generated/prisma/client.js';
import { hasRole } from '../shared/inventory-support.js';

export async function itemReplay(
  prisma: PrismaService,
  action: string,
  requestId: string,
  hash: string,
  actor: AuthUser,
  transaction?: Prisma.TransactionClient,
) {
  const client = transaction ?? prisma;
  const audit = await client.auditLog.findFirst({
    where: { action, requestId, objectType: 'InventoryItem' },
    orderBy: { createdAt: 'desc' },
  });
  if (!audit) return null;
  if (audit.actorId !== actor.sub)
    throw new ConflictException('商品资料幂等键已由其他操作人使用');
  const value =
    audit.newValue && typeof audit.newValue === 'object'
      ? (audit.newValue as Record<string, unknown>)
      : null;
  if (value?.commandHash !== hash)
    throw new ConflictException('幂等键已用于其他商品资料指令');
  if (!audit.objectId)
    throw new ConflictException('商品资料幂等记录不完整，请联系管理员');
  const item = await client.inventoryItem.findUnique({
    where: { id: audit.objectId },
  });
  if (!item) throw new NotFoundException('幂等指令对应的商品不存在');
  return item;
}

export function assertModeMatchesSupplier(
  mode: InventoryMode,
  supplierType: SupplierType,
) {
  const expected =
    mode === InventoryMode.CONSIGNMENT
      ? SupplierType.CONSIGNMENT
      : SupplierType.OWNED;
  if (supplierType !== expected) {
    throw new BadRequestException(
      mode === InventoryMode.CONSIGNMENT
        ? '代销 SKU 必须绑定寄售供应商'
        : '自营 SKU 必须绑定自营采购供应商',
    );
  }
}

export async function assertItemCanDisable(
  tx: Prisma.TransactionClient,
  item: { id: string; stock: number },
) {
  const [openPurchaseLines, openStocktakeLines, openOperations, pendingOrders] =
    await Promise.all([
      tx.purchaseOrderLine.count({
        where: {
          itemId: item.id,
          purchaseOrder: {
            status: {
              in: [
                PurchaseOrderStatus.DRAFT,
                PurchaseOrderStatus.SUBMITTED,
                PurchaseOrderStatus.APPROVED,
                PurchaseOrderStatus.PARTIAL_RECEIVED,
              ],
            },
          },
        },
      }),
      tx.stocktakeLine.count({
        where: {
          itemId: item.id,
          stocktake: {
            status: {
              in: [
                StocktakeStatus.DRAFT,
                StocktakeStatus.COUNTING,
                StocktakeStatus.REVIEW,
              ],
            },
          },
        },
      }),
      tx.inventoryOperation.count({
        where: {
          itemId: item.id,
          status: {
            in: [
              InventoryOperationStatus.DRAFT,
              InventoryOperationStatus.SUBMITTED,
              InventoryOperationStatus.APPROVED,
            ],
          },
        },
      }),
      tx.orderItem.count({
        where: {
          itemId: item.id,
          order: {
            businessType: BusinessType.GOODS,
            status: OrderStatus.PENDING,
          },
        },
      }),
    ]);
  const blockers = [
    item.stock !== 0 ? `现存库存 ${item.stock}` : '',
    openPurchaseLines ? `未完采购明细 ${openPurchaseLines}` : '',
    openStocktakeLines ? `未完盘点明细 ${openStocktakeLines}` : '',
    openOperations ? `未过账库存单 ${openOperations}` : '',
    pendingOrders ? `待支付商品订单 ${pendingOrders}` : '',
  ].filter(Boolean);
  if (blockers.length) {
    throw new ConflictException(`商品暂不能停用：${blockers.join('、')}`);
  }
}

export function itemSnapshot(item: {
  id: string;
  sku: string;
  name: string;
  category: string;
  mode: InventoryMode;
  supplier: string;
  supplierId: string | null;
  defaultLocationId: string | null;
  purchasePriceCents: number;
  salePriceCents: number;
  stock: number;
  safeStock: number;
  batchCode: string | null;
  expiresAt: Date | null;
  enabled: boolean;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    category: item.category,
    mode: item.mode,
    supplier: item.supplier,
    supplierId: item.supplierId,
    defaultLocationId: item.defaultLocationId,
    purchasePriceCents: item.purchasePriceCents,
    salePriceCents: item.salePriceCents,
    stock: item.stock,
    safeStock: item.safeStock,
    batchCode: item.batchCode,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    enabled: item.enabled,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function requireRole(actor: AuthUser, roles: readonly AppRole[]) {
  if (!hasRole(actor, roles))
    throw new ForbiddenException('当前角色无权访问库存资料');
}
