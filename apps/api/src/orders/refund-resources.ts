import type { AuthUser } from '../common/auth/auth-user.js';
import {
  BookingStatus,
  BusinessType,
  InventoryTxnType,
  RegistrationStatus,
  RewardStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import { applyTrainingRefund } from '../training/training-refund.js';
import { cancelMembershipEntitlement } from '../memberships/membership-entitlements.js';
import { restoreGoodsSale } from '../inventory/goods-stock.js';
import { promoteNextGameWaitlist } from '../games/game-waitlist.js';
import { promoteNextEventWaitlist } from '../events/event-waitlist.js';
import type { OrderFinalizerService } from '../payments/order-finalizer.service.js';

type RefundResources = Prisma.RefundGetPayload<{
  include: {
    order: {
      include: {
        trainingEnrollment: true;
        membership: true;
        items: true;
        gameRegistration: true;
        eventTeam: true;
      };
    };
  };
}>;

/** Shared by cash/balance approval and WeChat SUCCESS, in the same transaction
 * as the terminal refund transition. Money adapters remain responsible for
 * actual fund movement; this is the single policy for releasing fulfilled resources.
 * A compensation-only payment never fulfilled anything and must release nothing. */
export async function releaseRefundedResources(
  tx: Prisma.TransactionClient,
  refund: RefundResources,
  fullyRefunded: boolean,
  actor: Pick<AuthUser, 'sub' | 'roles'>,
  recordGoodsRefund: OrderFinalizerService['recordSucceededGoodsRefund'],
  now = new Date(),
  reason = refund.reason,
) {
  if (refund.compensationOnly) return;
  if (refund.order.trainingEnrollment) {
    await applyTrainingRefund(
      tx,
      refund.order.trainingEnrollment,
      {
        id: refund.id,
        amountCents: refund.amountCents,
        fullyRefunded,
        reason: reason,
      },
      actor,
    );
  }
  if (fullyRefunded) {
    await tx.courtBooking.updateMany({
      where: {
        orderId: refund.orderId,
        status: {
          notIn: [BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
        },
      },
      data: { status: BookingStatus.CANCELLED },
    });
    if (refund.order.membership) {
      await cancelMembershipEntitlement(tx, refund.order.membership);
    }
    if (refund.order.businessType === BusinessType.GOODS) {
      for (const item of refund.order.items) {
        if (!item.itemId) continue;
        const inventory = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: item.itemId },
        });
        const { stockAfter } = await restoreGoodsSale(
          tx,
          inventory,
          item.quantity,
          item.id,
        );
        await tx.inventoryTransaction.create({
          data: {
            itemId: inventory.id,
            type: InventoryTxnType.ADJUSTMENT,
            quantity: item.quantity,
            stockBefore: inventory.stock,
            stockAfter,
            unitCostCents: inventory.purchasePriceCents,
            orderItemId: item.id,
            operatorId: actor.sub,
            reason: `退款 ${refund.refundNo} 退货入库`,
            idempotencyKey: `GOODS-REFUND:${refund.id}:${item.id}`,
          },
        });
      }
      await recordGoodsRefund(tx, refund.id, actor.sub, actor.roles[0]);
    }
    if (
      refund.order.businessType === BusinessType.GAME &&
      refund.order.gameRegistration
    ) {
      await tx.gameRegistration.update({
        where: { id: refund.order.gameRegistration.id },
        data: { status: 'REFUNDED' },
      });
      await promoteNextGameWaitlist(
        tx,
        refund.order.gameRegistration.gameId,
        actor.sub,
        actor.roles[0],
      );
    }
    if (
      refund.order.businessType === BusinessType.EVENT &&
      refund.order.eventTeam
    ) {
      await tx.eventTeam.update({
        where: { id: refund.order.eventTeam.id },
        data: {
          status: RegistrationStatus.REFUNDED,
          paymentDueAt: null,
          cancellationPending: false,
          cancellationResolvedAt: refund.order.eventTeam.cancelRequestedAt
            ? (refund.order.eventTeam.cancellationResolvedAt ?? now)
            : undefined,
        },
      });
      await promoteNextEventWaitlist(
        tx,
        refund.order.eventTeam.eventId,
        actor.sub,
        actor.roles[0],
      );
    }
  }
  await tx.referralReward.updateMany({
    where: {
      triggerOrderId: refund.orderId,
      status: {
        in: [RewardStatus.PENDING_OBSERVATION, RewardStatus.AVAILABLE],
      },
    },
    data: { status: RewardStatus.REVERSED, reversedAt: now },
  });
}
