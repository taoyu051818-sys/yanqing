import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '../../generated/prisma/client.js';

export function assertRefundOriginIsConsistent(
  status: OrderStatus,
  completedAt: Date | null,
  refundedCents: number,
): void {
  if (status === OrderStatus.COMPLETED && !completedAt) {
    throw new ConflictException('已完成订单缺少完成时间，需先修复履约证据');
  }
  if (status === OrderStatus.PARTIALLY_REFUNDED && refundedCents <= 0) {
    throw new ConflictException('部分退款订单缺少已退款金额，需先修复财务证据');
  }
  if (
    completedAt &&
    status !== OrderStatus.COMPLETED &&
    status !== OrderStatus.PARTIALLY_REFUNDED
  ) {
    throw new ConflictException('订单状态与完成时间不一致，需先修复履约证据');
  }
}
