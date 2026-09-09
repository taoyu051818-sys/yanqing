import { BookingStatus } from '../../generated/prisma/client.js';
import { PaidOrderContext } from '../../orders/paid-order-context.js';

export async function confirmPaidCourtBookings({
  tx,
  order,
}: PaidOrderContext): Promise<void> {
  await tx.courtBooking.updateMany({
    where: { orderId: order.id, status: BookingStatus.HELD },
    data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null },
  });
}
