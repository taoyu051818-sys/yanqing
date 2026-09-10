import type { Prisma } from '../../generated/prisma/client.js';
import { OrderStatus, RewardStatus } from '../../generated/prisma/client.js';
import type { PaidOrderContext } from '../../orders/paid-order-context.js';

type ReferralPaymentContext = Pick<
  PaidOrderContext,
  'now' | 'paymentActorId' | 'actorRole'
> & {
  readonly tx: {
    user: Pick<Prisma.TransactionClient['user'], 'findUnique'>;
    order: Pick<Prisma.TransactionClient['order'], 'count'>;
    systemParameter: Pick<
      Prisma.TransactionClient['systemParameter'],
      'findFirst'
    >;
    referralReward: Pick<Prisma.TransactionClient['referralReward'], 'upsert'>;
    auditLog: Pick<Prisma.TransactionClient['auditLog'], 'create'>;
  };
  readonly order: Pick<PaidOrderContext['order'], 'id' | 'memberId'>;
};

export async function scheduleFirstPaymentRewards({
  tx,
  order,
  paymentActorId,
  actorRole,
  now,
}: ReferralPaymentContext): Promise<void> {
  const member = await tx.user.findUnique({
    where: { id: order.memberId },
    select: { referrerId: true },
  });
  if (member?.referrerId) {
    const previousPaidOrders = await tx.order.count({
      where: {
        memberId: order.memberId,
        id: { not: order.id },
        status: {
          in: [
            OrderStatus.PAID,
            OrderStatus.CHECKED_IN,
            OrderStatus.COMPLETED,
            OrderStatus.PARTIALLY_REFUNDED,
          ],
        },
      },
    });
    if (previousPaidOrders === 0) {
      const [rewardParameter, newUserRewardParameter, observationParameter] =
        await Promise.all([
          tx.systemParameter.findFirst({
            where: {
              key: 'referral.first_payment.coin_reward',
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: { effectiveFrom: 'desc' },
          }),
          tx.systemParameter.findFirst({
            where: {
              key: 'referral.new_user.first_payment.coin_reward',
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: { effectiveFrom: 'desc' },
          }),
          tx.systemParameter.findFirst({
            where: {
              key: 'referral.refund_observation_days',
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: { effectiveFrom: 'desc' },
          }),
        ]);
      const rewardValue =
        typeof rewardParameter?.value === 'number'
          ? Math.max(0, Math.round(rewardParameter.value))
          : 100;
      const newUserRewardValue =
        typeof newUserRewardParameter?.value === 'number'
          ? Math.max(0, Math.round(newUserRewardParameter.value))
          : 50;
      const observationDays =
        typeof observationParameter?.value === 'number'
          ? Math.max(0, Math.round(observationParameter.value))
          : 7;
      // The reward is unique per new member and trigger type.  Use the
      // compound unique key as the database concurrency boundary instead of
      // a read-then-create sequence.  In particular, do not catch P2002
      // inside this transaction: PostgreSQL marks a transaction aborted after
      // a constraint error, so pretending the loser can continue would risk
      // committing the payment without its downstream side effects.  A
      // database upsert is atomic and leaves the already-created reward
      // untouched on a retry.
      const scheduledReward = await tx.referralReward.upsert({
        where: {
          newUserId_triggerType: {
            newUserId: order.memberId,
            triggerType: 'FIRST_PAYMENT',
          },
        },
        update: {},
        create: {
          referrerId: member.referrerId,
          newUserId: order.memberId,
          triggerOrderId: order.id,
          triggerType: 'FIRST_PAYMENT',
          rewardType: 'BADMINTON_COIN',
          rewardValue,
          newUserRewardValue,
          status: RewardStatus.PENDING_OBSERVATION,
          observationEndsAt: new Date(
            now.getTime() + observationDays * 86_400_000,
          ),
        },
      });
      if (scheduledReward.triggerOrderId === order.id) {
        await tx.auditLog.create({
          data: {
            actorId: paymentActorId,
            actorRole,
            action: 'REFERRAL_REWARD_SCHEDULED',
            objectType: 'ReferralReward',
            objectId: scheduledReward.id,
            newValue: {
              referrerId: member.referrerId,
              newUserId: order.memberId,
              triggerOrderId: order.id,
              rewardType: 'BADMINTON_COIN',
              referrerRewardValue: rewardValue,
              newUserRewardValue,
              observationDays,
              parameterIds: {
                referrerReward: rewardParameter?.id ?? null,
                newUserReward: newUserRewardParameter?.id ?? null,
                observation: observationParameter?.id ?? null,
              },
            } as never,
          },
        });
      }
    }
  }
}
