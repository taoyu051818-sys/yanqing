import type { TrainingSessionView } from '@yanqing/shared';
import { trainingSessionScope } from '../../common/auth/operation-scopes.js';
import {
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  resolveOperationWindowConfiguration,
  TRAINING_ATTENDANCE_WINDOW_PARAMETER,
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

  async listSessions(
    actor?: AuthUser,
  ): Promise<TrainingSessionView<Date, Prisma.Decimal>[]> {
    const observedAt = new Date();
    const [sessions, attendanceConfiguration, completionConfiguration] =
      await Promise.all([
        this.prisma.trainingSession.findMany({
          where: trainingSessionScope(actor),
          include: {
            class: { include: { product: true } },
            attendances: {
              include: {
                enrollment: {
                  include: {
                    buyer: { select: { displayName: true } },
                    student: true,
                  },
                },
              },
            },
          },
          orderBy: { startsAt: 'desc' },
          take: 100,
        }),
        resolveOperationWindowConfiguration(
          this.prisma,
          TRAINING_ATTENDANCE_WINDOW_PARAMETER,
          { earlyMinutes: 30, lateMinutes: 120 },
          observedAt,
        ),
        resolveOperationWindowConfiguration(
          this.prisma,
          TRAINING_COMPLETION_WINDOW_PARAMETER,
          { earlyMinutes: 0, lateMinutes: 240 },
          observedAt,
        ),
      ]);
    const mayHistoricallyOverride = Boolean(
      actor?.roles.some((role) =>
        [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
      ),
    );
    const windowProjection = (
      startsAt: Date,
      endsAt: Date,
      configuration: { earlyMinutes: number; lateMinutes: number },
    ) => {
      const opensAt = new Date(
        startsAt.getTime() - configuration.earlyMinutes * 60_000,
      );
      const closesAt = new Date(
        endsAt.getTime() + configuration.lateMinutes * 60_000,
      );
      const state =
        observedAt < opensAt
          ? ('NOT_OPEN' as const)
          : observedAt <= closesAt
            ? ('OPEN' as const)
            : ('CLOSED' as const);
      return {
        opensAt: opensAt.toISOString(),
        closesAt: closesAt.toISOString(),
        state,
        mayHistoricallyOverride: state === 'CLOSED' && mayHistoricallyOverride,
      };
    };
    return sessions.map((session) => ({
      id: session.id,
      classId: session.classId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      status: session.status,
      courtCount: session.courtCount,
      occupiedCourtHours: session.occupiedCourtHours,
      note: session.note,
      attendanceWindow: windowProjection(
        session.startsAt,
        session.endsAt,
        attendanceConfiguration,
      ),
      completionWindow: windowProjection(
        session.endsAt,
        session.endsAt,
        completionConfiguration,
      ),
      class: {
        id: session.class.id,
        name: session.class.name,
        capacity: session.class.capacity,
        active: session.class.active,
        product: {
          id: session.class.product.id,
          name: session.class.product.name,
          audience: session.class.product.audience,
        },
      },
      attendances: session.attendances.map((attendance) => ({
        id: attendance.id,
        sessionId: attendance.sessionId,
        enrollmentId: attendance.enrollmentId,
        status: attendance.status,
        consumedSessions: attendance.consumedSessions,
        confirmedRevenueCents: attendance.confirmedRevenueCents,
        growthPointsAwarded: attendance.growthPointsAwarded,
        feedback: attendance.feedback,
        checkedInAt: attendance.checkedInAt,
        consumedAt: attendance.consumedAt,
        enrollment: {
          id: attendance.enrollment.id,
          enrollmentNo: attendance.enrollment.enrollmentNo,
          status: attendance.enrollment.status,
          student: attendance.enrollment.student
            ? {
                id: attendance.enrollment.student.id,
                displayName: attendance.enrollment.student.displayName,
              }
            : null,
          buyer: attendance.enrollment.buyer,
        },
      })),
    }));
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

    const session = await this.prisma.$transaction(
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
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
