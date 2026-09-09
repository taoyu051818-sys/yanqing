import { ConflictException, NotFoundException } from '@nestjs/common';
import { rankSwissPairs, eventPointsForRank } from '@yanqing/shared';
import type { AuthUser } from '../common/auth/auth-user.js';
import type { PrismaService } from '../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  EventStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { requireOrderTransition } from '../orders/order-transition.js';
import { completeOrderFulfillment } from '../orders/order-fulfillment.js';
import {
  assertEventConfiguration,
  assertPeopleRange,
  assertParticipantIdsUnique,
  assertFixedDoubles,
  assertRoundMatches,
  EVENT_TOTAL_ROUNDS,
} from './event-competition-policy.js';

const EVENT_STATUSES_NOT_FINISHABLE: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.CANCELLED,
];

const EVENT_NO_SHOW_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PAID,
  OrderStatus.CHECKED_IN,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
]);

const EVENT_COMPLETED_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(
  EVENT_NO_SHOW_ORDER_STATUSES,
);

export const eventPointRecipientIds = (team: {
  captainId: string;
  captainPlays?: boolean;
  playerAUserId?: string | null;
  playerBUserId?: string | null;
}): string[] => [
  ...new Set(
    [
      team.playerAUserId,
      team.playerBUserId,
      ...(team.captainPlays === false ? [] : [team.captainId]),
    ].filter((id): id is string => Boolean(id)),
  ),
];

export async function finish(
  prisma: PrismaService,
  eventId: string,
  actor: AuthUser,
) {
  return prisma.$transaction(
    async (tx) => {
      const event = await tx.event.findUnique({
        where: { id: eventId },
        // Include completed teams as well: finish marks the participant rows
        // COMPLETED, and a retry must still be able to rebuild the ranking
        // from those immutable rows.
        include: {
          teams: {
            include: {
              order: {
                select: {
                  id: true,
                  status: true,
                  completedAt: true,
                  paidCents: true,
                  refundedCents: true,
                },
              },
            },
          },
          matches: true,
        },
      });
      if (!event) throw new NotFoundException('赛事不存在');

      assertEventConfiguration(event);
      const teams = event.teams.filter((team) =>
        event.status === EventStatus.COMPLETED
          ? team.status === RegistrationStatus.CHECKED_IN ||
            team.status === RegistrationStatus.COMPLETED
          : team.status === RegistrationStatus.CHECKED_IN,
      );

      // Completion is the idempotency boundary.  Once the event is marked
      // completed, all award writes from the same transaction have committed
      // and a retry must only return the persisted ranking.
      if (event.status === EventStatus.COMPLETED) {
        await completeTerminalEventOrders(tx, event.id, event.teams, actor);
        const ranked = rankSwissPairs(teams);
        return ranked.map((team, index) => ({
          ...team,
          finalRank: team.finalRank ?? index + 1,
          eventPointsAwarded:
            team.eventPointsAwarded ||
            eventPointsForRank(index + 1, ranked.length),
        }));
      }
      if (EVENT_STATUSES_NOT_FINISHABLE.includes(event.status)) {
        throw new ConflictException('当前赛事状态不允许完赛');
      }
      if (
        event.teams.some(
          (team) => team.order?.status === OrderStatus.REFUND_PENDING,
        )
      ) {
        throw new ConflictException('赛事存在待审退款报名，请先处理退款再完赛');
      }
      if (event.currentRound !== EVENT_TOTAL_ROUNDS) {
        throw new ConflictException(
          `赛事必须完成${EVENT_TOTAL_ROUNDS}轮后才能完赛`,
        );
      }
      assertPeopleRange(teams.length, event.capacityPeople);
      assertParticipantIdsUnique(teams);
      for (const team of teams) assertFixedDoubles(team);
      for (let round = 1; round <= EVENT_TOTAL_ROUNDS; round += 1) {
        assertRoundMatches(teams, event.matches, round);
      }

      const ranked = rankSwissPairs(teams);
      const participantOutcomes = await finalizeEventNonParticipants(
        tx,
        event.id,
        event.teams,
        actor,
        new Date(),
      );
      let awardedCount = 0;
      for (const [index, team] of ranked.entries()) {
        const rank = index + 1;
        const points = eventPointsForRank(rank, ranked.length);
        await tx.eventTeam.update({
          where: { id: team.id },
          data: {
            finalRank: rank,
            eventPointsAwarded: points,
            status: RegistrationStatus.COMPLETED,
          },
        });
        if (
          team.order &&
          EVENT_COMPLETED_ORDER_STATUSES.has(team.order.status)
        ) {
          await completeOrderFulfillment(tx, {
            orderId: team.order.id,
            actor,
            objectType: 'EventTeam',
            objectId: team.id,
            outcome: 'COMPLETED',
            reason: '赛事完赛且队伍有签到及完整赛果',
            metadata: {
              eventId: event.id,
              finalRank: rank,
              eventPointsAwarded: points,
            },
          });
        }
        const playerIds = eventPointRecipientIds(team);
        for (const userId of playerIds) {
          const idempotencyKey = `EVENT:${event.id}:${userId}`;
          // AccountTransaction.idempotencyKey is unique.  Check it before
          // changing the balance so an operator retry cannot issue points a
          // second time.  The optional guard keeps lightweight unit-test
          // doubles compatible while the real Prisma client always exposes
          // findUnique.
          const findAward = tx.accountTransaction?.findUnique;
          const existingAward =
            typeof findAward === 'function'
              ? await findAward.call(tx.accountTransaction, {
                  where: { idempotencyKey },
                })
              : null;
          if (existingAward) {
            if (
              existingAward.amount !== points ||
              existingAward.reasonCode !== 'EVENT_RANK_POINTS'
            ) {
              throw new ConflictException(
                `赛事积分幂等流水 ${idempotencyKey} 与本次发放不一致`,
              );
            }
            continue;
          }
          const account = await tx.account.upsert({
            where: {
              userId_type: { userId, type: AccountType.EVENT_POINTS },
            },
            update: {},
            create: { userId, type: AccountType.EVENT_POINTS },
          });
          const balanceBefore = Number(account.balance ?? 0);
          await tx.account.update({
            where: { id: account.id },
            data: {
              balance: { increment: points },
              version: { increment: 1 },
            },
          });
          await tx.accountTransaction.create({
            data: {
              accountId: account.id,
              kind: AccountTxnKind.CREDIT,
              amount: points,
              balanceBefore,
              balanceAfter: balanceBefore + points,
              reasonCode: 'EVENT_RANK_POINTS',
              reason: `${event.name} 第${rank}名`,
              operatorId: actor.sub,
              idempotencyKey,
            },
          });
          awardedCount += 1;
        }
      }
      await tx.event.update({
        where: { id: eventId },
        data: { status: EventStatus.COMPLETED },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'EVENT_FINISHED',
          objectType: 'Event',
          objectId: eventId,
          oldValue: {
            status: event.status,
            currentRound: event.currentRound,
          } as never,
          newValue: {
            status: EventStatus.COMPLETED,
            currentRound: EVENT_TOTAL_ROUNDS,
            ranking: ranked.map((team, index) => ({
              teamId: team.id,
              finalRank: index + 1,
              eventPointsAwarded: eventPointsForRank(index + 1, ranked.length),
            })),
            awardedCount,
            noShowTeamIds: participantOutcomes.noShowTeamIds,
            expiredTeamIds: participantOutcomes.expiredTeamIds,
          } as never,
        },
      });
      return ranked.map((team, index) => ({
        ...team,
        finalRank: index + 1,
        eventPointsAwarded: eventPointsForRank(index + 1, ranked.length),
      }));
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function completeTerminalEventOrders(
  tx: Prisma.TransactionClient,
  eventId: string,
  teams: Array<{
    id: string;
    status: RegistrationStatus;
    finalRank: number | null;
    order?: {
      id: string;
      status: OrderStatus;
      completedAt: Date | null;
    } | null;
  }>,
  actor: AuthUser,
): Promise<void> {
  for (const team of teams) {
    if (
      !team.order ||
      team.order.completedAt ||
      (team.status !== RegistrationStatus.COMPLETED &&
        team.status !== RegistrationStatus.NO_SHOW)
    ) {
      continue;
    }
    const allowed =
      team.status === RegistrationStatus.NO_SHOW
        ? EVENT_NO_SHOW_ORDER_STATUSES
        : EVENT_COMPLETED_ORDER_STATUSES;
    if (!allowed.has(team.order.status)) continue;
    await completeOrderFulfillment(tx, {
      orderId: team.order.id,
      actor,
      objectType: 'EventTeam',
      objectId: team.id,
      outcome:
        team.status === RegistrationStatus.NO_SHOW ? 'NO_SHOW' : 'COMPLETED',
      reason:
        team.status === RegistrationStatus.NO_SHOW
          ? '赛事结束且队伍无签到记录'
          : '补全历史完赛订单履约时间',
      metadata: { eventId, finalRank: team.finalRank },
    });
  }
}

async function finalizeEventNonParticipants(
  tx: Prisma.TransactionClient,
  eventId: string,
  teams: Array<{
    id: string;
    status: RegistrationStatus;
    orderId: string | null;
    paymentDueAt: Date | null;
    order?: {
      id: string;
      status: OrderStatus;
      completedAt: Date | null;
    } | null;
  }>,
  actor: AuthUser,
  completedAt: Date,
): Promise<{ noShowTeamIds: string[]; expiredTeamIds: string[] }> {
  const noShowTeamIds: string[] = [];
  const expiredTeamIds: string[] = [];
  for (const team of teams) {
    let outcome: RegistrationStatus | null = null;
    if (
      team.status === RegistrationStatus.PAID &&
      (!team.order || EVENT_NO_SHOW_ORDER_STATUSES.has(team.order.status))
    ) {
      outcome = RegistrationStatus.NO_SHOW;
    } else if (
      team.status === RegistrationStatus.REGISTERED ||
      team.status === RegistrationStatus.WAITLISTED
    ) {
      outcome = RegistrationStatus.CANCELLED;
    }
    if (!outcome) continue;

    const changed = await tx.eventTeam.updateMany({
      where: { id: team.id, eventId, status: team.status },
      data:
        outcome === RegistrationStatus.NO_SHOW
          ? { status: outcome, paymentDueAt: null }
          : { status: outcome, paymentDueAt: null, cancelledAt: completedAt },
    });
    if (changed.count !== 1) continue;

    if (
      outcome === RegistrationStatus.CANCELLED &&
      team.order?.status === OrderStatus.PENDING
    ) {
      await requireOrderTransition(tx, 'CANCEL_UNPAID', {
        where: { id: team.order.id, status: OrderStatus.PENDING },
        data: { status: OrderStatus.CANCELLED, cancelledAt: completedAt },
      });
      await tx.payment.updateMany({
        where: {
          orderId: team.order.id,
          status: {
            in: [
              PaymentStatus.CREATED,
              PaymentStatus.PROCESSING,
              PaymentStatus.FAILED,
            ],
          },
        },
        data: { status: PaymentStatus.CLOSED },
      });
    } else if (outcome === RegistrationStatus.NO_SHOW && team.order) {
      await completeOrderFulfillment(tx, {
        orderId: team.order.id,
        actor,
        objectType: 'EventTeam',
        objectId: team.id,
        outcome: 'NO_SHOW',
        completedAt,
        reason: '赛事结束且队伍无签到记录',
        metadata: { eventId },
      });
    }

    if (outcome === RegistrationStatus.NO_SHOW) noShowTeamIds.push(team.id);
    else expiredTeamIds.push(team.id);
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action:
          outcome === RegistrationStatus.NO_SHOW
            ? 'EVENT_TEAM_NO_SHOW'
            : 'EVENT_REGISTRATION_EXPIRED',
        objectType: 'EventTeam',
        objectId: team.id,
        oldValue: {
          status: team.status,
          paymentDueAt: team.paymentDueAt?.toISOString() ?? null,
        } as never,
        newValue: {
          status: outcome,
          eventId,
          orderId: team.order?.id ?? null,
          completedAt: completedAt.toISOString(),
        } as never,
      },
    });
  }
  return { noShowTeamIds, expiredTeamIds };
}
