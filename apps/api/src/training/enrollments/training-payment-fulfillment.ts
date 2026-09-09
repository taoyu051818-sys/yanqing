import {
  syncTrainingEnrollmentRoster,
  trainingActiveSeatWhere,
} from '../training-roster.js';
import { ConflictException } from '@nestjs/common';
import { TrainingEnrollmentStatus } from '../../generated/prisma/client.js';
import { PaidOrderContext } from '../../orders/paid-order-context.js';

export async function activatePaidTrainingEnrollment({
  tx,
  order,
  now,
}: PaidOrderContext): Promise<void> {
  const enrollment = await tx.trainingEnrollment.findUnique({
    where: { orderId: order.id },
    include: { class: true },
  });
  if (enrollment?.status === TrainingEnrollmentStatus.PENDING_PAYMENT) {
    if (enrollment.classId) {
      if (!enrollment.class?.active)
        throw new ConflictException('培训班已停用，不能完成支付');
      if (
        !enrollment.seatReservedUntil ||
        enrollment.seatReservedUntil <= now
      ) {
        throw new ConflictException('培训班名额保留已过期，请重新报名');
      }
      const occupiedSeats = await tx.trainingEnrollment.count({
        where: {
          classId: enrollment.classId,
          id: { not: enrollment.id },
          ...trainingActiveSeatWhere(),
        },
      });
      if (occupiedSeats >= enrollment.class.capacity) {
        throw new ConflictException('培训班名额已满，支付未完成');
      }
    }
    const activated = await tx.trainingEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: TrainingEnrollmentStatus.ACTIVE,
        prepaidBalanceCents: enrollment.totalAmountCents,
        seatReservedUntil: null,
      },
    });
    await syncTrainingEnrollmentRoster(tx, activated, now);
  }
}
