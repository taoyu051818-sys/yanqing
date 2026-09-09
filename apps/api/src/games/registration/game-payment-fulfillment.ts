import { gamePaymentUnavailable } from '../game-registration-policy.js';
import { ConflictException } from '@nestjs/common';
import { BusinessType } from '../../generated/prisma/client.js';
import { PaidOrderContext } from '../../orders/paid-order-context.js';

export async function assertGamePaymentReady({
  tx,
  order,
  now,
}: PaidOrderContext): Promise<void> {
  if (order.businessType === BusinessType.GAME) {
    const registration = await tx.gameRegistration.findUnique({
      where: { orderId: order.id },
      include: { game: true },
    });
    const unavailable = gamePaymentUnavailable(
      registration,
      order.createdAt,
      now,
    );
    if (unavailable) throw new ConflictException(unavailable);
  }
}

export async function confirmPaidGameRegistration({
  tx,
  order,
}: PaidOrderContext): Promise<void> {
  const paidGameRegistration = await tx.gameRegistration.updateMany({
    where: { orderId: order.id, status: 'REGISTERED' },
    data: { status: 'PAID' },
  });
  if (
    order.businessType === BusinessType.GAME &&
    paidGameRegistration.count !== 1
  )
    throw new ConflictException('球局报名席位已变化');
}
