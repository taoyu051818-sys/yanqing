import { api } from "../http";

export const inventoryEndpoints = {
  inventory: () => api.get<any[]>("/inventory"),
  inventoryAwardOptions: () => api.get<any[]>("/inventory/award-options"),
  lowStock: () => api.get<any[]>("/inventory/low-stock"),
  inventoryItemDetail: (id: string) => api.get<any>(`/inventory/items/${id}`),
  createInventoryItem: (data: object) => api.post("/inventory", data),
  updateInventoryItem: (id: string, data: object) =>
    api.post(`/inventory/items/${id}/update`, data),
  setInventoryItemStatus: (id: string, data: object) =>
    api.post(`/inventory/items/${id}/status`, data),
  inventorySuppliers: () => api.get<any[]>("/inventory/suppliers"),
  inventorySupplierDetail: (id: string) =>
    api.get<any>(`/inventory/suppliers/${id}`),
  createInventorySupplier: (data: object) =>
    api.post("/inventory/suppliers", data),
  updateInventorySupplier: (id: string, data: object) =>
    api.post(`/inventory/suppliers/${id}/update`, data),
  setInventorySupplierStatus: (id: string, data: object) =>
    api.post(`/inventory/suppliers/${id}/status`, data),
  consignmentPayables: (params: Record<string, any> = {}) =>
    api.get<any>("/inventory/consignment/payables", params),
  consignmentSettlements: (params: Record<string, any> = {}) =>
    api.get<any>("/inventory/consignment/settlements", params),
  consignmentSettlement: (id: string) =>
    api.get<any>(`/inventory/consignment/settlements/${id}`),
  createConsignmentSettlement: (data: object) =>
    api.post("/inventory/consignment/settlements", data),
  submitConsignmentSettlement: (id: string, data: object) =>
    api.post(`/inventory/consignment/settlements/${id}/submit`, data),
  confirmConsignmentSettlement: (id: string, data: object) =>
    api.post(`/inventory/consignment/settlements/${id}/confirm`, data),
  disputeConsignmentSettlement: (id: string, data: object) =>
    api.post(`/inventory/consignment/settlements/${id}/dispute`, data),
  returnConsignmentSettlement: (id: string, data: object) =>
    api.post(`/inventory/consignment/settlements/${id}/return`, data),
  settleConsignmentSettlement: (id: string, data: object) =>
    api.post(`/inventory/consignment/settlements/${id}/settle`, data),
  voidConsignmentSettlement: (id: string, data: object) =>
    api.post(`/inventory/consignment/settlements/${id}/void`, data),
  inventoryLocations: () => api.get<any[]>("/inventory/locations"),
  inventoryLocationDetail: (id: string) =>
    api.get<any>(`/inventory/locations/${id}`),
  createInventoryLocation: (data: object) =>
    api.post("/inventory/locations", data),
  updateInventoryLocation: (id: string, data: object) =>
    api.post(`/inventory/locations/${id}/update`, data),
  setInventoryLocationStatus: (id: string, data: object) =>
    api.post(`/inventory/locations/${id}/status`, data),
  purchaseOrders: () => api.get<any[]>("/inventory/purchase-orders"),
  createPurchaseOrder: (data: object) =>
    api.post("/inventory/purchase-orders", data),
  submitPurchaseOrder: (id: string) =>
    api.post(`/inventory/purchase-orders/${id}/submit`),
  approvePurchaseOrder: (id: string) =>
    api.post(`/inventory/purchase-orders/${id}/approve`),
  receivePurchaseOrder: (id: string, data: object) =>
    api.post(`/inventory/purchase-orders/${id}/receive`, data),
  cancelPurchaseOrder: (id: string, reason: string) =>
    api.post(`/inventory/purchase-orders/${id}/cancel`, { reason }),
  stocktakes: () => api.get<any[]>("/inventory/stocktakes"),
  createStocktake: (data: object) => api.post("/inventory/stocktakes", data),
  startStocktake: (id: string) => api.post(`/inventory/stocktakes/${id}/start`),
  countStocktakeLine: (id: string, lineId: string, countedQuantity: number) =>
    api.post(`/inventory/stocktakes/${id}/lines/${lineId}/count`, {
      countedQuantity,
    }),
  submitStocktake: (id: string) =>
    api.post(`/inventory/stocktakes/${id}/submit`),
  postStocktake: (id: string, idempotencyKey: string) =>
    api.post(`/inventory/stocktakes/${id}/post`, { idempotencyKey }),
  inventoryOperations: () => api.get<any[]>("/inventory/operations"),
  consignmentSupplierOptions: () =>
    api.get<any[]>("/inventory/consignment/supplier-options"),
  createInventoryOperation: (data: object) =>
    api.post("/inventory/operations", data),
  submitInventoryOperation: (id: string) =>
    api.post(`/inventory/operations/${id}/submit`),
  approveInventoryOperation: (id: string) =>
    api.post(`/inventory/operations/${id}/approve`),
  postInventoryOperation: (id: string, idempotencyKey: string) =>
    api.post(`/inventory/operations/${id}/post`, { idempotencyKey }),
  cancelInventoryOperation: (id: string, reason: string) =>
    api.post(`/inventory/operations/${id}/cancel`, { reason }),
  inventoryTransaction: (itemId: string, data: object) =>
    api.post(`/inventory/${itemId}/transactions`, data),
  goods: () => api.get<any[]>("/goods"),
  createGoodsOrder: (
    items: Array<{ itemId: string; quantity: number }>,
    creationIdempotencyKey?: string,
  ) => api.post("/goods/orders", { items, creationIdempotencyKey }),
};
