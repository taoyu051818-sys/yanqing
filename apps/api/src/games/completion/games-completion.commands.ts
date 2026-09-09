import { requireOrderTransition } from '../../orders/order-transition.js';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BookingStatus,
  GameStatus,
  OrderStatus,
  Prisma,
  RegistrationStatus,
  RewardStatus,
} from '../../generated/prisma/client.js';
import { completeOrderFulfillment } from '../../orders/order-fulfillment.js';
import {
  DEFAULT_HOST_REWARD_OBSERVATION_DAYS,
  HOST_REWARD_OBSERVATION_PARAMETER_KEYS,
  GAME_STATUSES_ALLOWED_TO_COMPLETE,
  ORDER_STATUSES_WITHOUT_FULFILLMENT,
  ORDER_STATUSES_WITHOUT_NO_SHOW,
  RewardRuleSnapshot,
  RewardEligibility,
} from '../shared/games-support.js';

import {
  assertGameOperator,
  rewardEligibility,
  rewardRuleSnapshot,
} from '../shared/games-policy.js';

export async function complete(
  prisma: PrismaService,
  gameId: string,
  actor: AuthUser,
) {
  return prisma.$transaction(
    async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId },
        include: {
          registrations: {
            include: {
              order: {
                select: {
                  id: true,
                  status: true,
                  paidCents: true,
                  refundedCents: true,
                },
              },
            },
          },
        },
      });
      if (!game) throw new NotFoundException('球局不存在');
      assertGameOperator(game.hostId, actor);

      if (
        game.status !== GameStatus.COMPLETED &&
        !GAME_STATUSES_ALLOWED_TO_COMPLETE.includes(game.status)
      ) {
        throw new ConflictException('当前球局状态不允许结束');
      }
      // A host may close an OPEN/FULL/IN_PROGRESS game only after its
      // scheduled end.  Without this gate a mistaken tap (or a replayed
      // request from the member client) could create a reward observation
      // window for a game that never happened.  Keep the COMPLETED branch
      // idempotent above this check so historical retries remain readable.
      if (game.status !== GameStatus.COMPLETED) {
        if (
          game.registrations.some(
            (registration) =>
              registration.order?.status === OrderStatus.REFUND_PENDING,
          )
        ) {
          throw new ConflictException(
            '球局存在待审退款报名，请先处理退款再完赛',
          );
        }
        const endsAt =
          game.endsAt instanceof Date
            ? game.endsAt
            : new Date(String(game.endsAt));
        if (Number.isNaN(endsAt.getTime()))
          throw new ConflictException('球局结束时间无效，不能结束并结算');
        if (endsAt > new Date())
          throw new ConflictException('球局尚未结束，不能结束并结算');
      }

      const now = new Date();
      const eligibility = rewardEligibility(game.registrations, game.hostId);
      await finalizeGameFulfillment(tx, game, actor, now);

      // Read the existing unique reward first so a completed retry can
      // return the immutable result without touching the game or ledgers.
      const existingReward = await tx.hostReward.findFirst({
        where: { gameId },
        orderBy: { createdAt: 'asc' },
      });
      if (game.status === GameStatus.COMPLETED) {
        if (existingReward) {
          return {
            checkedIn: existingReward.basisCount,
            reward: existingReward,
          };
        }
        // Repair a legacy completed game that predates host reward rows.
        // The repair still uses the immutable check-in evidence and starts a
        // fresh observation window, so it cannot award recruitment alone.
        const rule = rewardRuleSnapshot(game.rewardRule);
        const observationEndsAt = await resolveHostObservationEnd(tx, now);
        await recordHostRewardRisk(tx, gameId, game.hostId, eligibility);
        const reward = await createHostReward(
          tx,
          game,
          gameId,
          eligibility,
          rule,
          observationEndsAt,
        );
        await writeCompletionAudit(
          tx,
          actor,
          game,
          reward,
          eligibility,
          observationEndsAt,
          true,
        );
        return { checkedIn: eligibility.eligible.length, reward };
      }
      const rule = rewardRuleSnapshot(game.rewardRule);
      const observationEndsAt = await resolveHostObservationEnd(tx, now);
      await recordHostRewardRisk(tx, gameId, game.hostId, eligibility);
      const reward =
        existingReward ??
        (await createHostReward(
          tx,
          game,
          gameId,
          eligibility,
          rule,
          observationEndsAt,
        ));

      await tx.game.update({
        where: { id: gameId },
        data: { status: GameStatus.COMPLETED },
      });
      await tx.courtBooking.updateMany({
        where: { gameId, status: { not: BookingStatus.CANCELLED } },
        data: { status: BookingStatus.COMPLETED },
      });
      await writeCompletionAudit(
        tx,
        actor,
        game,
        reward,
        eligibility,
        observationEndsAt,
        false,
      );
      return { checkedIn: reward.basisCount, reward };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function finalizeGameFulfillment(
  tx: Prisma.TransactionClient,
  game: {
    id: string;
    registrations: Array<{
      id: string;
      status: RegistrationStatus;
      orderId: string | null;
      order: {
        id: string;
        status: OrderStatus;
        paidCents: number;
        refundedCents: number;
        completedAt?: Date | null;
      } | null;
    }>;
  },
  actor: AuthUser,
  completedAt: Date,
): Promise<void> {
  for (const registration of game.registrations) {
    const previousStatus = registration.status;
    let outcome: RegistrationStatus | null = null;
    if (previousStatus === RegistrationStatus.CHECKED_IN) {
      if (
        !registration.order ||
        !ORDER_STATUSES_WITHOUT_FULFILLMENT.has(registration.order.status)
      ) {
        outcome = RegistrationStatus.COMPLETED;
      }
    } else if (previousStatus === RegistrationStatus.PAID) {
      if (
        !registration.order ||
        !ORDER_STATUSES_WITHOUT_NO_SHOW.has(registration.order.status)
      ) {
        outcome = RegistrationStatus.NO_SHOW;
      }
    } else if (
      previousStatus === RegistrationStatus.REGISTERED ||
      previousStatus === RegistrationStatus.WAITLISTED
    ) {
      outcome = RegistrationStatus.CANCELLED;
    }
    if (!outcome) continue;

    const changed = await tx.gameRegistration.updateMany({
      where: { id: registration.id, status: previousStatus },
      data: { status: outcome },
    });
    if (changed.count !== 1) continue;

    if (
      previousStatus === RegistrationStatus.REGISTERED &&
      registration.order?.status === OrderStatus.PENDING
    ) {
      await requireOrderTransition(tx, 'CANCEL_UNPAID', {
        where: { id: registration.order.id, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancelledAt: completedAt },
      });
    } else if (
      registration.order &&
      (outcome === RegistrationStatus.COMPLETED ||
        outcome === RegistrationStatus.NO_SHOW)
    ) {
      await completeOrderFulfillment(tx, {
        orderId: registration.order.id,
        actor,
        objectType: 'GameRegistration',
        objectId: registration.id,
        outcome:
          outcome === RegistrationStatus.NO_SHOW ? 'NO_SHOW' : 'COMPLETED',
        completedAt,
        reason:
          outcome === RegistrationStatus.NO_SHOW
            ? '球局结束时无签到记录'
            : '球局结束且已有签到记录',
        metadata: { gameId: game.id },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action:
          outcome === RegistrationStatus.COMPLETED
            ? 'GAME_REGISTRATION_COMPLETED'
            : outcome === RegistrationStatus.NO_SHOW
              ? 'GAME_REGISTRATION_NO_SHOW'
              : 'GAME_REGISTRATION_EXPIRED',
        objectType: 'GameRegistration',
        objectId: registration.id,
        oldValue: { status: previousStatus } as never,
        newValue: {
          status: outcome,
          gameId: game.id,
          orderId: registration.order?.id ?? null,
          orderCancelled: registration.order?.status === OrderStatus.PENDING,
          completedAt: completedAt.toISOString(),
        } as never,
      },
    });
  }
}

export async function recordHostRewardRisk(
  tx: Prisma.TransactionClient,
  gameId: string,
  hostId: string,
  eligibility: RewardEligibility,
): Promise<void> {
  if (!eligibility.excludedSelf.length) return;
  await tx.riskEvent.create({
    data: {
      ruleCode: 'HOST_SELF_CHECKIN_REWARD',
      severity: 'HIGH',
      userId: hostId,
      objectType: 'Game',
      objectId: gameId,
      summary: '主理人本人签到记录已从组织奖励基数中剔除',
      evidence: {
        checkedInRegistrationIds: eligibility.excludedSelf.map(
          (item) => item.id,
        ),
        checkedInAt: eligibility.excludedSelf.map(
          (item) => item.checkedInAt?.toISOString() ?? null,
        ),
      },
    },
  });
}

export async function resolveHostObservationEnd(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<Date> {
  const delegate = (
    tx as unknown as {
      systemParameter?: {
        findFirst?: (args: unknown) => Promise<{ value?: unknown } | null>;
      };
    }
  ).systemParameter;
  let days = DEFAULT_HOST_REWARD_OBSERVATION_DAYS;
  if (delegate?.findFirst) {
    for (const key of HOST_REWARD_OBSERVATION_PARAMETER_KEYS) {
      const parameter = await delegate.findFirst({
        where: {
          key,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (parameter) {
        const parsed =
          typeof parameter.value === 'number'
            ? parameter.value
            : Number(parameter.value);
        if (Number.isFinite(parsed))
          days = Math.min(365, Math.max(0, Math.round(parsed)));
        break;
      }
    }
  }
  return new Date(now.getTime() + days * 86_400_000);
}

export async function createHostReward(
  tx: Prisma.TransactionClient,
  game: { hostId: string },
  gameId: string,
  eligibility: RewardEligibility,
  rule: RewardRuleSnapshot,
  observationEndsAt: Date,
) {
  const rewardValue = Math.min(
    rule.cap,
    eligibility.eligible.length * rule.perCheckedIn,
  );
  // HostReward is unique per game.  The compound business key is enforced
  // in the database and this upsert makes concurrent completion requests
  // resolve to the same immutable reward instead of racing through a
  // read-then-create sequence.
  return tx.hostReward.upsert({
    where: { gameId },
    update: {},
    create: {
      hostId: game.hostId,
      gameId,
      rewardType: rule.rewardType,
      rewardValue,
      basisCount: eligibility.eligible.length,
      status: RewardStatus.PENDING_OBSERVATION,
      availableAt: observationEndsAt,
    },
  });
}

export async function writeCompletionAudit(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  game: { id: string; status: GameStatus },
  reward: {
    id: string;
    rewardValue: number;
    basisCount: number;
    rewardType: string;
  },
  eligibility: RewardEligibility,
  observationEndsAt: Date,
  repaired: boolean,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: actor.roles[0],
      action: repaired ? 'GAME_REWARD_REBUILT' : 'GAME_COMPLETED',
      objectType: 'Game',
      objectId: game.id,
      oldValue: { status: game.status } as never,
      newValue: {
        status: GameStatus.COMPLETED,
        rewardId: reward.id,
        rewardType: reward.rewardType,
        rewardValue: reward.rewardValue,
        checkedIn: eligibility.eligible.length,
        checkedInRegistrationIds: eligibility.eligible.map((item) => item.id),
        excludedRefundedRegistrationIds: eligibility.excludedRefunded.map(
          (item) => item.id,
        ),
        excludedHostRegistrationIds: eligibility.excludedSelf.map(
          (item) => item.id,
        ),
        pendingRefundRegistrationIds: eligibility.pendingRefund.map(
          (item) => item.id,
        ),
        observationEndsAt: observationEndsAt.toISOString(),
      } as never,
    },
  });
}
