import type { Prisma } from '../../generated/prisma/client.js';
import { BookingStatus } from '../../generated/prisma/client.js';
import type { PaidOrderContext } from '../../orders/paid-order-context.js';

type CourtPaymentContext = {
  readonly tx: {
    courtBooking: Pick<Prisma.TransactionClient['courtBooking'], 'updateMany'>;
  };
  readonly order: Pick<PaidOrderContext['order'], 'id'>;
};

export async function confirmPaidCourtBookings({
  tx,
  order,
}: CourtPaymentContext): Promise<void> {
  await tx.courtBooking.updateMany({
    where: { orderId: order.id, status: BookingStatus.HELD },
    data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null },
  });
}
