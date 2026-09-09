import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  AccountTxnKind,
  AccountType,
  AppRole,
  AttendanceStatus,
  BusinessType,
  OrderStatus,
  Prisma,
  TrainingAudience,
  TrainingConsumeCorrectionStatus,
  TrainingEnrollmentStatus,
  TrainingRecognitionType,
} from '../../generated/prisma/client.js';
import type {
  CreateTrainingConsumeCorrectionDto,
  DecideTrainingConsumeCorrectionDto,
} from '../training.dto.js';
import { transitionOrder } from '../../orders/order-transition.js';
import {
  assertTrainingLedgerOpen,
  assertSettlementPeriodUnlocked,
  trainingTransaction,
} from '../settlements/training-settlement-ledger.js';
import { assertTrainingApprover, hasAnyRole } from '../training-access.js';

const TRAINING_CORRECTION_MAKER_ROLES: readonly AppRole[] = [
  AppRole.COACH,
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export async function listConsumeCorrections(
  prisma: PrismaService,
  actor: AuthUser,
) {
  const allowed = [
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ] as const;
  if (!hasAnyRole(actor, allowed)) {
    throw new ForbiddenException('当前角色无权查看消课冲正申请');
  }
  const coachScope = isCoachOnly(actor);
  const corrections = await prisma.trainingConsumeCorrection.findMany({
    where: coachScope
      ? {
          attendance: {
            session: {
              class: {
                OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
              },
            },
          },
        }
      : undefined,
    include: {
      recognition: {
        select: {
          id: true,
          type: true,
          sequence: true,
          effectiveRevenueCents: true,
          createdAt: true,
        },
      },
      reversalRecognition: {
        select: {
          id: true,
          type: true,
          sequence: true,
          effectiveRevenueCents: true,
          createdAt: true,
        },
      },
      attendance: {
        select: {
          id: true,
          status: true,
          consumedSessions: true,
          confirmedRevenueCents: true,
          growthPointsAwarded: true,
          feedback: true,
          session: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              status: true,
              class: { select: { id: true, name: true } },
            },
          },
          enrollment: {
            select: {
              id: true,
              status: true,
              student: { select: { id: true, displayName: true } },
              buyer: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      requestedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
  return corrections.map((correction) => ({
    id: correction.id,
    status: correction.status,
    reason: correction.reason,
    reviewReason: correction.reviewReason,
    requestedAt: correction.requestedAt,
    reviewedAt: correction.reviewedAt,
    recognitionId: correction.recognitionId,
    recognition: {
      id: correction.recognition.id,
      type: correction.recognition.type,
      sequence: correction.recognition.sequence,
      effectiveRevenueCents: correction.recognition.effectiveRevenueCents,
      createdAt: correction.recognition.createdAt,
    },
    reversalRecognition: correction.reversalRecognition
      ? {
          id: correction.reversalRecognition.id,
          type: correction.reversalRecognition.type,
          sequence: correction.reversalRecognition.sequence,
          effectiveRevenueCents:
            correction.reversalRecognition.effectiveRevenueCents,
          createdAt: correction.reversalRecognition.createdAt,
        }
      : null,
    attendance: {
      id: correction.attendance.id,
      status: correction.attendance.status,
      consumedSessions: correction.attendance.consumedSessions,
      confirmedRevenueCents: correction.attendance.confirmedRevenueCents,
      growthPointsAwarded: correction.attendance.growthPointsAwarded,
      feedback: correction.attendance.feedback,
      session: correction.attendance.session,
      enrollment: correction.attendance.enrollment,
    },
    requestedBy: correction.requestedBy,
    reviewedBy: correction.reviewedBy,
  }));
}

export async function requestConsumeCorrection(
  prisma: PrismaService,
  dto: CreateTrainingConsumeCorrectionDto,
  actor: AuthUser,
) {
  if (!hasAnyRole(actor, TRAINING_CORRECTION_MAKER_ROLES)) {
    throw new ForbiddenException('仅教练、前台或管理员可申请消课冲正');
  }
  const reason = dto.reason.trim();
  if (!reason) throw new BadRequestException('冲正申请原因不能为空');
  const existing = await prisma.trainingConsumeCorrection.findUnique({
    where: { requestIdempotencyKey: dto.idempotencyKey },
  });
  if (existing) {
    return correctionCommandResponse(
      assertCorrectionRequestReplay(existing, dto, actor, reason),
    );
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        const recognition = await tx.trainingRevenueRecognition.findUnique({
          where: { id: dto.recognitionId },
          include: {
            reversedBy: true,
            attendance: {
              include: { session: { include: { class: true } } },
            },
          },
        });
        if (
          !recognition ||
          recognition.type !== TrainingRecognitionType.CONSUME
        ) {
          throw new NotFoundException('可冲正的消课确认流水不存在');
        }
        if (recognition.reversedBy)
          throw new ConflictException('该消课流水已冲正');
        if (isCoachOnly(actor)) {
          const trainingClass = recognition.attendance.session.class;
          if (
            trainingClass.coachId !== actor.sub &&
            trainingClass.assistantId !== actor.sub
          ) {
            throw new ForbiddenException('教练只能申请自己负责班级的消课冲正');
          }
        }
        const pending = await tx.trainingConsumeCorrection.findFirst({
          where: {
            recognitionId: recognition.id,
            status: {
              in: [
                TrainingConsumeCorrectionStatus.REQUESTED,
                TrainingConsumeCorrectionStatus.APPROVED,
              ],
            },
          },
        });
        if (pending)
          throw new ConflictException('该消课流水已有待处理或已批准的冲正申请');
        const correction = await tx.trainingConsumeCorrection.create({
          data: {
            recognitionId: recognition.id,
            attendanceId: recognition.attendanceId,
            reason,
            requestedById: actor.sub,
            requestIdempotencyKey: dto.idempotencyKey,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'TRAINING_CONSUME_CORRECTION_REQUESTED',
            objectType: 'TrainingConsumeCorrection',
            objectId: correction.id,
            reason,
            oldValue: { status: null } as never,
            newValue: {
              status: TrainingConsumeCorrectionStatus.REQUESTED,
              recognitionId: recognition.id,
            } as never,
            requestId: dto.idempotencyKey,
          },
        });
        return correctionCommandResponse(correction);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const duplicate = await prisma.trainingConsumeCorrection.findUnique({
        where: { requestIdempotencyKey: dto.idempotencyKey },
      });
      if (duplicate)
        return correctionCommandResponse(
          assertCorrectionRequestReplay(duplicate, dto, actor, reason),
        );
      const active = await prisma.trainingConsumeCorrection.findFirst({
        where: {
          recognitionId: dto.recognitionId,
          status: {
            in: [
              TrainingConsumeCorrectionStatus.REQUESTED,
              TrainingConsumeCorrectionStatus.APPROVED,
            ],
          },
        },
      });
      if (active)
        throw new ConflictException('该消课流水已有待处理或已批准的冲正申请');
    }
    throw error;
  }
}

export async function approveConsumeCorrection(
  prisma: PrismaService,
  id: string,
  dto: DecideTrainingConsumeCorrectionDto,
  actor: AuthUser,
) {
  assertTrainingApprover(actor);
  const reviewReason = dto.reason?.trim() || '复核同意消课冲正';
  const decisionReplay = await prisma.trainingConsumeCorrection.findUnique({
    where: { decisionIdempotencyKey: dto.idempotencyKey },
    include: { recognition: true, reversalRecognition: true },
  });
  if (decisionReplay) {
    return correctionCommandResponse(
      assertCorrectionDecisionReplay(
        decisionReplay,
        id,
        TrainingConsumeCorrectionStatus.APPROVED,
        actor,
        reviewReason,
      ),
    );
  }
  return trainingTransaction(prisma, async (tx) => {
    const correction = await tx.trainingConsumeCorrection.findUnique({
      where: { id },
      include: {
        recognition: { include: { reversedBy: true } },
        attendance: {
          include: {
            session: {
              select: { startsAt: true, endsAt: true },
            },
            enrollment: {
              include: {
                product: true,
                order: {
                  select: {
                    id: true,
                    status: true,
                    completedAt: true,
                  },
                },
              },
            },
          },
        },
        reversalRecognition: true,
      },
    });
    if (!correction) throw new NotFoundException('消课冲正申请不存在');
    if (correction.status === TrainingConsumeCorrectionStatus.APPROVED) {
      if (correction.decisionIdempotencyKey !== dto.idempotencyKey) {
        throw new ConflictException('冲正申请已使用其他幂等键批准');
      }
      return correctionCommandResponse(
        assertCorrectionDecisionReplay(
          correction,
          id,
          TrainingConsumeCorrectionStatus.APPROVED,
          actor,
          reviewReason,
        ),
      );
    }
    if (correction.status !== TrainingConsumeCorrectionStatus.REQUESTED) {
      throw new ConflictException('只有待复核申请可以批准');
    }
    if (correction.requestedById === actor.sub) {
      throw new ForbiddenException('消课冲正申请人与复核人不能为同一账号');
    }
    if (
      correction.recognition.type !== TrainingRecognitionType.CONSUME ||
      correction.recognition.reversedBy
    ) {
      throw new ConflictException('目标消课流水已冲正或不可冲正');
    }
    if (correction.recognition.settlementId) {
      throw new ConflictException('目标消课流水已进入结算单，不可直接冲正');
    }
    const attendance = correction.attendance;
    const enrollment = attendance.enrollment;
    if (
      attendance.consumedSessions !== 1 ||
      attendance.confirmedRevenueCents !==
        correction.recognition.effectiveRevenueCents ||
      enrollment.consumedSessions < 1 ||
      enrollment.confirmedRevenueCents <
        correction.recognition.effectiveRevenueCents
    ) {
      throw new ConflictException('当前消课余额与待冲正流水不一致');
    }
    await assertSettlementPeriodUnlocked(
      tx,
      attendance.session.startsAt,
      attendance.session.endsAt,
      '批准消课冲正',
    );
    const sequence = await tx.trainingRevenueRecognition.aggregate({
      where: { attendanceId: attendance.id },
      _max: { sequence: true },
    });
    const reversalAt = new Date();
    await assertTrainingLedgerOpen(tx, reversalAt);
    const reversal = await tx.trainingRevenueRecognition.create({
      data: {
        attendanceId: attendance.id,
        enrollmentId: enrollment.id,
        type: TrainingRecognitionType.REVERSAL,
        sequence: (sequence._max.sequence ?? 0) + 1,
        reversalOfId: correction.recognition.id,
        effectiveRevenueCents: -correction.recognition.effectiveRevenueCents,
        contractRateBps: correction.recognition.contractRateBps,
        venueContributionCents: -correction.recognition.venueContributionCents,
        venueFeeCents: 0,
        trainingPayableVenueCents: 0,
        idempotencyKey: `TRAINING_REVERSAL:${dto.idempotencyKey}`,
        createdAt: reversalAt,
      },
    });
    const nextEnrollmentStatus =
      enrollment.status === TrainingEnrollmentStatus.COMPLETED
        ? enrollment.refundedCents > 0
          ? TrainingEnrollmentStatus.PARTIALLY_REFUNDED
          : TrainingEnrollmentStatus.ACTIVE
        : enrollment.status;
    const enrollmentChanged = await tx.trainingEnrollment.updateMany({
      where: {
        id: enrollment.id,
        consumedSessions: enrollment.consumedSessions,
        confirmedRevenueCents: enrollment.confirmedRevenueCents,
        prepaidBalanceCents: enrollment.prepaidBalanceCents,
      },
      data: {
        consumedSessions: { decrement: 1 },
        confirmedRevenueCents: {
          decrement: correction.recognition.effectiveRevenueCents,
        },
        prepaidBalanceCents: {
          increment: correction.recognition.effectiveRevenueCents,
        },
        status: nextEnrollmentStatus,
      },
    });
    if (enrollmentChanged.count !== 1)
      throw new ConflictException('报名余额已变化，请重试');
    const attendanceChanged = await tx.trainingAttendance.updateMany({
      where: {
        id: attendance.id,
        consumedSessions: attendance.consumedSessions,
        confirmedRevenueCents: attendance.confirmedRevenueCents,
      },
      data: {
        status: AttendanceStatus.ATTENDED,
        consumedSessions: 0,
        confirmedRevenueCents: 0,
        growthPointsAwarded: 0,
        operatorId: null,
        consumedAt: null,
      },
    });
    if (attendanceChanged.count !== 1)
      throw new ConflictException('考勤消课状态已变化，请重试');
    if (
      enrollment.product.audience === TrainingAudience.YOUTH &&
      attendance.growthPointsAwarded > 0
    ) {
      const growthAccount = await tx.account.findUnique({
        where: {
          userId_type: {
            userId: enrollment.buyerId,
            type: AccountType.GROWTH_POINTS,
          },
        },
      });
      if (
        !growthAccount ||
        growthAccount.balance < attendance.growthPointsAwarded
      ) {
        throw new BadRequestException('成长积分余额不足，无法冲正');
      }
      const growthChanged = await tx.account.updateMany({
        where: {
          id: growthAccount.id,
          version: growthAccount.version,
          balance: { gte: attendance.growthPointsAwarded },
        },
        data: {
          balance: { decrement: attendance.growthPointsAwarded },
          version: { increment: 1 },
        },
      });
      if (growthChanged.count !== 1)
        throw new ConflictException('成长积分账户已变化，请重试');
      await tx.accountTransaction.create({
        data: {
          accountId: growthAccount.id,
          kind: AccountTxnKind.DEBIT,
          amount: -attendance.growthPointsAwarded,
          balanceBefore: growthAccount.balance,
          balanceAfter: growthAccount.balance - attendance.growthPointsAwarded,
          reasonCode: 'TRAINING_GROWTH_REVERSAL',
          reason: correction.reason,
          operatorId: actor.sub,
          idempotencyKey: `TRAINING_GROWTH_REVERSAL:${correction.id}`,
          metadata: {
            correctionId: correction.id,
            recognitionId: correction.recognition.id,
          },
        },
      });
    }
    if (
      enrollment.status === TrainingEnrollmentStatus.COMPLETED &&
      enrollment.order?.completedAt
    ) {
      const order = enrollment.order;
      const previousCompletedAt = order.completedAt;
      if (!previousCompletedAt) {
        throw new ConflictException('培训订单缺少原履约完成时间');
      }
      if (
        order.status !== OrderStatus.COMPLETED &&
        order.status !== OrderStatus.PARTIALLY_REFUNDED &&
        order.status !== OrderStatus.REFUND_PENDING
      ) {
        throw new ConflictException(
          `培训订单状态 ${order.status} 不可因消课冲正重新打开`,
        );
      }
      const nextOrderStatus =
        order.status === OrderStatus.COMPLETED
          ? OrderStatus.PAID
          : order.status;
      const reopened = await transitionOrder(tx, 'REOPEN_TRAINING', {
        where: {
          id: order.id,
          status: order.status,
          completedAt: previousCompletedAt,
        },
        data: {
          status: nextOrderStatus,
          completedAt: null,
        },
      });
      if (reopened.count !== 1) {
        const latest = await tx.order.findUnique({
          where: { id: order.id },
          select: { id: true, status: true, completedAt: true },
        });
        if (!latest || latest.completedAt) {
          throw new ConflictException('培训订单履约状态已变化，请重试');
        }
      } else {
        await tx.auditLog.create({
          data: {
            actorId: actor.sub,
            actorRole: actor.roles[0],
            action: 'ORDER_FULFILLMENT_REOPENED',
            objectType: 'Order',
            objectId: order.id,
            reason: reviewReason,
            oldValue: {
              status: order.status,
              completedAt: previousCompletedAt.toISOString(),
            } as never,
            newValue: {
              status: nextOrderStatus,
              completedAt: null,
              businessType: BusinessType.TRAINING,
              trainingEnrollmentId: enrollment.id,
              correctionId: correction.id,
            } as never,
            requestId: dto.idempotencyKey,
          },
        });
      }
    }
    const approved = await tx.trainingConsumeCorrection.update({
      where: { id },
      data: {
        status: TrainingConsumeCorrectionStatus.APPROVED,
        reviewReason,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
        reversalRecognitionId: reversal.id,
        decisionIdempotencyKey: dto.idempotencyKey,
      },
      include: { recognition: true, reversalRecognition: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'TRAINING_CONSUME_CORRECTION_APPROVED',
        objectType: 'TrainingConsumeCorrection',
        objectId: id,
        reason: reviewReason,
        oldValue: {
          status: correction.status,
          attendance: {
            status: attendance.status,
            checkedInAt: attendance.checkedInAt?.toISOString(),
            consumedSessions: attendance.consumedSessions,
            confirmedRevenueCents: attendance.confirmedRevenueCents,
            consumedAt: attendance.consumedAt?.toISOString(),
          },
        } as never,
        newValue: {
          status: TrainingConsumeCorrectionStatus.APPROVED,
          reversalRecognitionId: reversal.id,
          effectiveRevenueCents: reversal.effectiveRevenueCents,
          venueFeeCents: 0,
          trainingPayableVenueCents: 0,
          attendance: {
            status: AttendanceStatus.ATTENDED,
            checkedInAt: attendance.checkedInAt?.toISOString(),
            consumedSessions: 0,
            confirmedRevenueCents: 0,
            consumedAt: null,
          },
        } as never,
        requestId: dto.idempotencyKey,
      },
    });
    return correctionCommandResponse(approved);
  });
}

export async function rejectConsumeCorrection(
  prisma: PrismaService,
  id: string,
  dto: DecideTrainingConsumeCorrectionDto,
  actor: AuthUser,
) {
  assertTrainingApprover(actor);
  const reviewReason = dto.reason?.trim();
  if (!reviewReason) throw new BadRequestException('驳回冲正申请必须填写原因');
  const decisionReplay = await prisma.trainingConsumeCorrection.findUnique({
    where: { decisionIdempotencyKey: dto.idempotencyKey },
  });
  if (decisionReplay) {
    return correctionCommandResponse(
      assertCorrectionDecisionReplay(
        decisionReplay,
        id,
        TrainingConsumeCorrectionStatus.REJECTED,
        actor,
        reviewReason,
      ),
    );
  }
  return prisma.$transaction(async (tx) => {
    const correction = await tx.trainingConsumeCorrection.findUnique({
      where: { id },
    });
    if (!correction) throw new NotFoundException('消课冲正申请不存在');
    if (correction.status === TrainingConsumeCorrectionStatus.REJECTED) {
      if (correction.decisionIdempotencyKey !== dto.idempotencyKey) {
        throw new ConflictException('冲正申请已使用其他幂等键驳回');
      }
      return correctionCommandResponse(
        assertCorrectionDecisionReplay(
          correction,
          id,
          TrainingConsumeCorrectionStatus.REJECTED,
          actor,
          reviewReason,
        ),
      );
    }
    if (correction.status !== TrainingConsumeCorrectionStatus.REQUESTED) {
      throw new ConflictException('只有待复核申请可以驳回');
    }
    if (correction.requestedById === actor.sub) {
      throw new ForbiddenException('消课冲正申请人与复核人不能为同一账号');
    }
    const rejected = await tx.trainingConsumeCorrection.update({
      where: { id },
      data: {
        status: TrainingConsumeCorrectionStatus.REJECTED,
        reviewReason,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
        decisionIdempotencyKey: dto.idempotencyKey,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.sub,
        actorRole: actor.roles[0],
        action: 'TRAINING_CONSUME_CORRECTION_REJECTED',
        objectType: 'TrainingConsumeCorrection',
        objectId: id,
        reason: reviewReason,
        oldValue: { status: correction.status } as never,
        newValue: {
          status: TrainingConsumeCorrectionStatus.REJECTED,
        } as never,
        requestId: dto.idempotencyKey,
      },
    });
    return correctionCommandResponse(rejected);
  });
}

function isCoachOnly(actor: AuthUser): boolean {
  return (
    actor.roles.includes(AppRole.COACH) &&
    !actor.roles.some((role) =>
      (
        [
          AppRole.FRONT_DESK,
          AppRole.FINANCE,
          AppRole.ADMIN,
          AppRole.SUPER_ADMIN,
        ] as AppRole[]
      ).includes(role),
    )
  );
}

function correctionCommandResponse<
  T extends {
    id: string;
    status: TrainingConsumeCorrectionStatus;
    reason: string;
    reviewReason?: string | null;
    requestedAt: Date;
    reviewedAt?: Date | null;
  },
>(correction: T) {
  return {
    id: correction.id,
    status: correction.status,
    reason: correction.reason,
    reviewReason: correction.reviewReason ?? null,
    requestedAt: correction.requestedAt,
    reviewedAt: correction.reviewedAt ?? null,
  };
}

function assertCorrectionRequestReplay<
  T extends {
    recognitionId: string;
    reason: string;
    requestedById: string;
  },
>(
  existing: T,
  dto: CreateTrainingConsumeCorrectionDto,
  actor: AuthUser,
  reason: string,
): T {
  if (
    existing.requestedById !== actor.sub ||
    existing.recognitionId !== dto.recognitionId ||
    existing.reason !== reason
  ) {
    throw new ConflictException('冲正申请幂等键已用于其他操作人或命令');
  }
  return existing;
}

function assertCorrectionDecisionReplay<
  T extends {
    id: string;
    status: TrainingConsumeCorrectionStatus;
    reviewedById?: string | null;
    reviewReason?: string | null;
  },
>(
  existing: T,
  id: string,
  status: TrainingConsumeCorrectionStatus,
  actor: AuthUser,
  reason: string,
): T {
  if (
    existing.id !== id ||
    existing.status !== status ||
    existing.reviewedById !== actor.sub ||
    existing.reviewReason !== reason
  ) {
    throw new ConflictException(
      '冲正决策幂等键已用于其他申请或动作，或操作人/命令不一致',
    );
  }
  return existing;
}
