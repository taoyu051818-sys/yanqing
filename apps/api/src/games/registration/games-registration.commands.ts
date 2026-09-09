import { promoteNextGameWaitlist } from '../game-waitlist.js';
import {
  GAME_SEAT_STATUSES,
  isValidGameCapacity,
  GAME_CAPACITY_MIN,
  GAME_CAPACITY_MAX,
} from '../game-registration-policy.js';
import {
  stateTransition,
  lockAdmissionOrder,
} from '../../common/state-transition.js';
import { gameRegistrationOpen } from '../game-registration-policy.js';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BusinessType,
  GameStatus,
  OrderStatus,
  Prisma,
  RegistrationStatus,
  SubjectAccount,
} from '../../generated/prisma/client.js';
import { type GameCheckInDto, type RegisterGameDto } from '../games.dto.js';
import {
  executeOrderCreation,
  type OrderCreationFields,
} from '../../orders/order-creation-idempotency.js';
import {
  assertOperationTimeWindow,
  GAME_CHECK_IN_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';
import { resolveOperatingShareSnapshot } from '../../common/finance/operating-share.js';
import {
  serial,
  gameRegistrationCommandResponse,
  gameRegistrationResponse,
  ORDER_STATUSES_REFUNDED,
} from '../shared/games-support.js';

import { assertGameOperator } from '../shared/games-policy.js';

export async function register(
  prisma: PrismaService,
  gameId: string,
  dto: RegisterGameDto,
  actor: AuthUser,
) {
  const order = await executeOrderCreation(prisma, {
    memberId: actor.sub,
    creationIdempotencyKey: dto.creationIdempotencyKey,
    command: {
      kind: 'GAME_REGISTRATION',
      gameId,
      sourceChannel: dto.sourceChannel,
    },
    loadExisting: (id) =>
      prisma.order.findUniqueOrThrow({
        where: { id },
        include: { gameRegistration: true },
      }),
    create: (creation) => registerOnce(prisma, gameId, dto, actor, creation),
  });
  return gameRegistrationResponse(order);
}

export async function registerOnce(
  prisma: PrismaService,
  gameId: string,
  dto: RegisterGameDto,
  actor: AuthUser,
  creation: OrderCreationFields,
) {
  return prisma.$transaction(
    async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId },
        select: {
          id: true,
          title: true,
          hostId: true,
          feeCents: true,
          capacity: true,
          status: true,
          startsAt: true,
          endsAt: true,
        },
      });
      // FULL still accepts a waitlist entry.  It is a member-facing
      // registration state, not a hard stop, so the first released seat can
      // be offered to the oldest waiting member.
      if (
        !game ||
        (game.status !== GameStatus.OPEN && game.status !== GameStatus.FULL)
      ) {
        throw new NotFoundException('球局不在报名中');
      }
      if (!isValidGameCapacity(game.capacity)) {
        throw new ConflictException(
          `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
        );
      }
      if (!gameRegistrationOpen(game))
        throw new ConflictException('球局报名已截止或时间无效');
      const duplicate = await tx.gameRegistration.findUnique({
        where: { gameId_userId: { gameId, userId: actor.sub } },
      });
      if (duplicate?.status === RegistrationStatus.WAITLISTED) {
        const queue = await tx.gameRegistration.findMany({
          where: { gameId, status: RegistrationStatus.WAITLISTED },
          select: { id: true },
          orderBy: [
            { waitlistedAt: 'asc' },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        });
        const queueIndex = queue.findIndex((item) => item.id === duplicate.id);
        return {
          registration: duplicate,
          waitlistPosition: queueIndex >= 0 ? queueIndex + 1 : 1,
          status: RegistrationStatus.WAITLISTED,
        };
      }
      if (duplicate && GAME_SEAT_STATUSES.includes(duplicate.status)) {
        throw new ConflictException('已经报名该球局或正在候补');
      }

      const seated = await tx.gameRegistration.count({
        where: { gameId, status: { in: [...GAME_SEAT_STATUSES] } },
      });
      const waitlisted = await tx.gameRegistration.count({
        where: { gameId, status: RegistrationStatus.WAITLISTED },
      });
      // If a seat was released while an older waitlist entry is still
      // pending promotion, preserve FIFO order: a new caller joins behind
      // that entry instead of jumping the queue.
      if (seated >= game.capacity || waitlisted > 0) {
        const registration = duplicate
          ? await tx.gameRegistration.update({
              where: { id: duplicate.id },
              data: {
                status: RegistrationStatus.WAITLISTED,
                orderId: null,
                checkedInAt: null,
                waitlistVersion: { increment: 1 },
                waitlistedAt: new Date(),
              },
            })
          : await tx.gameRegistration.create({
              data: {
                gameId,
                userId: actor.sub,
                status: RegistrationStatus.WAITLISTED,
                waitlistVersion: 1,
                waitlistedAt: new Date(),
              },
            });
        await tx.game.updateMany({
          where: {
            id: gameId,
            status: { in: [GameStatus.OPEN, GameStatus.FULL] },
          },
          data: { status: GameStatus.FULL },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'GAME_WAITLISTED',
            objectType: 'GameRegistration',
            objectId: registration.id,
            newValue: {
              gameId,
              status: RegistrationStatus.WAITLISTED,
              position: waitlisted + 1,
            } as never,
          },
        });
        return {
          registration,
          waitlistPosition: waitlisted + 1,
          status: RegistrationStatus.WAITLISTED,
        };
      }

      const operatingShare = await resolveOperatingShareSnapshot(
        tx,
        BusinessType.GAME,
      );
      const order = await tx.order.create({
        data: {
          ...creation,
          orderNo: serial('GO'),
          memberId: actor.sub,
          createdById: actor.sub,
          businessType: BusinessType.GAME,
          subjectAccount: SubjectAccount.VENUE,
          sourceChannel: dto.sourceChannel,
          status: OrderStatus.PENDING,
          title: game.title,
          listAmountCents: game.feeCents,
          payableCents: game.feeCents,
          parameterSnapshot: {
            gameId,
            hostId: game.hostId,
            gameStartsAt: game.startsAt.toISOString(),
            operatingShare,
          },
          items: {
            create: {
              itemType: 'GAME_REGISTRATION',
              itemId: gameId,
              name: game.title,
              unitPriceCents: game.feeCents,
              amountCents: game.feeCents,
            },
          },
          gameRegistration: duplicate
            ? undefined
            : { create: { gameId, userId: actor.sub } },
        },
        include: { gameRegistration: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'GAME_ORDER_CREATED',
          objectType: 'Order',
          objectId: order.id,
          newValue: {
            memberId: actor.sub,
            createdById: actor.sub,
            businessType: BusinessType.GAME,
            amountCents: game.feeCents,
            creationIdempotencyKeyPresent: Boolean(
              creation.creationIdempotencyKey,
            ),
            gameId,
            hostId: game.hostId,
            gameRegistrationId: order.gameRegistration?.id ?? duplicate?.id,
            sourceChannel: dto.sourceChannel,
          } as never,
        },
      });
      if (duplicate) {
        // Reuse a terminal historical row rather than violating the
        // [gameId,userId] uniqueness constraint.  The old order remains in
        // the audit trail; this new order becomes the active registration.
        const registration = await tx.gameRegistration.update({
          where: { id: duplicate.id },
          data: {
            status: RegistrationStatus.REGISTERED,
            orderId: order.id,
            checkedInAt: null,
          },
        });
        if (seated + 1 >= game.capacity) {
          await tx.game.updateMany({
            where: { id: gameId, status: GameStatus.OPEN },
            data: { status: GameStatus.FULL },
          });
        }
        return { ...order, gameRegistration: registration };
      }
      if (seated + 1 >= game.capacity) {
        await tx.game.updateMany({
          where: { id: gameId, status: GameStatus.OPEN },
          data: { status: GameStatus.FULL },
        });
      }
      return order;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function promoteWaitlist(
  prisma: PrismaService,
  gameId: string,
  actor: AuthUser,
) {
  if (
    !actor.roles.some((role) =>
      [
        AppRole.HOST,
        AppRole.FRONT_DESK,
        AppRole.ADMIN,
        AppRole.SUPER_ADMIN,
      ].includes(role as never),
    )
  ) {
    throw new ForbiddenException('仅本局主理人、前台或管理员可处理球局候补');
  }
  return prisma.$transaction(
    async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId },
        select: { id: true, hostId: true },
      });
      if (!game) throw new NotFoundException('球局不存在');
      const hostOnly =
        actor.roles.includes(AppRole.HOST) &&
        !actor.roles.some((role) =>
          [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
            role as never,
          ),
        );
      if (hostOnly) assertGameOperator(game.hostId, actor);
      return promoteNextGameWaitlist(tx, gameId, actor.sub, actor.roles[0]);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function checkIn(
  prisma: PrismaService,
  gameId: string,
  userId: string,
  actor: AuthUser,
  dto: GameCheckInDto = {},
) {
  return stateTransition(prisma, async (tx) => {
    const registrationQuery = {
      include: {
        game: {
          select: { id: true, hostId: true, status: true, startsAt: true },
        },
        order: {
          select: {
            id: true,
            status: true,
            paidCents: true,
            refundedCents: true,
          },
        },
      },
    };
    const registration = tx.gameRegistration.findFirst
      ? await tx.gameRegistration.findFirst({
          where: { gameId, OR: [{ id: userId }, { userId }] },
          ...registrationQuery,
        })
      : await tx.gameRegistration.findUnique({
          where: { gameId_userId: { gameId, userId } },
          ...registrationQuery,
        });
    if (!registration) throw new NotFoundException('报名记录不存在');
    // Front desk staff may scan a member on behalf of the host.  A user
    // carrying only the HOST role, however, remains restricted to games they
    // own; this prevents one host from altering another host's attendance.
    assertGameOperator(registration.game.hostId, actor, {
      allowFrontDesk: true,
    });

    if (registration.order?.status === OrderStatus.REFUND_PENDING) {
      throw new ConflictException('该报名正在等待退款审批，请先处理退款再签到');
    }
    if (
      registration.order &&
      ORDER_STATUSES_REFUNDED.includes(registration.order.status)
    ) {
      throw new ConflictException('该报名已退款，不能签到');
    }
    await lockAdmissionOrder(tx, registration.order?.id);
    // A replay must still reject a pending/completed refund.
    if (registration.status === RegistrationStatus.CHECKED_IN)
      return gameRegistrationCommandResponse(registration);
    if (registration.status !== RegistrationStatus.PAID) {
      throw new ConflictException('报名未支付或不存在');
    }
    if (
      registration.game.status === GameStatus.CANCELLED ||
      registration.game.status === GameStatus.COMPLETED
    ) {
      throw new ConflictException('球局已结束或取消，不能签到');
    }
    const checkedInAt = new Date();
    const timeWindowPolicy = await assertOperationTimeWindow(tx, {
      actor,
      parameterKey: GAME_CHECK_IN_WINDOW_PARAMETER,
      defaults: { earlyMinutes: 30, lateMinutes: 30 },
      scheduledStartsAt: registration.game.startsAt,
      scheduledEndsAt: registration.game.startsAt,
      action: 'GAME_CHECK_IN',
      objectType: 'GameRegistration',
      objectId: registration.id,
      overrideReason: dto.overrideReason,
      observedAt: checkedInAt,
    });
    const updated = await tx.gameRegistration.update({
      where: {
        id: registration.id,
        status: RegistrationStatus.PAID,
        AND: [{ orderId: registration.orderId }],
      },
      data: { status: RegistrationStatus.CHECKED_IN, checkedInAt },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'GAME_CHECKED_IN',
        objectType: 'GameRegistration',
        objectId: registration.id,
        oldValue: { status: registration.status } as never,
        newValue: {
          status: RegistrationStatus.CHECKED_IN,
          checkedInAt: checkedInAt.toISOString(),
          timeWindowPolicy,
        } as never,
      },
    });
    return gameRegistrationCommandResponse(updated);
  });
}
