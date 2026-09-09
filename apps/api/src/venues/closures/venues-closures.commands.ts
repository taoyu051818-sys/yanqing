import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BookingStatus,
  CourtClosureStatus,
  AppRole,
  Prisma,
} from '../../generated/prisma/client.js';
import type {
  CancelCourtClosureDto,
  CreateCourtClosureDto,
  ListCourtClosuresQueryDto,
} from '../venues.dto.js';
import {
  CLOSURE_READ_ROLES,
  CLOSURE_WRITE_ROLES,
  courtClosureView,
} from '../shared/venues-support.js';

export async function listClosures(
  prisma: PrismaService,
  query: ListCourtClosuresQueryDto,
  actor: AuthUser,
) {
  assertClosureRole(actor, CLOSURE_READ_ROLES, '仅前台或管理员可查看封场日历');
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (from && to && from >= to)
    throw new BadRequestException('查询结束时间必须晚于开始时间');
  const closures = await prisma.courtClosure.findMany({
    where: {
      ...(query.courtId ? { courtId: query.courtId.trim() } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(to ? { startsAt: { lt: to } } : {}),
      ...(from ? { endsAt: { gt: from } } : {}),
    },
    include: {
      court: { select: { id: true, code: true, name: true, enabled: true } },
      createdBy: { select: { id: true, displayName: true } },
      cancelledBy: { select: { id: true, displayName: true } },
    },
    orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
  });
  return closures.map(courtClosureView);
}

export async function createClosure(
  prisma: PrismaService,
  dto: CreateCourtClosureDto,
  actor: AuthUser,
) {
  assertClosureRole(actor, CLOSURE_WRITE_ROLES, '仅管理员可创建封场计划');
  const command = closureCommand(dto);
  const replay = await prisma.courtClosure.findUnique({
    where: { creationIdempotencyKey: command.creationIdempotencyKey },
    include: { court: true, createdBy: true, cancelledBy: true },
  });
  if (replay)
    return courtClosureView(assertClosureReplay(replay, command, actor));

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const court = await tx.court.findUnique({
          where: { id: command.courtId },
          select: { id: true, code: true, name: true },
        });
        if (!court) throw new NotFoundException('场地不存在');

        const overlappingClosure = await tx.courtClosure.findFirst({
          where: {
            courtId: command.courtId,
            status: CourtClosureStatus.ACTIVE,
            startsAt: { lt: command.endsAt },
            endsAt: { gt: command.startsAt },
          },
          select: { id: true, startsAt: true, endsAt: true, reason: true },
          orderBy: { startsAt: 'asc' },
        });
        if (overlappingClosure) {
          throw new ConflictException(
            `该场地已有重叠封场：${overlappingClosure.startsAt.toISOString()} 至 ${overlappingClosure.endsAt.toISOString()}（${overlappingClosure.reason}）`,
          );
        }

        const bookingCutoff =
          command.startsAt > new Date() ? command.startsAt : new Date();
        const blockingBookingWhere: Prisma.CourtBookingWhereInput = {
          courtId: command.courtId,
          status: { not: BookingStatus.CANCELLED },
          startsAt: { lt: command.endsAt },
          endsAt: { gt: bookingCutoff },
        };
        const blockingBookingCount = await tx.courtBooking.count({
          where: blockingBookingWhere,
        });
        if (blockingBookingCount) {
          const blockingBookings = await tx.courtBooking.findMany({
            where: blockingBookingWhere,
            select: {
              id: true,
              orderId: true,
              status: true,
              startsAt: true,
              endsAt: true,
            },
            orderBy: { startsAt: 'asc' },
            take: 20,
          });
          const details = blockingBookings
            .map(
              (booking) =>
                `${booking.startsAt.toISOString()}~${booking.endsAt.toISOString()}[${booking.orderId ?? booking.id}]`,
            )
            .join('；');
          const remainder =
            blockingBookingCount > blockingBookings.length
              ? `；另有 ${blockingBookingCount - blockingBookings.length} 笔未展开`
              : '';
          throw new ConflictException(
            `封场范围内已有 ${blockingBookingCount} 笔未取消预约，需先逐笔处理，系统不会自动取消或退款：${details}${remainder}`,
          );
        }

        const created = await tx.courtClosure.create({
          data: {
            courtId: command.courtId,
            startsAt: command.startsAt,
            endsAt: command.endsAt,
            reason: command.reason,
            creationIdempotencyKey: command.creationIdempotencyKey,
            createdById: actor.sub,
          },
          include: { court: true, createdBy: true, cancelledBy: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: closureAuditRole(actor),
            action: 'COURT_CLOSURE_CREATED',
            objectType: 'CourtClosure',
            objectId: created.id,
            newValue: {
              courtId: created.courtId,
              startsAt: created.startsAt,
              endsAt: created.endsAt,
              reason: created.reason,
              status: created.status,
            } as never,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return courtClosureView(created);
  } catch (error) {
    if (
      error instanceof ConflictException ||
      error instanceof NotFoundException
    )
      throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const concurrent = await prisma.courtClosure.findUnique({
        where: { creationIdempotencyKey: command.creationIdempotencyKey },
        include: { court: true, createdBy: true, cancelledBy: true },
      });
      if (concurrent)
        return courtClosureView(
          assertClosureReplay(concurrent, command, actor),
        );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    ) {
      throw new ConflictException(
        '封场范围刚刚发生预约或封场变更，请刷新日历后重试',
      );
    }
    throw error;
  }
}

export async function cancelClosure(
  prisma: PrismaService,
  id: string,
  dto: CancelCourtClosureDto,
  actor: AuthUser,
) {
  assertClosureRole(actor, CLOSURE_WRITE_ROLES, '仅管理员可取消封场计划');
  return prisma.$transaction(
    async (tx) => {
      const before = await tx.courtClosure.findUnique({
        where: { id },
        include: { court: true, createdBy: true, cancelledBy: true },
      });
      if (!before) throw new NotFoundException('封场记录不存在');
      if (before.status === CourtClosureStatus.CANCELLED)
        return courtClosureView(before);

      const cancelledAt = new Date();
      const changed = await tx.courtClosure.updateMany({
        where: { id, status: CourtClosureStatus.ACTIVE },
        data: {
          status: CourtClosureStatus.CANCELLED,
          cancelledById: actor.sub,
          cancelledAt,
          cancelReason: dto.reason.trim(),
        },
      });
      if (changed.count !== 1) {
        const latest = await tx.courtClosure.findUnique({
          where: { id },
          include: { court: true, createdBy: true, cancelledBy: true },
        });
        if (latest?.status === CourtClosureStatus.CANCELLED)
          return courtClosureView(latest);
        throw new ConflictException('封场状态已被其他操作更新，请刷新后重试');
      }
      const after = await tx.courtClosure.findUniqueOrThrow({
        where: { id },
        include: { court: true, createdBy: true, cancelledBy: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: closureAuditRole(actor),
          action: 'COURT_CLOSURE_CANCELLED',
          objectType: 'CourtClosure',
          objectId: id,
          oldValue: {
            status: before.status,
            courtId: before.courtId,
            startsAt: before.startsAt,
            endsAt: before.endsAt,
          } as never,
          newValue: {
            status: after.status,
            cancelledById: actor.sub,
            cancelledAt,
            cancelReason: after.cancelReason,
          } as never,
          reason: after.cancelReason,
        },
      });
      return courtClosureView(after);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function assertClosureRole(
  actor: AuthUser,
  allowed: readonly AppRole[],
  message: string,
) {
  if (!actor.roles.some((role) => allowed.includes(role)))
    throw new ForbiddenException(message);
}

export function closureAuditRole(actor: AuthUser) {
  return (
    actor.roles.find((role) => CLOSURE_WRITE_ROLES.includes(role)) ??
    actor.roles[0]
  );
}

export function closureCommand(dto: CreateCourtClosureDto) {
  const startsAt = new Date(dto.startsAt);
  const endsAt = new Date(dto.endsAt);
  if (endsAt <= startsAt)
    throw new BadRequestException('封场结束时间必须晚于开始时间');
  if (endsAt <= new Date())
    throw new BadRequestException('不能创建已经结束的封场计划');
  return {
    courtId: dto.courtId.trim(),
    startsAt,
    endsAt,
    reason: dto.reason.trim(),
    creationIdempotencyKey: dto.creationIdempotencyKey.trim(),
  };
}

export function assertClosureReplay(
  existing: {
    courtId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    creationIdempotencyKey: string;
    createdById: string;
  },
  command: ReturnType<typeof closureCommand>,
  actor: AuthUser,
) {
  if (
    existing.createdById !== actor.sub ||
    existing.courtId !== command.courtId ||
    existing.startsAt.getTime() !== command.startsAt.getTime() ||
    existing.endsAt.getTime() !== command.endsAt.getTime() ||
    existing.reason !== command.reason
  ) {
    throw new ConflictException('封场幂等键已用于不同命令');
  }
  return existing;
}
