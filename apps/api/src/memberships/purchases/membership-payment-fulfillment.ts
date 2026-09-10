import type { Prisma } from '../../generated/prisma/client.js';
import { activateMembership } from '../membership-entitlements.js';
import type { PaidOrderContext } from '../../orders/paid-order-context.js';

type MembershipPaymentContext = Pick<
  PaidOrderContext,
  'now' | 'paymentActorId' | 'actorRole'
> & {
  readonly tx: {
    memberSubscription: Pick<
      Prisma.TransactionClient['memberSubscription'],
      'findFirst' | 'findMany' | 'findUniqueOrThrow' | 'update'
    >;
    memberProfile: Pick<
      Prisma.TransactionClient['memberProfile'],
      'findUnique' | 'update'
    >;
    auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'>;
  };
  readonly order: Pick<PaidOrderContext['order'], 'parameterSnapshot'> & {
    membership: Parameters<typeof activateMembership>[1]['membership'] | null;
  };
};

export async function activatePaidMembership({
  tx,
  order,
  paymentActorId,
  actorRole,
  now,
}: MembershipPaymentContext): Promise<void> {
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
