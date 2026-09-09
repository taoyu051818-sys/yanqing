import {
  assertFixedDoubles,
  assertEventManager,
} from '../competition/event-competition-policy.js';
import { isPrismaErrorCode } from '../shared/event-command-support.js';
import { promoteNextEventWaitlist } from './event-waitlist.js';
import {
  stateTransition,
  lockAdmissionOrder,
} from '../../common/state-transition.js';
import {
  Inject,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  OrderStatus,
  Prisma,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { orderResponse } from '../../orders/order-response.js';
import type { EventTeamCheckInDto } from '../events.dto.js';
import {
  assertOperationTimeWindow,
  EVENT_CHECK_IN_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';
import { eventTeamCommandResponse } from '../shared/event-responses.js';

@Injectable()
export class EventParticipationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async myRegistration(eventId: string, actor: AuthUser) {
    const registration = await this.prisma.eventTeam.findFirst({
      where: {
        eventId,
        OR: [
          { captainId: actor.sub },
          { playerAUserId: actor.sub },
          { playerBUserId: actor.sub },
        ],
      },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            payableCents: true,
            paidCents: true,
            refunds: {
              orderBy: { requestedAt: 'desc' },
              select: {
                id: true,
                amountCents: true,
                reason: true,
                status: true,
                requestedAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!registration) return null;
    const registrationView = {
      id: registration.id,
      isCaptain: registration.captainId === actor.sub,
      name: registration.name,
      playerAName: registration.playerAName,
      playerBName: registration.playerBName,
      category: registration.category,
      status: registration.status,
      paymentDueAt: registration.paymentDueAt,
      waitlistedAt: registration.waitlistedAt,
      promotedAt: registration.promotedAt,
      cancellationPending: registration.cancellationPending,
      cancelReason: registration.cancelReason,
      cancelRequestedAt: registration.cancelRequestedAt,
      cancellationResolvedAt: registration.cancellationResolvedAt,
      cancelledAt: registration.cancelledAt,
      checkedInAt: registration.checkedInAt,
      points: registration.points,
      wins: registration.wins,
      losses: registration.losses,
      scoreDiff: registration.scoreDiff,
      finalRank: registration.finalRank,
      eventPointsAwarded: registration.eventPointsAwarded,
      order: registration.order ? orderResponse(registration.order) : null,
    };
    if (registration.status !== RegistrationStatus.WAITLISTED) {
      return { registration: registrationView, waitlistPosition: null };
    }
    const ahead = await this.prisma.eventTeam.count({
      where: {
        eventId,
        status: RegistrationStatus.WAITLISTED,
        OR: [
          { createdAt: { lt: registration.createdAt } },
          {
            createdAt: registration.createdAt,
            id: { lt: registration.id },
          },
        ],
      },
    });
    return { registration: registrationView, waitlistPosition: ahead + 1 };
  }

  /** Manually retry timeout cleanup and FIFO promotion from event operations. */
  async promoteWaitlist(eventId: string, actor: AuthUser) {
    assertEventManager(actor);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const event = await tx.event.findUnique({
              where: { id: eventId },
              select: { id: true },
            });
            if (!event) throw new NotFoundException('赛事不存在');
            return promoteNextEventWaitlist(
              tx,
              eventId,
              actor.sub,
              actor.roles[0],
            );
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt < 3 &&
          (isPrismaErrorCode(error, 'P2002') ||
            isPrismaErrorCode(error, 'P2034'))
        ) {
          continue;
        }
        if (
          isPrismaErrorCode(error, 'P2002') ||
          isPrismaErrorCode(error, 'P2034')
        ) {
          throw new ConflictException('候补晋级发生并发冲突，请稍后重试');
        }
        throw error;
      }
    }
    throw new ConflictException('候补晋级发生并发冲突，请稍后重试');
  }

  async checkIn(
    eventId: string,
    teamId: string,
    actor: AuthUser,
    dto: EventTeamCheckInDto = {},
  ) {
    return stateTransition(this.prisma, async (tx) => {
      const team = await tx.eventTeam.findFirst({
        where: { id: teamId, eventId },
        include: {
          event: { select: { startsAt: true } },
          order: { select: { id: true, status: true } },
        },
      });
      if (!team) throw new NotFoundException('参赛组合不存在');
      assertFixedDoubles(team);
      if (
        ![RegistrationStatus.PAID, RegistrationStatus.CHECKED_IN].includes(
          team.status as never,
        )
      ) {
        throw new ConflictException('参赛报名尚未支付');
      }
      if (
        team.cancellationPending ||
        team.order?.status === OrderStatus.REFUND_PENDING
      ) {
        throw new ConflictException('该报名正在等待退款审批，暂不可签到');
      }
      if (
        team.order &&
        [OrderStatus.REFUNDED, OrderStatus.CANCELLED].includes(
          team.order.status as never,
        )
      ) {
        throw new ConflictException('该报名已退款或取消，不能签到');
      }
      await lockAdmissionOrder(tx, team.order?.id);
      if (team.status === RegistrationStatus.CHECKED_IN)
        return eventTeamCommandResponse(team);
      const checkedInAt = new Date();
      const timeWindowPolicy = await assertOperationTimeWindow(tx, {
        actor,
        parameterKey: EVENT_CHECK_IN_WINDOW_PARAMETER,
        defaults: { earlyMinutes: 30, lateMinutes: 30 },
        scheduledStartsAt: team.event.startsAt,
        scheduledEndsAt: team.event.startsAt,
        action: 'EVENT_TEAM_CHECK_IN',
        objectType: 'EventTeam',
        objectId: teamId,
        overrideReason: dto.overrideReason,
        observedAt: checkedInAt,
      });
      const updated = await tx.eventTeam.update({
        where: {
          id: teamId,
          status: RegistrationStatus.PAID,
          AND: [{ orderId: team.orderId }],
          cancellationPending: false,
        },
        data: {
          status: RegistrationStatus.CHECKED_IN,
          checkedInAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'EVENT_TEAM_CHECKED_IN',
          objectType: 'EventTeam',
          objectId: teamId,
          oldValue: { status: team.status } as never,
          newValue: {
            status: RegistrationStatus.CHECKED_IN,
            checkedInAt: checkedInAt.toISOString(),
            timeWindowPolicy,
          } as never,
        },
      });
      return eventTeamCommandResponse(updated);
    });
  }
}
