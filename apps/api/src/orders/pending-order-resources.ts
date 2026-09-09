import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  BookingStatus,
  BusinessType,
  MembershipStatus,
  RegistrationStatus,
  TrainingEnrollmentStatus,
  type Prisma,
  type GameRegistration,
  type EventTeam,
} from '../generated/prisma/client.js';
import { releaseBookingCoupon } from './booking-coupon.js';
import { promoteNextGameWaitlist } from '../games/games.service.js';
import { promoteNextEventWaitlist } from '../events/events.service.js';

type PendingResources = Parameters<typeof releaseBookingCoupon>[1] & {
  gameRegistration?: Pick<GameRegistration, 'id' | 'status' | 'gameId'> | null;
  eventTeam?: Pick<EventTeam, 'id' | 'status' | 'eventId'> | null;
};

/** After cancelling the order, release only its unpaid reservations. The caller
 * closes/validates payment attempts first and owns the transaction. Late external
 * success may arrive after a seat was already removed; it cannot release others.
 * Goods reservation is derived from Order/Payment state, not a stock decrement. */
export async function releasePendingOrderResources(
  tx: Prisma.TransactionClient,
  order: PendingResources,
  options: {
    cause: 'CANCELLATION' | 'PAYMENT_UNAVAILABLE';
    actor?: Pick<AuthUser, 'sub' | 'roles'>;
    now?: Date;
  },
) {
  const { actor, now = new Date() } = options;
  const strict = options.cause === 'CANCELLATION';
  const orderId = order.id;
  if (order.businessType === BusinessType.GAME) {
    const registration = order.gameRegistration;
    if (
      strict &&
      (!registration || registration.status !== RegistrationStatus.REGISTERED)
    ) {
      throw new ConflictException('球局报名状态已经变化，请刷新后重试');
    }
    const released = await tx.gameRegistration.updateMany({
      where: {
        id: registration?.id,
        orderId,
        status: RegistrationStatus.REGISTERED,
      },
      data: { status: RegistrationStatus.CANCELLED },
    });
    if (strict && released.count !== 1)
      throw new ConflictException('球局名额状态已经变化，请重试');
    // Release this member's seat, never the courts reserved for the whole game.
    if (registration)
      await promoteNextGameWaitlist(
        tx,
        registration.gameId,
        actor?.sub,
        actor?.roles[0],
      );
  } else if (order.businessType === BusinessType.EVENT) {
    const team = order.eventTeam;
    if (!team || team.status !== RegistrationStatus.REGISTERED)
      throw new ConflictException('赛事队伍状态已经变化');
    const released = await tx.eventTeam.updateMany({
      where: { id: team.id, orderId, status: RegistrationStatus.REGISTERED },
      data: {
        status: RegistrationStatus.CANCELLED,
        paymentDueAt: null,
        cancelledAt: now,
      },
    });
    if (strict && released.count !== 1)
      throw new ConflictException('赛事席位状态已经变化');
    await promoteNextEventWaitlist(tx, team.eventId, undefined, undefined);
  } else if (order.businessType === BusinessType.TRAINING) {
    const released = await tx.trainingEnrollment.updateMany({
      where: { orderId, status: TrainingEnrollmentStatus.PENDING_PAYMENT },
      data: {
        status: TrainingEnrollmentStatus.CANCELLED,
        seatReservedUntil: null,
      },
    });
    if (strict && released.count !== 1)
      throw new ConflictException('课程报名状态已经变化，请刷新后重试');
  } else if (order.businessType === BusinessType.MEMBERSHIP) {
    await tx.memberSubscription.updateMany({
      where: { orderId, status: MembershipStatus.FROZEN },
      data: { status: MembershipStatus.CANCELLED },
    });
  } else if (order.businessType === BusinessType.VENUE) {
    await releaseBookingCoupon(tx, order);
    await tx.courtBooking.updateMany({
      where: { orderId, status: BookingStatus.HELD },
      data: { status: BookingStatus.CANCELLED, holdExpiresAt: null },
    });
  }
}
