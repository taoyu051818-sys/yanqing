import type {
  OrderView,
  LedgerPage,
  RefundTimelinePage,
  OrderPage,
  PaymentQuote,
  PaymentResult,
} from "@yanqing/shared";
import { api } from "../http";

export const ordersEndpoints = {
  orders: (
    params: {
      status?: string;
      businessType?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => api.get<OrderPage>("/orders", params),
  order: (id: string) => api.get<OrderView>(`/orders/${id}`),
  paymentOptions: (id: string) =>
    api.get<PaymentQuote>(`/orders/${id}/payment-options`),
  payOrder: (id: string, data: object) =>
    api.post<PaymentResult>(`/orders/${id}/pay`, data),
  cancelPendingOrder: (id: string, data: object) =>
    api.post(`/orders/${id}/cancel`, data),
  refundOrder: (id: string, data: object) =>
    api.post(`/orders/${id}/refunds`, data),
  directRefundOrder: (id: string, data: object) =>
    api.post<{ status: string }>(`/orders/${id}/refunds/direct`, data),
  approveRefund: (refundId: string, data: object) =>
    api.post<{ status: string }>(`/orders/refunds/${refundId}/approve`, data),
  rejectRefund: (refundId: string, data: object = {}) =>
    api.post(`/orders/refunds/${refundId}/reject`, data),
  nextOrder: () => api.get<OrderView | null>("/orders/me/next"),
  memberLedger: (params: Record<string, unknown>) =>
    api.get<LedgerPage>("/orders/me/ledger", params),
  ledgerTimeline: (params: Record<string, unknown>) =>
    api.get<LedgerPage>("/orders/admin/ledger", params),
  refundTimeline: (params: Record<string, unknown>) =>
    api.get<RefundTimelinePage>("/orders/admin/refunds", params),
  adminOrders: (
    params: {
      page?: number;
      pageSize?: number;
      status?: string;
      businessType?: string;
      keyword?: string;
      dateFrom?: string;
      dateTo?: string;
      dateBasis?: string;
      channel?: string;
    } = {},
  ) => api.get<OrderPage>("/orders/admin/all", params),
};
