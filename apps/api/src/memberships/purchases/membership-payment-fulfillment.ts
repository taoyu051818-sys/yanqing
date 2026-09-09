import { activateMembership } from '../membership-entitlements.js';
import { PaidOrderContext } from '../../orders/paid-order-context.js';

export async function activatePaidMembership({
  tx,
  order,
  paymentActorId,
  actorRole,
  now,
}: PaidOrderContext): Promise<void> {
  if (order.membership) {
    const entitlement = await activateMembership(
      tx,
      {
        parameterSnapshot: order.parameterSnapshot,
        membership: order.membership,
      },
      now,
    );
    await tx.auditLog.create({
      data: {
        actorId: paymentActorId,
        actorRole,
        action: 'MEMBERSHIP_ENTITLEMENT_ACTIVATED',
        objectType: 'MemberSubscription',
        objectId: order.membership.id,
        reason: '会员付款激活，同等级续费顺延',
        newValue: {
          startsAt: entitlement.startsAt.toISOString(),
          endsAt: entitlement.endsAt.toISOString(),
          level: entitlement.profile.level,
        },
      },
    });
  }
}
