import { randomBytes } from 'node:crypto';
import { AppRole } from '../../generated/prisma/client.js';

export const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const ADMIN_ROLES: readonly AppRole[] = [
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export const FRONT_ROLES: readonly AppRole[] = ADMIN_ROLES;

export const READ_ROLES: readonly AppRole[] = [...ADMIN_ROLES];

export const SUPPLIER_CREATE_ACTION = 'SUPPLIER_CREATED';

export const SUPPLIER_UPDATE_ACTION = 'SUPPLIER_UPDATED';

export const SUPPLIER_STATUS_ACTION = 'SUPPLIER_STATUS_CHANGED';

export const LOCATION_CREATE_ACTION = 'INVENTORY_LOCATION_CREATED';

export const LOCATION_UPDATE_ACTION = 'INVENTORY_LOCATION_UPDATED';

export const LOCATION_STATUS_ACTION = 'INVENTORY_LOCATION_STATUS_CHANGED';

export const purchaseReceiptResponse = (receipt: Record<string, any>) => {
  const {
    idempotencyKey: _idempotencyKey,
    operatorId: _operatorId,
    ...response
  } = receipt;
  return response;
};

export const purchaseOrderResponse = (order: Record<string, any>) => ({
  ...order,
  ...(Array.isArray(order.receipts)
    ? { receipts: order.receipts.map(purchaseReceiptResponse) }
    : {}),
});

export const stocktakeResponse = (stocktake: Record<string, any>) => {
  const { postIdempotencyKey: _postIdempotencyKey, ...response } = stocktake;
  return response;
};

export const inventoryOperationResponse = (operation: Record<string, any>) => {
  const {
    postIdempotencyKey: _postIdempotencyKey,
    sourceTransactionId: _sourceTransactionId,
    targetTransactionId: _targetTransactionId,
    ...response
  } = operation;
  return response;
};

export const inventoryLocationResponse = (location: Record<string, any>) => ({
  ...location,
  ...(Array.isArray(location.stocktakes)
    ? { stocktakes: location.stocktakes.map(stocktakeResponse) }
    : {}),
  ...(Array.isArray(location.sourceOperations)
    ? {
        sourceOperations: location.sourceOperations.map(
          inventoryOperationResponse,
        ),
      }
    : {}),
  ...(Array.isArray(location.targetOperations)
    ? {
        targetOperations: location.targetOperations.map(
          inventoryOperationResponse,
        ),
      }
    : {}),
});
