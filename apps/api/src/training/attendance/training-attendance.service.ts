import { isTrainingApprover } from '../training-access.js';
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
  TrainingSessionStatus,
} from '../../generated/prisma/client.js';
import type {
  AttendanceActionDto,
  MakeupAttendanceDto,
} from '../training.dto.js';
import {
  assertOperationTimeWindow,
  TRAINING_ATTENDANCE_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';
import { trainingTransaction } from '../settlements/training-settlement-ledger.js';
import {
  trainingAttendanceCommandResponse,
  trainingMakeupCommandResponse,
} from '../training-command-response.js';
import { activeConsumeRecognition } from '../shared/training-attendance-policy.js';

@Injectable()
export class TrainingAttendanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Record the operational attendance decision without touching the training
   * ledger.  This is deliberately separate from `consume` so a coach/front
   * desk can make a maker entry while the financial checker remains an
   * administrator.  A leave decision is persisted as MAKEUP_REQUIRED: it is
   * an approved leave which still needs a later session assignment.
   */
  async markAttendance(
    sessionId: string,
    dto: AttendanceActionDto,
    actor: AuthUser,
  ) {
    if (
      !actor.roles.some((role) =>
        (
          [
            AppRole.COACH,
            AppRole.FRONT_DESK,
            AppRole.ADMIN,
            AppRole.SUPER_ADMIN,
          ] as AppRole[]
        ).includes(role as never),
      )
    ) {
      throw new ForbiddenException('当前账号无权登记培训出勤');
    }

    return trainingTransaction(this.prisma, async (tx) => {
      const attendance = await tx.trainingAttendance.findUnique({
        where: {
          sessionId_enrollmentId: {
            sessionId,
            enrollmentId: dto.enrollmentId,
          },
        },
        include: {
          session: { include: { class: true } },
          revenueRecognitions: {
            include: { reversedBy: true },
            orderBy: { sequence: 'desc' },
          },
        },
      });
      if (!attendance) throw new NotFoundException('课次签到记录不存在');
      this.assertAttendanceOperator(attendance.session.class, actor);

      if (
        activeConsumeRecognition(attendance.revenueRecognitions) ||
        attendance.consumedSessions > 0
      ) {
        throw new ConflictException('已消课记录不能修改出勤状态');
      }
      if (
        dto.status === AttendanceStatus.PENDING ||
        dto.status === AttendanceStatus.MADE_UP ||
        dto.status === AttendanceStatus.MAKEUP_REQUIRED
      ) {
        throw new BadRequestException('请使用出勤、缺勤或请假状态登记');
      }
      if (
        (dto.status === AttendanceStatus.LEAVE ||
          dto.status === AttendanceStatus.CANCELLED) &&
        !dto.reason?.trim()
      ) {
        throw new BadRequestException('请假或取消课次必须填写原因');
      }

      let nextStatus =
        dto.status === AttendanceStatus.LEAVE
          ? AttendanceStatus.MAKEUP_REQUIRED
          : dto.status;
      const terminalStatuses = new Set<AttendanceStatus>([
        AttendanceStatus.ATTENDED,
        AttendanceStatus.ABSENT,
        AttendanceStatus.CANCELLED,
        AttendanceStatus.MAKEUP_REQUIRED,
        AttendanceStatus.MADE_UP,
      ]);
      if (
        terminalStatuses.has(attendance.status) &&
        attendance.status !== nextStatus
      ) {
        throw new ConflictException('当前出勤状态已锁定，请提交更正申请');
      }
      if (attendance.status === nextStatus)
        return trainingAttendanceCommandResponse(attendance);

      const feedback = dto.feedback?.trim() || attendance.feedback || undefined;
      const now = new Date();
      const timeWindowPolicy = await assertOperationTimeWindow(tx, {
        actor,
        parameterKey: TRAINING_ATTENDANCE_WINDOW_PARAMETER,
        defaults: { earlyMinutes: 30, lateMinutes: 120 },
        scheduledStartsAt: attendance.session.startsAt,
        scheduledEndsAt: attendance.session.endsAt,
        action: 'TRAINING_ATTENDANCE_MARKED',
        objectType: 'TrainingAttendance',
        objectId: attendance.id,
        overrideReason: dto.reason,
        observedAt: now,
      });
      if (
        [
          AttendanceStatus.LEAVE,
          AttendanceStatus.CANCELLED,
          AttendanceStatus.ABSENT,
        ].includes(dto.status as never)
      ) {
        const original = await tx.trainingAttendance.findFirst({
          where: { makeupTargetId: attendance.id },
        });
        if (original) {
          await tx.trainingAttendance.update({
            where: { id: original.id },
            data: {
              makeupTargetId: null,
              status: AttendanceStatus.MAKEUP_REQUIRED,
            },
          });
          // This is a replacement slot, not a second missed entitlement.
          nextStatus = AttendanceStatus.CANCELLED;
          await tx.auditLog.create({
            data: {
              actorId: actor.sub,
              actorRole: actor.roles[0],
              action: 'TRAINING_MAKEUP_RELEASED',
              objectType: 'TrainingAttendance',
              objectId: original.id,
              reason: dto.reason?.trim() || '补课未到场，原课恢复待安排',
              oldValue: { makeupTargetId: attendance.id },
              newValue: {
                makeupTargetId: null,
                status: AttendanceStatus.MAKEUP_REQUIRED,
              },
            },
          });
        }
      }
      const updated = await tx.trainingAttendance.update({
        where: { id: attendance.id },
        data: {
          status: nextStatus,
          feedback,
          // Attendance evidence and the financial consume proposal are two
          // distinct commands.  The attendance actor remains in AuditLog;
          // operatorId is reserved exclusively for the later proposal's
          // maker so an arrival scan cannot masquerade as approval input.
          operatorId: attendance.operatorId,
          checkedInAt:
            nextStatus === AttendanceStatus.ATTENDED
              ? (attendance.checkedInAt ?? now)
              : attendance.checkedInAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_ATTENDANCE_MARKED',
          objectType: 'TrainingAttendance',
          objectId: attendance.id,
          reason: dto.reason?.trim() || '登记培训出勤',
          oldValue: { status: attendance.status } as never,
          newValue: {
            status: nextStatus,
            requestedStatus: dto.status,
            checkedInAt:
              nextStatus === AttendanceStatus.ATTENDED
                ? now.toISOString()
                : null,
            timeWindowPolicy,
          } as never,
        },
      });
      return trainingAttendanceCommandResponse(updated);
    });
  }

  /**
   * Assign an approved leave to a later session.  Assignment changes only the
   * operational attendance state; the target session is still checked in and
   * consumed through the normal maker/checker flow, so it cannot create a
   * second charge by itself.
   */
  async scheduleMakeup(
    sessionId: string,
    dto: MakeupAttendanceDto,
    actor: AuthUser,
  ) {
    if (
      !actor.roles.some((role) =>
        (
          [AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]
        ).includes(role as never),
      )
    ) {
      throw new ForbiddenException('当前账号无权安排补课');
    }

    return trainingTransaction(this.prisma, async (tx) => {
      const original = await tx.trainingAttendance.findUnique({
        where: {
          sessionId_enrollmentId: {
            sessionId,
            enrollmentId: dto.enrollmentId,
          },
        },
        include: {
          session: { include: { class: true } },
          makeupTarget: { select: { sessionId: true } },
        },
      });
      if (!original) throw new NotFoundException('原课次签到记录不存在');
      this.assertAttendanceOperator(original.session.class, actor);

      if (original.status === AttendanceStatus.MADE_UP) {
        if (original.makeupTarget?.sessionId !== dto.makeupSessionId)
          throw new ConflictException('该请假已安排其他补课课次，请刷新核对');
        return trainingMakeupCommandResponse(
          original,
          original.makeupTarget.sessionId,
        );
      }
      if (
        original.status !== AttendanceStatus.MAKEUP_REQUIRED &&
        original.status !== AttendanceStatus.LEAVE
      ) {
        throw new ConflictException('只有已批准请假的课次可以安排补课');
      }
      if (dto.makeupSessionId === sessionId) {
        throw new BadRequestException('补课课次必须晚于原课次');
      }

      const makeupSession = await tx.trainingSession.findUnique({
        where: { id: dto.makeupSessionId },
        include: {
          class: true,
          attendances: { where: { enrollmentId: dto.enrollmentId } },
        },
      });
      if (!makeupSession) throw new NotFoundException('补课课次不存在');
      if (makeupSession.classId !== original.session.classId) {
        throw new BadRequestException('补课必须安排在同一培训班');
      }
      if (makeupSession.startsAt <= original.session.startsAt) {
        throw new BadRequestException('补课课次必须晚于原课次');
      }
      if (
        makeupSession.status === TrainingSessionStatus.CANCELLED ||
        makeupSession.status === TrainingSessionStatus.COMPLETED
      ) {
        throw new ConflictException('已取消或已结束的课次不能安排补课');
      }
      const target = makeupSession.attendances[0];
      if (!target) throw new ConflictException('补课课次没有该学员的签到名额');
      if (
        target.status !== AttendanceStatus.PENDING &&
        target.status !== AttendanceStatus.LEAVE
      ) {
        throw new ConflictException('补课课次的学员名额已被处理');
      }

      if (
        await tx.trainingAttendance.findFirst({
          where: { makeupTargetId: target.id },
        })
      )
        throw new ConflictException('该学员的补课名额已被其他请假占用');
      if (
        await tx.trainingAttendance.findFirst({
          where: { makeupTargetId: original.id },
        })
      )
        throw new ConflictException('请先处理该课次已有的补课安排');
      const updated = await tx.trainingAttendance.update({
        where: { id: original.id, status: original.status },
        data: {
          status: AttendanceStatus.MADE_UP,
          makeupTargetId: target.id,
          feedback: [original.feedback, `补课安排:${makeupSession.id}`]
            .filter(Boolean)
            .join('；'),
          operatorId: original.operatorId ?? actor.sub,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_MAKEUP_SCHEDULED',
          objectType: 'TrainingAttendance',
          objectId: original.id,
          reason: dto.reason?.trim() || '安排培训补课',
          oldValue: { status: original.status } as never,
          newValue: {
            status: AttendanceStatus.MADE_UP,
            makeupSessionId: makeupSession.id,
            targetAttendanceId: target.id,
          } as never,
        },
      });
      return trainingMakeupCommandResponse(updated, makeupSession.id);
    });
  }

  private assertAttendanceOperator(
    trainingClass: { coachId: string | null; assistantId: string | null },
    actor: AuthUser,
  ): void {
    if (isTrainingApprover(actor) || actor.roles.includes(AppRole.FRONT_DESK))
      return;
    if (
      actor.roles.includes(AppRole.COACH) &&
      (trainingClass.coachId === actor.sub ||
        trainingClass.assistantId === actor.sub)
    ) {
      return;
    }
    throw new ForbiddenException('只能操作自己负责班级的培训出勤');
  }
}
