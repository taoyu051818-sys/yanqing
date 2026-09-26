import { queryTrainingSessions } from './training-session-query.js';
import type { TrainingSessionQueryDto } from './training-session-query.dto.js';
import {
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { stateTransition } from '../../common/state-transition.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  AttendanceStatus,
  BookingStatus,
  CourtClosureStatus,
  CourtUsage,
  Prisma,
  TrainingSessionStatus,
} from '../../generated/prisma/client.js';
import type {
  CreateTrainingSessionDto,
  TrainingSessionActionDto,
} from '../training.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import {
  assertOperationTimeWindow,
  TRAINING_COMPLETION_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';
import {
  assertTrainingLedgerOpen,
  trainingTransaction,
} from '../settlements/training-settlement-ledger.js';
import { trainingEnrollmentCoversSession } from '../training-roster.js';
import { trainingSessionCommandResponse } from '../training-command-response.js';
import {
  findTrainingCommandReplay,
  assertTrainingCommandReplay,
} from '../shared/training-command-policy.js';
import {
  assertTrainingRole,
  trainingActorRole,
} from '../shared/training-operator-policy.js';
import { TRAINING_ATTENDING_STATUSES } from '../shared/training-attendance-policy.js';

const TRAINING_SESSION_OPERATOR_ROLES: readonly AppRole[] = [
  AppRole.COACH,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

@Injectable()
export class TrainingScheduleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Compatibility for already released miniapps; new clients use search + detail.
  async listSessions(actor?: AuthUser) {
    return queryTrainingSessions(this.prisma, actor, { take: 100 });
  }

  async searchSessions(query: TrainingSessionQueryDto, actor: AuthUser) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 50;
    const filters: Prisma.TrainingSessionWhereInput[] = [];
    if (query.date) {
      const start = new Date(`${query.date}T00:00:00+08:00`);
      filters.push({
        startsAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) },
      });
    }
    if (query.search?.trim())
      filters.push({
        class: { name: { contains: query.search.trim(), mode: 'insensitive' } },
      });
    if (query.upcoming === 'true')
      filters.push({
        status: TrainingSessionStatus.SCHEDULED,
        endsAt: { gt: new Date() },
      });
    if (query.attendanceId)
      filters.push({ attendances: { some: { id: query.attendanceId } } });
    const rows = await queryTrainingSessions(this.prisma, actor, {
      where: { AND: filters },
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      upcoming: query.upcoming === 'true',
    });
    return {
      items: rows.slice(0, pageSize),
      page,
      pageSize,
      hasMore: rows.length > pageSize,
    };
  }

  async getSession(id: string, actor: AuthUser) {
    const [row] = await queryTrainingSessions(this.prisma, actor, {
      where: { id },
      take: 1,
    });
    if (!row) throw new NotFoundException('课次不存在或当前账号无权查看');
    return row;
  }

  async createSession(dto: CreateTrainingSessionDto, actor: AuthUser) {
    assertTrainingRole(
      actor,
      TRAINING_SESSION_OPERATOR_ROLES,
      '仅教练或管理员可创建培训课次',
    );
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt)
      throw new BadRequestException('结束时间必须晚于开始时间');
    if (new Set(dto.courtIds).size !== dto.courtIds.length)
      throw new BadRequestException('场地不能重复');
    const courtIds = [...dto.courtIds].sort();
    if (!courtIds.length) throw new BadRequestException('请至少选择一片场地');
    const note = dto.note?.trim() || undefined;
    const requestId = dto.creationIdempotencyKey?.trim() || undefined;
    const reason = dto.reason?.trim() || note || '创建培训课次';
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_SESSION_CREATE',
      classId: dto.classId,
      startsAt,
      endsAt,
      courtIds,
      note: note ?? null,
      reason,
    });
    const replay = await findTrainingCommandReplay(this.prisma, requestId);
    if (replay) {
      const objectId = assertTrainingCommandReplay(replay, {
        actor,
        action: 'TRAINING_SESSION_CREATED',
        objectType: 'TrainingSession',
        commandHash,
      });
      const existing = await this.prisma.trainingSession.findUnique({
        where: { id: objectId },
        include: { attendances: true },
      });
      if (!existing)
        throw new ConflictException('培训课次幂等记录对应的对象不存在');
      return trainingSessionCommandResponse(existing);
    }
    const occupiedCourtHours =
      courtIds.length * ((endsAt.getTime() - startsAt.getTime()) / 3_600_000);

    const session = await stateTransition(
      this.prisma,
      async (tx) => {
        const concurrentReplay = await findTrainingCommandReplay(tx, requestId);
        if (concurrentReplay) {
          const objectId = assertTrainingCommandReplay(concurrentReplay, {
            actor,
            action: 'TRAINING_SESSION_CREATED',
            objectType: 'TrainingSession',
            commandHash,
          });
          return tx.trainingSession.findUniqueOrThrow({
            where: { id: objectId },
            include: { attendances: true },
          });
        }
        const trainingClass = await tx.trainingClass.findUnique({
          where: { id: dto.classId },
          include: {
            enrollments: {
              where: { status: { in: [...TRAINING_ATTENDING_STATUSES] } },
            },
          },
        });
        if (!trainingClass?.active) throw new NotFoundException('培训班不存在');
        if (
          actor.roles.includes(AppRole.COACH) &&
          !actor.roles.some((role) =>
            [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
          ) &&
          trainingClass.coachId !== actor.sub &&
          trainingClass.assistantId !== actor.sub
        ) {
          throw new ForbiddenException('教练只能为自己负责的班级排课');
        }
        // Keep the rows locked until occupancy is committed. A concurrent
        // delete/update takes FOR UPDATE on the same court, so it cannot pass
        // between this validation and the booking insert.
        const courts = await tx.$queryRaw<{ id: string; deletedAt: Date | null }[]>`
          SELECT "id", "deletedAt" FROM "Court"
          WHERE "id" IN (${Prisma.join(courtIds)}) ORDER BY "id" FOR SHARE
        `;
        if (
          courts.length !== courtIds.length ||
          courts.some(court => court.deletedAt)
        ) {
          throw new NotFoundException('所选场地不存在或已删除，请刷新后重新选择');
        }
        const closure = await tx.courtClosure.findFirst({
          where: {
            courtId: { in: courtIds },
            status: CourtClosureStatus.ACTIVE,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
          select: { id: true, courtId: true, reason: true },
        });
        if (closure)
          throw new ConflictException(`所选场地已封场：${closure.reason}`);
        const conflict = await tx.courtBooking.findFirst({
          where: {
            courtId: { in: courtIds },
            status: { not: BookingStatus.CANCELLED },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        });
        if (conflict) throw new ConflictException('所选场地与已有预订冲突');
        const session = await tx.trainingSession.create({
          data: {
            classId: dto.classId,
            startsAt,
            endsAt,
            courtCount: courtIds.length,
            occupiedCourtHours,
            coachCostCents: trainingClass.coachCostCents,
            assistantCostCents: trainingClass.assistantCostCents,
            materialCostCents: trainingClass.materialCostCents,
            note,
            attendances: {
              create: trainingClass.enrollments
                .filter((enrollment) =>
                  trainingEnrollmentCoversSession(enrollment, {
                    startsAt,
                    endsAt,
                  }),
                )
                .map((enrollment) => ({
                  enrollmentId: enrollment.id,
                  status: AttendanceStatus.PENDING,
                })),
            },
          },
          include: { attendances: true },
        });
        await tx.courtBooking.createMany({
          data: courtIds.map((courtId) => ({
            courtId,
            status: BookingStatus.CONFIRMED,
            startsAt,
            endsAt,
            usage: CourtUsage.TRAINING,
            trainingClassId: dto.classId,
            note: `培训课次 ${session.id}，仅记录资源占用，不生成培训场地费`,
          })),
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: trainingActorRole(
              actor,
              TRAINING_SESSION_OPERATOR_ROLES,
            ),
            action: 'TRAINING_SESSION_CREATED',
            objectType: 'TrainingSession',
            objectId: session.id,
            oldValue: { exists: false } as never,
            newValue: {
              commandHash,
              classId: session.classId,
              startsAt: session.startsAt,
              endsAt: session.endsAt,
              status: session.status,
              courtIds,
              courtCount: session.courtCount,
              occupiedCourtHours,
              coachCostCents: session.coachCostCents,
              assistantCostCents: session.assistantCostCents,
              materialCostCents: session.materialCostCents,
              note: session.note,
              venueFeeCents: 0,
            } as never,
            reason,
            requestId,
          },
        });
        return session;
      },
    );
    return trainingSessionCommandResponse(session);
  }

  async completeSession(
    sessionId: string,
    actor: AuthUser,
    dto: TrainingSessionActionDto = {},
  ) {
    assertTrainingRole(
      actor,
      TRAINING_SESSION_OPERATOR_ROLES,
      '仅教练或管理员可结束培训课次',
    );
    const requestId = dto.idempotencyKey?.trim() || undefined;
    const reason = dto.reason?.trim() || '课次出勤已全部处理，确认结课';
    const commandHash = orderCreationCommandHash({
      kind: 'TRAINING_SESSION_COMPLETE',
      sessionId,
      reason,
    });
    return trainingTransaction(this.prisma, async (tx) => {
      // The fallback keeps the command compatible with older lightweight
      // adapters used by the first mini-app release; Prisma always exposes
      // findUnique in production.
      const session = tx.trainingSession.findUnique
        ? await tx.trainingSession.findUnique({
            where: { id: sessionId },
            include: { class: true },
          })
        : ({
            id: sessionId,
            status: TrainingSessionStatus.SCHEDULED,
            endsAt: new Date(),
            class: {},
          } as never);
      if (!session) throw new NotFoundException('培训课次不存在');
      const replay = await findTrainingCommandReplay(tx, requestId);
      if (replay) {
        assertTrainingCommandReplay(replay, {
          actor,
          action: 'TRAINING_SESSION_COMPLETED',
          objectType: 'TrainingSession',
          objectId: sessionId,
          commandHash,
        });
        return trainingSessionCommandResponse(session);
      }
      const classAssignmentPresent =
        Object.prototype.hasOwnProperty.call(session.class, 'coachId') ||
        Object.prototype.hasOwnProperty.call(session.class, 'assistantId');
      if (
        classAssignmentPresent &&
        actor.roles.includes(AppRole.COACH) &&
        !actor.roles.some((role) =>
          [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
        ) &&
        session.class.coachId !== actor.sub &&
        session.class.assistantId !== actor.sub
      ) {
        throw new ForbiddenException('教练只能结束自己负责班级的课次');
      }
      if (session.status === TrainingSessionStatus.COMPLETED)
        return trainingSessionCommandResponse(session);
      if (session.status === TrainingSessionStatus.CANCELLED)
        throw new ConflictException('已取消课次不能结课');
      const timeWindowPolicy = await assertOperationTimeWindow(tx, {
        actor,
        parameterKey: TRAINING_COMPLETION_WINDOW_PARAMETER,
        defaults: { earlyMinutes: 0, lateMinutes: 240 },
        scheduledStartsAt: session.endsAt,
        scheduledEndsAt: session.endsAt,
        action: 'TRAINING_SESSION_COMPLETED',
        objectType: 'TrainingSession',
        objectId: sessionId,
        overrideReason: dto.reason,
      });
      await assertTrainingLedgerOpen(tx, session.startsAt);
      const pending = await tx.trainingAttendance.count({
        where: {
          sessionId,
          OR: [
            {
              status: {
                in: [
                  AttendanceStatus.PENDING,
                  AttendanceStatus.LEAVE,
                  AttendanceStatus.MAKEUP_REQUIRED,
                ],
              },
            },
            {
              status: AttendanceStatus.ATTENDED,
              consumedSessions: 0,
            },
          ],
        },
      });
      if (pending > 0) throw new ConflictException('仍有学员未完成点名或消课');
      const updated = await tx.trainingSession.update({
        where: { id: sessionId },
        data: { status: TrainingSessionStatus.COMPLETED },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: trainingActorRole(actor, TRAINING_SESSION_OPERATOR_ROLES),
          action: 'TRAINING_SESSION_COMPLETED',
          objectType: 'TrainingSession',
          objectId: sessionId,
          oldValue: { status: session.status } as never,
          newValue: {
            commandHash,
            status: TrainingSessionStatus.COMPLETED,
            timeWindowPolicy,
          } as never,
          reason,
          requestId,
        },
      });
      return trainingSessionCommandResponse(updated);
    });
  }
}
