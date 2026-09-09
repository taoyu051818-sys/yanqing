import { randomBytes } from 'node:crypto';
import {
  AccountType,
  PaymentChannel,
  PaymentStatus,
  RefundStatus,
} from '../../generated/prisma/client.js';

export const serial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;

export const ACCOUNT_CHANNELS: Partial<Record<PaymentChannel, AccountType>> = {
  [PaymentChannel.CASH_PRINCIPAL]: AccountType.CASH_PRINCIPAL,
  [PaymentChannel.GIFT_BALANCE]: AccountType.GIFT_BALANCE,
  [PaymentChannel.BADMINTON_COIN]: AccountType.BADMINTON_COIN,
};

export const NON_REJECTABLE_SYSTEM_REFUND_PREFIXES = [
  'GAME_CANCEL:',
  'EVENT_CANCEL:',
  'EVENT_LATE_PAYMENT:',
] as const;

export interface PaymentCommandResponse {
  status: PaymentStatus;
  amountCents: number;
  channel: PaymentChannel;
  createdAt: Date;
  paidAt: Date | null;
  wechatPay?: Record<string, unknown>;
}

export interface RefundCommandResponse {
  id: string;
  status: RefundStatus;
  amountCents: number;
  reason: string;
  requestedAt: Date;
  approvedAt: Date | null;
  completedAt: Date | null;
}

export const paymentCommandResponse = (
  payment: Record<string, any>,
): PaymentCommandResponse => {
  const providerPayload = payment.providerPayload as
    { wechatPay?: unknown } | null | undefined;
  const wechatPay = payment.wechatPay ?? providerPayload?.wechatPay;
  return {
    status: payment.status,
    amountCents: payment.amountCents,
    channel: payment.channel,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt ?? null,
    ...(payment.channel === PaymentChannel.WECHAT &&
    wechatPay &&
    typeof wechatPay === 'object'
      ? { wechatPay: wechatPay as Record<string, unknown> }
      : {}),
  };
};

export const refundCommandResponse = (
  refund: Record<string, any>,
): RefundCommandResponse => ({
  id: refund.id,
  status: refund.status,
  amountCents: refund.amountCents,
  reason: refund.reason,
  requestedAt: refund.requestedAt,
  approvedAt: refund.approvedAt ?? null,
  completedAt: refund.completedAt ?? null,
});
