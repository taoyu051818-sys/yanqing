import type { CourtAvailability } from '@yanqing/shared';
import { releasePendingOrderResources } from '../../orders/pending-order-resources.js';
import { transitionOrder } from '../../orders/order-transition.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BookingStatus,
  BusinessType,
  CourtClosureStatus,
  OrderStatus,
  PaymentStatus,
} from '../../generated/prisma/client.js';
import { atMinutes } from '../shared/venues-support.js';
import { resolvePrice } from '../shared/venues-policy.js';

export async function availability(
  prisma: PrismaService,
  date: string,
  includeUnavailable = false,
): Promise<CourtAvailability<Date>> {
  await releaseExpiredHolds(prisma);
  const dayStart = atMinutes(date, 0);
  const dayEnd = atMinutes(date, 24 * 60);
  const [courts, slots, bookings, closures] = await Promise.all([
    prisma.court.findMany({
      where: includeUnavailable ? undefined : { enabled: true },
      select: { id: true, name: true, usage: true, enabled: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.timeSlot.findMany({
      where: includeUnavailable ? undefined : { enabled: true },
      select: {
        id: true,
        label: true,
        startMinutes: true,
        endMinutes: true,
        period: true,
        enabled: true,
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.courtBooking.findMany({
      where: {
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
        status: { not: BookingStatus.CANCELLED },
      },
      select: {
        courtId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        usage: true,
      },
    }),
    prisma.courtClosure.findMany({
      where: {
        status: CourtClosureStatus.ACTIVE,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      select: {
        courtId: true,
        startsAt: true,
        endsAt: true,
        status: true,
      },
      orderBy: [{ startsAt: 'asc' }, { courtId: 'asc' }],
    }),
  ]);
  const prices = await Promise.all(
    slots.map((slot) => resolvePrice(prisma, slot.id, date, slot.startMinutes)),
  );
  return {
    date,
    courts: courts.map((court) => ({
      id: court.id,
      name: court.name,
      usage: court.usage,
      enabled: court.enabled,
    })),
    slots: slots.map((slot, index) => ({
      id: slot.id,
      label: slot.label,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      period: slot.period,
      enabled: slot.enabled,
      price: prices[index]
        ? {
            priceCents: prices[index].priceCents,
            newcomerPriceCents: prices[index].newcomerPriceCents,
          }
        : undefined,
    })),
    bookings: bookings.map((booking) => ({
      courtId: booking.courtId,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      usage: booking.usage,
    })),
    closures: closures.map((closure) => ({
      courtId: closure.courtId,
      startsAt: closure.startsAt,
      endsAt: closure.endsAt,
      status: closure.status,
    })),
  };
}

export async function releaseExpiredHolds(
  prisma: PrismaService,
): Promise<void> {
  const now = new Date();
  if (typeof (prisma as any).$transaction !== 'function') {
    await prisma.courtBooking.updateMany({
      where: {
        status: BookingStatus.HELD,
        holdExpiresAt: { lte: now },
      },
      data: { status: BookingStatus.CANCELLED, holdExpiresAt: null },
    });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const expired = await tx.courtBooking.findMany({
      where: {
        status: BookingStatus.HELD,
        holdExpiresAt: { lte: now },
      },
      include: {
        order: {
          include: {
            payments: {
              select: { status: true },
            },
          },
        },
      },
      take: 100,
    });
    for (const booking of expired) {
      const order = booking.order;
      const paymentInFlight = order?.payments.some(
        (payment) =>
          payment.status === PaymentStatus.PROCESSING ||
          payment.status === PaymentStatus.SUCCEEDED,
      );
      if (paymentInFlight) continue;
      if (order?.status === OrderStatus.PENDING) {
        const changed = await transitionOrder(tx, 'CANCEL_UNPAID', {
          where: { id: order.id, status: OrderStatus.PENDING },
          data: { status: OrderStatus.CANCELLED, cancelledAt: now },
        });
        if (changed.count !== 1) continue;
        await tx.payment.updateMany({
          where: {
            orderId: order.id,
            status: PaymentStatus.CREATED,
          },
          data: { status: PaymentStatus.CLOSED },
        });
        await tx.auditLog.create({
          data: {
            action: 'VENUE_ORDER_AUTO_CANCELLED',
            objectType: 'Order',
            objectId: order.id,
            requestId: `AUTO:VENUE_ORDER:${order.id}`,
            oldValue: { status: OrderStatus.PENDING } as never,
            newValue: {
              status: OrderStatus.CANCELLED,
              bookingStatus: BookingStatus.CANCELLED,
              cancelledAt: now.toISOString(),
            } as never,
            reason: '场地订单支付保留期届满',
          },
        });
      }
      if (
        !order ||
        order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.CANCELLED
      ) {
        if (order?.businessType === BusinessType.VENUE) {
          await releasePendingOrderResources(tx, order, {
            cause: 'CANCELLATION',
            now,
          });
        } else {
          await tx.courtBooking.updateMany({
            where: { id: booking.id, status: BookingStatus.HELD },
            data: { status: BookingStatus.CANCELLED, holdExpiresAt: null },
          });
        }
      }
    }
  });
}
