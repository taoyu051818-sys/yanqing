import { ConflictException } from '@nestjs/common';
import {
  BusinessType,
  EventStatus,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { PaidOrderContext } from '../../orders/paid-order-context.js';

export async function assertEventPaymentReady({
  tx,
  order,
  now,
}: PaidOrderContext): Promise<void> {
  if (order.businessType === BusinessType.EVENT) {
    const eventTeam = await tx.eventTeam.findUnique({
      where: { orderId: order.id },
      include: { event: true },
    });
    if (!eventTeam) throw new ConflictException('赛事订单缺少报名队伍');
    if (eventTeam.status !== RegistrationStatus.REGISTERED) {
      throw new ConflictException('赛事报名席位当前不可支付');
    }
    if (!eventTeam.paymentDueAt || eventTeam.paymentDueAt <= now) {
      throw new ConflictException('赛事报名支付保留期已过期');
    }
    if (
      (eventTeam.event.status !== EventStatus.OPEN &&
        eventTeam.event.status !== EventStatus.FULL) ||
      eventTeam.event.startsAt <= now
    ) {
      throw new ConflictException('赛事已关闭报名或已开赛');
    }
  }
}

export async function confirmPaidEventTeam({
  tx,
  order,
  now,
}: PaidOrderContext): Promise<void> {
  if (order.businessType === BusinessType.EVENT) {
    const paidTeam = await tx.eventTeam.updateMany({
      where: {
        orderId: order.id,
        status: RegistrationStatus.REGISTERED,
        paymentDueAt: { gt: now },
      },
      data: { status: RegistrationStatus.PAID, paymentDueAt: null },
    });
    if (paidTeam.count !== 1) {
      throw new ConflictException('赛事报名席位已过期或被其他操作更新');
    }
  }
}
