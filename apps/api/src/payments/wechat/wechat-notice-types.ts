import { randomBytes } from 'node:crypto';
import { AccountType } from '../../generated/prisma/client.js';

export interface NotificationResource {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}

export interface WechatNotification {
  event_type: string;
  resource: NotificationResource;
}

export interface TransactionNotice {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  amount: { total: number };
}

export interface RefundNotice {
  out_refund_no: string;
  refund_id: string;
  refund_status: string;
  amount: { refund: number; total: number };
}

export interface RechargeRefundRecovery {
  accountType: AccountType;
  requestedCents: number;
  recoveredCents: number;
  shortfallCents: number;
  reason?: 'INSUFFICIENT_AVAILABLE_BALANCE' | 'CONCURRENT_ACCOUNT_CHANGE';
}

export const businessSerial = (prefix: string) =>
  `${prefix}${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}${randomBytes(3).toString('hex').toUpperCase()}`;

export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === code;
