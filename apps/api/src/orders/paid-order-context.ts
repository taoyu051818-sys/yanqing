import type {
  AppRole,
  PaymentChannel,
  Prisma,
} from '../generated/prisma/client.js';
export type PayableOrder = Prisma.OrderGetPayload<{
  include: {
    items: true;
    membership: { include: { product: true } };
    member: { select: { openId: true } };
  };
}>;
/** Domain effects use the caller's transaction; they must not open/commit one. */
export interface PaidOrderContext {
  readonly tx: Prisma.TransactionClient;
  readonly order: PayableOrder;
  readonly payment: {
    id: string;
    paymentNo: string;
    channel: PaymentChannel;
    amountCents?: number;
    operatorId?: string;
  };
  readonly paymentActorId: string;
  readonly actorRole: AppRole;
  readonly now: Date;
}
