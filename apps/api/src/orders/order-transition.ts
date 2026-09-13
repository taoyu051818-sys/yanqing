import { ConflictException } from '@nestjs/common';
import { OrderStatus, type Prisma } from '../generated/prisma/client.js';

export type OrderTransition =
  | 'CANCEL_UNPAID'
  | 'CANCEL_FREE'
  | 'PAY'
  | 'CHECK_IN'
  | 'COMPLETE'
  | 'REQUEST_REFUND'
  | 'REJECT_REFUND'
  | 'REFUND_SUCCEEDED'
  | 'CAPTURE_COMPENSATION'
  | 'REOPEN_TRAINING';
const refundable: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];
const edges: Record<
  OrderTransition,
  (from: OrderStatus, to: OrderStatus) => boolean
> = {
  CANCEL_UNPAID: (from, to) => from === 'PENDING' && to === 'CANCELLED',
  CANCEL_FREE: (from, to) =>
    ['PAID', 'CHECKED_IN'].includes(from) && to === 'CANCELLED',
  PAY: (from, to) => from === 'PENDING' && to === 'PAID',
  CHECK_IN: (from, to) =>
    (from === 'PAID' && to === 'CHECKED_IN') ||
    (from === 'PARTIALLY_REFUNDED' && to === 'PARTIALLY_REFUNDED'),
  COMPLETE: (from, to) =>
    refundable.includes(from) &&
    to === (['PAID', 'CHECKED_IN'].includes(from) ? 'COMPLETED' : from),
  REQUEST_REFUND: (from, to) =>
    refundable.includes(from) && to === 'REFUND_PENDING',
  REJECT_REFUND: (from, to) =>
    from === 'REFUND_PENDING' && refundable.includes(to),
  REFUND_SUCCEEDED: (from, to) =>
    [...refundable, OrderStatus.REFUND_PENDING].includes(from) &&
    ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(to),
  CAPTURE_COMPENSATION: (from, to) =>
    from === 'CANCELLED' && ['REFUND_PENDING', 'CANCELLED'].includes(to),
  REOPEN_TRAINING: (from, to) =>
    ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'].includes(from) &&
    to === (from === 'COMPLETED' ? 'PAID' : from),
};

/** The only Order status writer. Callers retain their transaction, authorization,
 * resource checks and audit, and must handle a zero count as a lost race. */
export async function transitionOrder(
  tx: Pick<Prisma.TransactionClient, 'order'>,
  event: OrderTransition,
  mutation: Prisma.OrderUpdateManyArgs & {
    where: Prisma.OrderWhereInput;
    data: Prisma.OrderUpdateManyMutationInput & { status: OrderStatus };
  },
) {
  const condition = mutation.where.status;
  const from =
    typeof condition === 'string'
      ? [condition]
      : condition &&
          typeof condition === 'object' &&
          Array.isArray(condition.in)
        ? condition.in
        : [];
  if (
    typeof mutation.where.id !== 'string' ||
    !mutation.where.id ||
    !from.length ||
    !from.every((status) => edges[event](status, mutation.data.status))
  )
    throw new ConflictException(`订单状态转换 ${event} 不合法或缺少原状态条件`);
  if (
    event === 'CANCEL_FREE' &&
    (mutation.where.payableCents !== 0 ||
      mutation.where.paidCents !== 0 ||
      mutation.where.refundedCents !== 0 ||
      mutation.where.completedAt !== null)
  )
    throw new ConflictException('取消免费订单必须同时核对零金额和未完成状态');
  return tx.order.updateMany(mutation);
}

/** Commands that already hold their source snapshot must not silently ignore a lost race. */
export async function requireOrderTransition(
  ...args: Parameters<typeof transitionOrder>
) {
  const result = await transitionOrder(...args);
  if (result.count !== 1)
    throw new ConflictException('订单状态已被其他操作更新，请刷新后重试');
}
