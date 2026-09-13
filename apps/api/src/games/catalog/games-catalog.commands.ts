import { PUBLIC_GAME_LIST_SELECT } from './public-game-list.query.js';
import type {
  GameDetail,
  GameListItem,
  GameParticipants,
} from '@yanqing/shared';
import {
  GAME_SEAT_STATUSES,
  isValidGameCapacity,
  GAME_CAPACITY_MIN,
  GAME_CAPACITY_MAX,
} from '../game-registration-policy.js';
import { canManageGames } from '../../common/auth/operation-scopes.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  BookingStatus,
  CourtUsage,
  GameStatus,
  HostStatus,
  Prisma,
  RegistrationStatus,
} from '../../generated/prisma/client.js';
import { type CreateGameDto, type PublishGameDto } from '../games.dto.js';
import {
  GAME_CHECK_IN_WINDOW_PARAMETER,
  resolveOperationWindowConfiguration,
} from '../../common/time-window/operation-time-window.js';
import {
  serial,
  gameCommandResponse,
  GAME_STATUSES_NOT_PUBLISHABLE,
  GAME_DETAIL_STATUSES,
} from '../shared/games-support.js';
import { assertGameOperator } from '../shared/games-policy.js';

export async function detail(
  prisma: PrismaService,
  id: string,
): Promise<GameDetail<Date>> {
  const game = await prisma.game.findFirst({
    where: { id, status: { in: GAME_DETAIL_STATUSES } },
    select: {
      id: true,
      title: true,
      level: true,
      status: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      feeCents: true,
      newcomerOnly: true,
      description: true,
      host: { select: { displayName: true, avatarUrl: true } },
      courtBookings: { select: { court: { select: { name: true } } } },
      registrations: {
        where: {
          status: {
            in: [...GAME_SEAT_STATUSES, RegistrationStatus.WAITLISTED],
          },
        },
        select: { status: true },
      },
    },
  });
  if (!game) throw new NotFoundException('球局不存在或尚未发布');
  const { registrations, courtBookings, ...publicFields } = game;
  const pendingCount = registrations.filter(
    (item) => item.status === RegistrationStatus.REGISTERED,
  ).length;
  const waitlistCount = registrations.filter(
    (item) => item.status === RegistrationStatus.WAITLISTED,
  ).length;
  const occupiedCount = registrations.length - waitlistCount;
  return {
    ...publicFields,
    courtNames: [...new Set(courtBookings.map((item) => item.court.name))],
    occupiedCount,
    confirmedCount: occupiedCount - pendingCount,
    pendingCount,
    waitlistCount,
  };
}

export async function participants(
  prisma: PrismaService,
  id: string,
  actor: AuthUser,
): Promise<GameParticipants> {
  const confirmedStatuses = [
    RegistrationStatus.PAID,
    RegistrationStatus.CHECKED_IN,
    RegistrationStatus.COMPLETED,
  ];
  const game = await prisma.game.findFirst({
    where: { id, status: { in: GAME_DETAIL_STATUSES } },
    select: {
      registrations: {
        where: {
          OR: [{ status: { in: confirmedStatuses } }, { userId: actor.sub }],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          userId: true,
          status: true,
          user: { select: { displayName: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!game) throw new NotFoundException('球局不存在或尚未发布');
  // Retrieve order metadata only for the authenticated account, not the roster.
  const mine = await prisma.gameRegistration.findUnique({
    where: { gameId_userId: { gameId: id, userId: actor.sub } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      waitlistedAt: true,
      order: { select: { id: true, status: true } },
    },
  });
  const waitlistPosition =
    mine?.status === RegistrationStatus.WAITLISTED
      ? await prisma.gameRegistration.count({
          where: {
            gameId: id,
            status: RegistrationStatus.WAITLISTED,
            OR: [
              { waitlistedAt: { lt: mine.waitlistedAt } },
              {
                waitlistedAt: mine.waitlistedAt,
                createdAt: { lt: mine.createdAt },
              },
              {
                waitlistedAt: mine.waitlistedAt,
                createdAt: mine.createdAt,
                id: { lte: mine.id },
              },
            ],
          },
        })
      : null;
  return {
    participants: game.registrations
      .filter((item) => confirmedStatuses.includes(item.status as never))
      .map((item) => ({
        displayName: item.user.displayName,
        avatarUrl: item.user.avatarUrl,
        isMe: item.userId === actor.sub,
      })),
    myRegistration: mine
      ? {
          id: mine.id,
          status: mine.status,
          order: mine.order,
          waitlistPosition,
        }
      : null,
  };
}

export async function list(
  prisma: PrismaService,
  actor: AuthUser,
): Promise<GameListItem<Date>[]> {
  const games = await prisma.game.findMany({
    where: {
      status: {
        in: [
          GameStatus.OPEN,
          GameStatus.FULL,
          GameStatus.IN_PROGRESS,
          GameStatus.COMPLETED,
        ],
      },
    },
    select: {
      ...PUBLIC_GAME_LIST_SELECT,
      registrations: {
        where: { userId: actor.sub },
        select: {
          id: true,
          status: true,
          order: { select: { status: true } },
        },
        take: 1,
      },
    },
    orderBy: { startsAt: 'desc' },
  });
  return games.map(({ registrations, ...game }) => ({
    ...game,
    myRegistration: registrations[0]
      ? {
          id: registrations[0].id,
          status: registrations[0].status,
          orderStatus: registrations[0].order?.status ?? null,
        }
      : null,
  }));
}

export async function managed(prisma: PrismaService, actor: AuthUser) {
  const canManageAll = actor.roles.some((role) =>
    [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
  );
  if (!canManageGames(actor.roles)) {
    throw new ForbiddenException('当前角色无权访问球局经营列表');
  }
  const observedAt = new Date();
  const [games, checkInConfiguration] = await Promise.all([
    prisma.game.findMany({
      where: canManageAll ? undefined : { hostId: actor.sub },
      select: {
        id: true,
        code: true,
        title: true,
        level: true,
        status: true,
        startsAt: true,
        endsAt: true,
        capacity: true,
        feeCents: true,
        newcomerOnly: true,
        description: true,
        cancelReason: true,
        cancelledAt: true,
        host: { select: { displayName: true, avatarUrl: true } },
        registrations: {
          select: {
            id: true,
            status: true,
            checkedInAt: true,
            createdAt: true,
            user: { select: { displayName: true, avatarUrl: true } },
            order: { select: { status: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { startsAt: 'desc' },
    }),
    resolveOperationWindowConfiguration(
      prisma,
      GAME_CHECK_IN_WINDOW_PARAMETER,
      { earlyMinutes: 30, lateMinutes: 30 },
      observedAt,
    ),
  ]);
  const mayHistoricallyOverride = actor.roles.some((role) =>
    [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
  );
  return games.map((game) => {
    const scheduled = new Date(game.startsAt).getTime();
    const opensAt = new Date(
      scheduled - checkInConfiguration.earlyMinutes * 60_000,
    );
    const closesAt = new Date(
      scheduled + checkInConfiguration.lateMinutes * 60_000,
    );
    const state =
      observedAt < opensAt
        ? 'NOT_OPEN'
        : observedAt <= closesAt
          ? 'OPEN'
          : 'CLOSED';
    return {
      ...game,
      checkInWindow: {
        opensAt: opensAt.toISOString(),
        closesAt: closesAt.toISOString(),
        state,
        mayHistoricallyOverride: state === 'CLOSED' && mayHistoricallyOverride,
      },
    };
  });
}

export async function create(
  prisma: PrismaService,
  dto: CreateGameDto,
  actor: AuthUser,
) {
  if (
    !actor.roles.some((role) =>
      [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅已授权主理人或管理员可创建球局');
  }
  const host = await prisma.hostProfile.findUnique({
    where: { userId: actor.sub },
  });
  if (
    host?.status !== HostStatus.APPROVED &&
    !actor.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    )
  ) {
    throw new ConflictException('主理人申请尚未通过');
  }
  const title = dto.title.trim();
  if (!title) throw new BadRequestException('球局标题不能为空');
  const startsAt = new Date(dto.startsAt);
  const endsAt = new Date(dto.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new BadRequestException('球局时间无效');
  }
  if (endsAt <= startsAt)
    throw new BadRequestException('球局结束时间必须晚于开始时间');
  if (startsAt <= new Date())
    throw new BadRequestException('球局开始时间必须晚于当前时间');
  if (new Set(dto.courtIds).size !== dto.courtIds.length)
    throw new BadRequestException('场地不能重复');
  if (!isValidGameCapacity(dto.capacity)) {
    throw new BadRequestException(
      `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
    );
  }
  if (!Number.isInteger(dto.feeCents) || dto.feeCents < 0) {
    throw new BadRequestException('球局费用必须为非负整数');
  }

  return prisma.$transaction(
    async (tx) => {
      const courts = await tx.court.findMany({
        where: { id: { in: dto.courtIds }, enabled: true },
        select: { id: true, usage: true },
      });
      if (courts.length !== dto.courtIds.length)
        throw new NotFoundException('部分场地不存在或已停用');
      if (
        courts.some(
          (court) =>
            court.usage === CourtUsage.MAINTENANCE ||
            court.usage === CourtUsage.TRAINING,
        )
      ) {
        throw new ConflictException('球局不能使用维护场或培训专用场');
      }
      const closure = await tx.courtClosure.findFirst({
        where: {
          courtId: { in: dto.courtIds },
          status: 'ACTIVE',
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true, reason: true },
      });
      if (closure)
        throw new ConflictException(`所选场地时段已封场：${closure.reason}`);
      const conflict = await tx.courtBooking.findFirst({
        where: {
          courtId: { in: dto.courtIds },
          status: { not: BookingStatus.CANCELLED },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      });
      if (conflict) throw new ConflictException('所选场地时段已被占用');
      const game = await tx.game.create({
        data: {
          code: serial('GM'),
          title,
          hostId: actor.sub,
          level: dto.level,
          // Publishing is an explicit review action.  Keeping drafts out of
          // the member list prevents an incomplete game from being booked.
          status: GameStatus.DRAFT,
          startsAt,
          endsAt,
          capacity: dto.capacity,
          feeCents: dto.feeCents,
          description: dto.description,
          rewardRule: (dto.rewardRule ?? {
            type: 'BADMINTON_COIN',
            perCheckedIn: 20,
            cap: 500,
          }) as never,
        },
      });
      await tx.courtBooking.createMany({
        data: dto.courtIds.map((courtId) => ({
          courtId,
          memberId: actor.sub,
          status: BookingStatus.CONFIRMED,
          startsAt,
          endsAt,
          usage: CourtUsage.RETAIL,
          gameId: game.id,
          note: `主理人球局 ${game.code}`,
        })),
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'GAME_CREATED',
          objectType: 'Game',
          objectId: game.id,
          newValue: {
            status: GameStatus.DRAFT,
            title,
            startsAt,
            endsAt,
            courtIds: dto.courtIds,
            capacity: dto.capacity,
            feeCents: dto.feeCents,
          } as never,
        },
      });
      return game;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function publish(
  prisma: PrismaService,
  gameId: string,
  dto: PublishGameDto | undefined,
  actor: AuthUser,
) {
  if (
    !actor.roles.some((role) =>
      [AppRole.HOST, AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(
        role as never,
      ),
    )
  ) {
    throw new ForbiddenException('仅本局主理人或管理员可发布球局');
  }
  const reason = dto?.reason?.trim() || undefined;
  return prisma.$transaction(
    async (tx) => {
      const game = await tx.game.findUnique({
        where: { id: gameId },
        include: {
          host: { include: { hostProfile: true } },
          courtBookings: { include: { court: true } },
        },
      });
      if (!game) throw new NotFoundException('球局不存在');
      assertGameOperator(game.hostId, actor);
      if (game.status === GameStatus.OPEN) return gameCommandResponse(game);
      if (GAME_STATUSES_NOT_PUBLISHABLE.includes(game.status)) {
        throw new ConflictException(`球局当前状态为 ${game.status}，不能发布`);
      }
      if (
        game.host.hostProfile?.status !== HostStatus.APPROVED &&
        !actor.roles.some((role) =>
          [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
        )
      ) {
        throw new ConflictException('主理人资质尚未通过，不能发布球局');
      }
      if (game.startsAt <= new Date() || game.endsAt <= game.startsAt) {
        throw new ConflictException('球局时间已过期或设置无效');
      }
      if (!isValidGameCapacity(game.capacity)) {
        throw new ConflictException(
          `普通主理人球局人数上限必须在${GAME_CAPACITY_MIN}-${GAME_CAPACITY_MAX}人之间`,
        );
      }
      if (game.courtBookings.length === 0)
        throw new ConflictException('球局尚未绑定场地');
      if (
        game.courtBookings.some(
          (booking) =>
            booking.status === BookingStatus.CANCELLED ||
            !booking.court.enabled,
        )
      ) {
        throw new ConflictException('球局绑定的场地不可用');
      }
      const changed = await tx.game.updateMany({
        where: { id: gameId, status: GameStatus.DRAFT },
        data: { status: GameStatus.OPEN },
      });
      if (changed.count !== 1) {
        const latest = await tx.game.findUnique({ where: { id: gameId } });
        if (latest?.status === GameStatus.OPEN)
          return gameCommandResponse(latest);
        throw new ConflictException('球局已被其他操作更新，请刷新后重试');
      }
      const published = await tx.game.findUniqueOrThrow({
        where: { id: gameId },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'GAME_PUBLISHED',
          objectType: 'Game',
          objectId: gameId,
          oldValue: { status: GameStatus.DRAFT } as never,
          newValue: { status: GameStatus.OPEN, reason } as never,
          reason,
        },
      });
      return gameCommandResponse(published);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
