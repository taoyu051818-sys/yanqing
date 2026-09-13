import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import {
  Prisma,
  RefundStatus,
  type Refund,
} from '../../generated/prisma/client.js';

const activeStatuses: readonly RefundStatus[] = [
  RefundStatus.REQUESTED,
  RefundStatus.APPROVED,
  RefundStatus.PROCESSING,
];

/** Called inside the activity cancellation's Serializable transaction. */
export async function requireActivityCancellationRefunds(
  tx: Prisma.TransactionClient,
  orders: Array<{ refunds: Refund[] } | null>,
  actor: AuthUser,
  activity: { kind: 'GAME' | 'EVENT'; id: string; reason: string },
) {
  for (const refund of orders.flatMap((order) => order?.refunds ?? [])) {
    if (!activeStatuses.includes(refund.status) || refund.cancellationRequired)
      continue;
    const changed = await tx.refund.updateMany({
      where: {
        id: refund.id,
        status: refund.status,
        cancellationRequired: false,
      },
      data: { cancellationRequired: true },
    });
    if (changed.count !== 1)
      throw new ConflictException('退款状态已变化，请使用原命令重试取消');
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'ACTIVITY_CANCELLATION_REFUND_REQUIRED',
        objectType: 'Refund',
        objectId: refund.id,
        reason: activity.reason,
        oldValue: { cancellationRequired: false, status: refund.status },
        newValue: {
          cancellationRequired: true,
          activityType: activity.kind,
          activityId: activity.id,
          orderId: refund.orderId,
          amountCents: refund.amountCents,
        },
      },
    });
  }
}
