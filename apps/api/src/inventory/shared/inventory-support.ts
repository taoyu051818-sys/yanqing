import type { AuthUser } from '../../common/auth/auth-user.js';
import { AppRole, InventoryTxnType } from '../../generated/prisma/client.js';

export const IN_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.PURCHASE_IN,
  InventoryTxnType.CONSIGNMENT_IN,
]);

export const OUT_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.SALE_OUT,
  InventoryTxnType.TRAINING_USAGE,
  InventoryTxnType.EVENT_USAGE,
  InventoryTxnType.RETURN_OUT,
]);

export const DOCUMENT_CONTROLLED_TYPES = new Set<InventoryTxnType>([
  InventoryTxnType.PURCHASE_IN,
  InventoryTxnType.CONSIGNMENT_IN,
  InventoryTxnType.TRANSFER_OUT,
  InventoryTxnType.TRANSFER_IN,
  InventoryTxnType.LOSS_OUT,
  InventoryTxnType.STOCKTAKE_GAIN,
  InventoryTxnType.STOCKTAKE_LOSS,
  InventoryTxnType.ADJUSTMENT,
  InventoryTxnType.RETURN_OUT,
  InventoryTxnType.STOCKTAKE,
]);

export const ADMIN_ROLES: readonly AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const READ_ROLES: readonly AppRole[] = [...ADMIN_ROLES];

export const AWARD_OPTION_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  AppRole.EVENT_MANAGER,
  ...ADMIN_ROLES,
];

export const LOW_STOCK_ROLES: readonly AppRole[] = [
  AppRole.FRONT_DESK,
  ...ADMIN_ROLES,
];

export const ITEM_UPDATE_ACTION = 'INVENTORY_ITEM_UPDATED';

export const ITEM_STATUS_ACTION = 'INVENTORY_ITEM_STATUS_CHANGED';

export const hasRole = (actor: AuthUser, roles: readonly AppRole[]) =>
  actor.roles.some((role) => roles.includes(role));

export const inventoryTransactionResponse = (
  transaction: Record<string, any>,
) =>
  Object.fromEntries(
    Object.entries({
      id: transaction.id,
      itemId: transaction.itemId,
      type: transaction.type,
      quantity: transaction.quantity,
      stockBefore: transaction.stockBefore,
      stockAfter: transaction.stockAfter,
      unitCostCents: transaction.unitCostCents,
      orderItemId: transaction.orderItemId,
      reason: transaction.reason,
      createdAt: transaction.createdAt,
    }).filter(([, value]) => value !== undefined),
  );

export const inventoryOperationResponse = (operation: Record<string, any>) => {
  const {
    postIdempotencyKey: _postIdempotencyKey,
    sourceTransactionId: _sourceTransactionId,
    targetTransactionId: _targetTransactionId,
    ...response
  } = operation;
  return response;
};

export const inventoryItemResponse = (item: Record<string, any>) => ({
  ...item,
  ...(Array.isArray(item.transactions)
    ? { transactions: item.transactions.map(inventoryTransactionResponse) }
    : {}),
  ...(Array.isArray(item.inventoryDocuments)
    ? {
        inventoryDocuments: item.inventoryDocuments.map(
          inventoryOperationResponse,
        ),
      }
    : {}),
});
