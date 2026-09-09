import { RefundStatus } from '../../generated/prisma/client.js';

export const ACTIVE_REFUND_STATUSES: readonly RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
];
