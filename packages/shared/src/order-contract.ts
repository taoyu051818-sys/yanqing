import type { BusinessType, PageResult } from "./domain.js";

/** JSON contracts. Servers use Date for database timestamps; clients use ISO strings. */
export type OrderStatus =
  | "PENDING"
  | "PAID"
  | "CHECKED_IN"
  | "COMPLETED"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "CANCELLED";
export type PaymentChannel =
  | "WECHAT"
  | "CASH_PRINCIPAL"
  | "GIFT_BALANCE"
  | "BADMINTON_COIN"
  | "OFFLINE_CASH"
  | "COUPON";
export type PaymentStatus =
  "CREATED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CLOSED" | "REFUNDED";
export type RefundStatus =
  "REQUESTED" | "APPROVED" | "REJECTED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
export interface OrderItemView {
  id: string;
  itemType: string;
  itemId?: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
}
export interface PaymentView<D = string> {
  id: string;
  paymentNo: string;
  channel: PaymentChannel;
  amountCents: number;
  status: PaymentStatus;
  paidAt?: D | null;
  createdAt?: D;
  updatedAt?: D;
}
export interface RefundView<D = string> {
  id: string;
  refundNo?: string;
  amountCents: number;
  reason: string;
  originalOrderStatus?: OrderStatus | null;
  status: RefundStatus;
  requestedAt: D;
  approvedAt?: D | null;
  completedAt?: D | null;
}
export interface BookingView<D = string> {
  id: string;
  status: string;
  startsAt: D;
  endsAt: D;
  checkedInAt?: D | null;
  operatorOverride?: boolean;
  completedAt?: D | null;
  court?: { id: string; code?: string; name: string };
}
export interface OrderView<D = string> {
  id: string;
  orderNo: string;
  businessType: BusinessType;
  subjectAccount: string;
  paymentChannel?: PaymentChannel | null;
  sourceChannel: string;
  status: OrderStatus;
  title: string;
  listAmountCents: number;
  discountCents: number;
  payableCents: number;
  paidCents: number;
  refundedCents: number;
  paidAt?: D | null;
  completedAt?: D | null;
  cancelledAt?: D | null;
  paymentExpiresAt?: string;
  createdAt: D;
  updatedAt?: D;
  member?: { id: string; displayName: string };
  items?: OrderItemView[];
  payments?: PaymentView<D>[];
  refunds?: RefundView<D>[];
  bookings?: BookingView<D>[];
  gameRegistration?: {
    id: string;
    status: string;
    checkedInAt?: D | null;
    game?: {
      id: string;
      code?: string;
      title: string;
      level?: string;
      status: string;
      startsAt: D;
      endsAt: D;
    };
  };
  eventTeam?: {
    id: string;
    name: string;
    category?: string;
    status: string;
    paymentDueAt?: D | null;
    event?: {
      id: string;
      code?: string;
      name: string;
      status: string;
      startsAt: D;
    };
  };
  trainingEnrollment?: {
    id: string;
    status: string;
    totalSessions: number;
    remainingSessions?: number;
    product?: { id: string; code?: string; name: string };
    student?: { id: string; name?: string };
  };
}
export type OrderPage = PageResult<OrderView>;
export interface PaymentOption {
  channel: PaymentChannel;
  enabled: boolean;
  reason: string;
  debitAmount: number;
  availableBalance?: number;
  unit: string;
}
export interface PaymentQuote {
  orderId: string;
  payableCents: number;
  paymentExpiresAt?: string;
  quotedAt: string;
  options: PaymentOption[];
}
export interface WechatPaymentParameters {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}
export interface PaymentResult<D = string> {
  status: PaymentStatus;
  amountCents: number;
  channel: PaymentChannel;
  createdAt: D;
  paidAt: D | null;
  wechatPay?: WechatPaymentParameters;
}
