import {
  isTrainingApprover,
  assertTrainingApprover,
} from '../training-access.js';
import { assertSettlementPeriodUnlocked } from '../settlements/training-settlement-ledger.js';
import {
  Inject,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { trainingContractContributionCents } from '@yanqing/shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  AttendanceStatus,
  OrderStatus,
  Prisma,
  TrainingAudience,
  TrainingEnrollmentStatus,
  TrainingRecognitionType,
  TrainingSessionStatus,
} from '../../generated/prisma/client.js';
import type {
  ConfirmTrainingConsumeDto,
  ConsumeTrainingDto,
} from '../training.dto.js';
import { orderCreationCommandHash } from '../../orders/order-creation-idempotency.js';
import { completeOrderFulfillment } from '../../orders/order-fulfillment.js';
import {
  assertOperationTimeWindow,
  TRAINING_COMPLETION_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';
import { trainingConsumptionQuote } from '../training-contract.js';
import {
  assertTrainingLedgerOpen,
  trainingTransaction,
} from '../settlements/training-settlement-ledger.js';
import {
  trainingConsumeConfirmationResponse,
  trainingConsumeProposalResponse,
} from '../training-command-response.js';
import {
  findTrainingCommandReplay,
  assertTrainingCommandReplay,
} from '../shared/training-command-policy.js';
import {
  TRAINING_ATTENDING_STATUSES,
  activeConsumeRecognition,
} from '../shared/training-attendance-policy.js';

@Injectable()
export class TrainingConsumptionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Backwards-compatible command used by the first mini-app release.  A
   * coach now creates a pending recommendation; only an administrator can
   * post the recognition and decrement the prepaid balance.  Existing admin
   * callers can keep using this route and are treated as an explicit
   * confirmation.
   */
  async consume(sessionId: string, dto: ConsumeTrainingDto, actor: AuthUser) {
    if (isTrainingApprover(actor)) {
      return this.confirmConsume(sessionId, dto, actor, {
        auditAction: 'TRAINING_SESSION_CONSUMED',
      });
    }
    if (actor.roles.includes(AppRole.COACH)) {
      return this.proposeConsume(sessionId, dto, actor);
    }
    throw new ForbiddenException(
      '仅教练可提交消课建议，培训主管或管理员可确认入账',
    );
  }

  /**
   * Coach-side maker command.  It intentionally does not touch the
   * enrollment balance, revenue recognition, growth points, or attendance
   * status.  `operatorId` is used as the proposal marker because the current
   * schema has no separate approval-task table.
   */
  async proposeConsume(
    sessionId: string,
    dto: ConsumeTrainingDto,
    actor: AuthUser,
  ) {
    if (!actor.roles.includes(AppRole.COACH)) {
      throw new ForbiddenException('仅教练可提交消课建议');
    }

    const attendance = await this.prisma.$transaction(
      async (tx) => {
        const attendance = await tx.trainingAttendance.findUnique({
          where: {
            sessionId_enrollmentId: {
              sessionId,
              enrollmentId: dto.enrollmentId,
            },
          },
          include: {
            session: { include: { class: true } },
            enrollment: {
              include: {
                product: true,
                order: { select: { id: true, status: true } },
              },
            },
            revenueRecognitions: {
              include: { reversedBy: true },
              orderBy: { sequence: 'desc' },
            },
          },
        });
        if (!attendance) throw new NotFoundException('课次签到记录不存在');
        if (
          attendance.session.status === TrainingSessionStatus.COMPLETED ||
          attendance.session.status === TrainingSessionStatus.CANCELLED
        ) {
          throw new ConflictException('已结束或已取消的课次不能继续消课');
        }
        const classAssignmentPresent =
          Object.prototype.hasOwnProperty.call(
            attendance.session.class,
            'coachId',
          ) ||
          Object.prototype.hasOwnProperty.call(
            attendance.session.class,
            'assistantId',
          );
        if (
          classAssignmentPresent &&
          attendance.session.class.coachId !== actor.sub &&
          attendance.session.class.assistantId !== actor.sub
        ) {
          throw new ForbiddenException('教练只能提交自己负责班级的消课建议');
        }
        if (
          activeConsumeRecognition(attendance.revenueRecognitions) ||
          attendance.consumedSessions > 0
        ) {
          throw new ConflictException('该课次已经消课，禁止重复确认');
        }
        if (attendance.status !== AttendanceStatus.ATTENDED) {
          throw new ConflictException('学员完成到场登记后才能提交消课建议');
        }
        const enrollment = attendance.enrollment;
        if (!TRAINING_ATTENDING_STATUSES.includes(enrollment.status)) {
          throw new ConflictException('报名记录不是在读状态');
        }
        if (
          enrollment.consumedSessions >= enrollment.totalSessions ||
          enrollment.prepaidBalanceCents <= 0
        ) {
          throw new ConflictException('可用课时或预收余额不足');
        }

        // Mobile clients may retry after a timeout.  Returning the existing
        // recommendation is safe because no financial mutation has happened.
        if (attendance.operatorId) {
          if (attendance.operatorId !== actor.sub) {
            throw new ConflictException('该课次已有其他教练提交消课建议');
          }
          return attendance;
        }
        if (enrollment.order?.status === OrderStatus.REFUND_PENDING) {
          throw new ConflictException(
            '培训订单正在等待退款审批，请先处理退款再提交消课建议',
          );
        }

        const feedback = dto.feedback?.trim() || undefined;
        const updated = await tx.trainingAttendance.update({
          where: { id: attendance.id },
          data: {
            // Keep PENDING until the checker confirms the financial posting.
            operatorId: actor.sub,
            feedback,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_CONSUME_PROPOSED',
            objectType: 'TrainingAttendance',
            objectId: attendance.id,
            reason: feedback || '教练提交消课建议',
            oldValue: {
              workflowStatus: 'UNSUBMITTED',
              proposedById: null,
              feedback: attendance.feedback,
            } as never,
            newValue: {
              workflowStatus: 'PENDING_CONFIRMATION',
              requestedAttendanceStatus: dto.attendanceStatus ?? 'PRESENT',
              feedback,
            } as never,
          },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return trainingConsumeProposalResponse(attendance);
  }

  /**
   * Checker command.  It is intentionally separate from `proposeConsume` so
   * a coach token can never reach the ledger mutation.  The optional audit
   * action is used only by the legacy `consume` route to preserve its old
   * audit label for administrator callers.
   */
  async confirmConsume(
    sessionId: string,
    dto: ConfirmTrainingConsumeDto | ConsumeTrainingDto,
    actor: AuthUser,
    options: { auditAction?: string } = {},
  ) {
    assertTrainingApprover(actor);
    const auditAction = options.auditAction ?? 'TRAINING_CONSUME_CONFIRMED';
    const explicitReason =
      'reason' in dto ? dto.reason?.trim() || undefined : undefined;
    const reason = explicitReason || '培训主管确认消课入账';
    const requestedIdempotencyKey =
      'idempotencyKey' in dto ? dto.idempotencyKey?.trim() : undefined;
    const commandHash = orderCreationCommandHash({
      kind: auditAction,
      sessionId,
      enrollmentId: dto.enrollmentId,
      feedback: dto.feedback?.trim() || null,
      reason,
    });

    const recognition = await trainingTransaction(this.prisma, async (tx) => {
      const attendance = await tx.trainingAttendance.findUnique({
        where: {
          sessionId_enrollmentId: {
            sessionId,
            enrollmentId: dto.enrollmentId,
          },
        },
        include: {
          session: { include: { class: true } },
          enrollment: {
            include: {
              product: true,
              order: { select: { id: true, status: true } },
            },
          },
          revenueRecognitions: {
            include: { reversedBy: true },
            orderBy: { sequence: 'desc' },
          },
        },
      });
      if (!attendance) throw new NotFoundException('课次签到记录不存在');
      const activeRecognition = activeConsumeRecognition(
        attendance.revenueRecognitions,
      );
      const replay = await findTrainingCommandReplay(
        tx,
        requestedIdempotencyKey,
      );
      if (replay) {
        assertTrainingCommandReplay(replay, {
          actor,
          action: auditAction,
          objectType: 'TrainingAttendance',
          objectId: attendance.id,
          commandHash,
        });
        if (!activeRecognition) {
          throw new ConflictException('消课幂等审计与确认流水不一致');
        }
        return activeRecognition;
      }
      if (activeRecognition) {
        if (
          !requestedIdempotencyKey ||
          requestedIdempotencyKey === activeRecognition?.idempotencyKey
        )
          return activeRecognition;
        throw new ConflictException('该课次已经消课，禁止重复确认');
      }
      if (
        attendance.session.status === TrainingSessionStatus.COMPLETED ||
        attendance.session.status === TrainingSessionStatus.CANCELLED
      ) {
        throw new ConflictException('已结束或已取消的课次不能继续消课');
      }
      if (attendance.consumedSessions > 0) {
        throw new ConflictException('考勤消课状态与确认流水不一致');
      }
      if (attendance.status !== AttendanceStatus.ATTENDED) {
        throw new ConflictException('当前考勤状态不能确认消课');
      }
      if (!attendance.operatorId) {
        throw new ConflictException(
          '必须先由教练提交消课建议，再由培训主管确认入账',
        );
      }
      if (attendance.operatorId === actor.sub) {
        throw new ForbiddenException('消课建议提交人与确认人不能是同一账号');
      }
      const enrollment = attendance.enrollment;
      if (enrollment.order?.status === OrderStatus.REFUND_PENDING) {
        throw new ConflictException(
          '培训订单正在等待退款审批，请先处理退款再确认消课',
        );
      }
      if (!TRAINING_ATTENDING_STATUSES.includes(enrollment.status)) {
        throw new ConflictException('报名记录不是在读状态');
      }
      if (
        enrollment.consumedSessions >= enrollment.totalSessions ||
        enrollment.prepaidBalanceCents <= 0
      ) {
        throw new ConflictException('可用课时或预收余额不足');
      }
      await assertSettlementPeriodUnlocked(
        tx,
        attendance.session.startsAt,
        attendance.session.endsAt,
        '确认消课入账',
      );
      const now = new Date();
      const timeWindowPolicy = await assertOperationTimeWindow(tx, {
        actor,
        parameterKey: TRAINING_COMPLETION_WINDOW_PARAMETER,
        defaults: { earlyMinutes: 0, lateMinutes: 240 },
        scheduledStartsAt: attendance.session.endsAt,
        scheduledEndsAt: attendance.session.endsAt,
        action: auditAction,
        objectType: 'TrainingAttendance',
        objectId: attendance.id,
        overrideReason: explicitReason,
        observedAt: now,
      });
      await assertTrainingLedgerOpen(tx, now);
      const consumptionQuote = trainingConsumptionQuote(enrollment);
      const confirmedRevenueCents = consumptionQuote.amountCents;
      const rateBps = await this.contractRateAt(
        tx,
        attendance.session.startsAt,
      );
      const venueContributionCents = trainingContractContributionCents(
        confirmedRevenueCents,
        rateBps,
      );
      const consumedSessions = enrollment.consumedSessions + 1;
      const remainingPrepaidCents =
        enrollment.prepaidBalanceCents - confirmedRevenueCents;
      const fullyConsumed =
        consumedSessions >= enrollment.totalSessions ||
        remainingPrepaidCents <= 0;
      const feedback = dto.feedback?.trim() || attendance.feedback || undefined;
      const proposedById = attendance.operatorId;
      const nextSequence =
        attendance.revenueRecognitions.reduce(
          (maximum, item) => Math.max(maximum, item.sequence),
          0,
        ) + 1;
      const recognitionIdempotencyKey =
        requestedIdempotencyKey || `CONSUME:${attendance.id}:${nextSequence}`;
      if (requestedIdempotencyKey) {
        const existingByKey = await tx.trainingRevenueRecognition.findUnique({
          where: { idempotencyKey: requestedIdempotencyKey },
          include: { reversedBy: true },
        });
        if (existingByKey) {
          if (
            existingByKey.attendanceId === attendance.id &&
            existingByKey.type === TrainingRecognitionType.CONSUME &&
            !existingByKey.reversedBy
          )
            return existingByKey;
          throw new ConflictException('消课幂等键已用于其他流水');
        }
      }
      const growthPointsAwarded =
        enrollment.product.audience === TrainingAudience.YOUTH ? 1 : 0;

      await tx.trainingAttendance.update({
        where: { id: attendance.id },
        data: {
          status: AttendanceStatus.ATTENDED,
          consumedSessions: 1,
          confirmedRevenueCents,
          growthPointsAwarded,
          feedback,
          // The checker is the final operator of record.  The maker is
          // retained in the confirmation audit's oldValue payload.
          operatorId: actor.sub,
          checkedInAt: now,
          consumedAt: now,
        },
      });
      await tx.trainingEnrollment.update({
        where: { id: enrollment.id },
        data: {
          consumedSessions,
          confirmedRevenueCents: { increment: confirmedRevenueCents },
          prepaidBalanceCents: { decrement: confirmedRevenueCents },
          status: fullyConsumed
            ? TrainingEnrollmentStatus.COMPLETED
            : enrollment.status,
        },
      });
      const recognition = await tx.trainingRevenueRecognition.create({
        data: {
          attendanceId: attendance.id,
          enrollmentId: enrollment.id,
          type: TrainingRecognitionType.CONSUME,
          sequence: nextSequence,
          effectiveRevenueCents: confirmedRevenueCents,
          contractRateBps: rateBps,
          venueContributionCents,
          venueFeeCents: 0,
          trainingPayableVenueCents: 0,
          idempotencyKey: recognitionIdempotencyKey,
          createdAt: now,
        },
      });
      if (enrollment.product.audience === TrainingAudience.YOUTH) {
        const growthAccount = await tx.account.upsert({
          where: {
            userId_type: {
              userId: enrollment.buyerId,
              type: AccountType.GROWTH_POINTS,
            },
          },
          update: {},
          create: {
            userId: enrollment.buyerId,
            type: AccountType.GROWTH_POINTS,
          },
        });
        const growthKey =
          nextSequence === 1
            ? `GROWTH:${attendance.id}`
            : `GROWTH:${attendance.id}:${nextSequence}`;
        const growthTxn = await tx.accountTransaction.findUnique({
          where: { idempotencyKey: growthKey },
        });
        if (!growthTxn) {
          const changedGrowth = await tx.account.updateMany({
            where: { id: growthAccount.id, version: growthAccount.version },
            data: { balance: { increment: 1 }, version: { increment: 1 } },
          });
          if (changedGrowth.count !== 1)
            throw new ConflictException('成长积分账户已变化，请重试');
          await tx.accountTransaction.create({
            data: {
              accountId: growthAccount.id,
              kind: AccountTxnKind.CREDIT,
              amount: 1,
              balanceBefore: growthAccount.balance,
              balanceAfter: growthAccount.balance + 1,
              reasonCode: 'TRAINING_GROWTH',
              reason: '完成青少年培训课次',
              operatorId: actor.sub,
              idempotencyKey: growthKey,
            },
          });
        }
      }
      if (fullyConsumed && enrollment.orderId) {
        await completeOrderFulfillment(tx, {
          orderId: enrollment.orderId,
          actor,
          objectType: 'TrainingEnrollment',
          objectId: enrollment.id,
          outcome: 'COMPLETED',
          completedAt: now,
          reason: '培训课包课时及预收余额已全部消耗',
          metadata: {
            sessionId,
            attendanceId: attendance.id,
            consumedSessions,
            totalSessions: enrollment.totalSessions,
            remainingPrepaidCents,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: auditAction,
          objectType: 'TrainingAttendance',
          objectId: attendance.id,
          reason,
          oldValue: {
            workflowStatus: proposedById
              ? 'PENDING_CONFIRMATION'
              : 'UNSUBMITTED',
            proposedById,
          } as never,
          newValue: {
            commandHash,
            workflowStatus: 'CONFIRMED',
            confirmedRevenueCents,
            consumptionQuote,
            contractRateBps: rateBps,
            venueContributionCents,
            venueFeeCents: 0,
            trainingPayableVenueCents: 0,
            timeWindowPolicy,
          } as never,
          requestId: requestedIdempotencyKey,
        },
      });
      return recognition;
    });
    return trainingConsumeConfirmationResponse(recognition);
  }

  private async contractRateAt(
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<number> {
    const parameter = await tx.systemParameter.findFirst({
      where: {
        key: 'training.contract_rate_bps',
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const rate = typeof parameter?.value === 'number' ? parameter.value : 2_000;
    if (rate !== 2_000) {
      throw new BadRequestException('培训合同流水比例必须为20%');
    }
    return rate;
  }
}
