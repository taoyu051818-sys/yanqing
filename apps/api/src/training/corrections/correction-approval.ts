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
  AttendanceStatus,
  BusinessType,
  OrderStatus,
  TrainingAudience,
  TrainingConsumeCorrectionStatus,
  TrainingEnrollmentStatus,
  TrainingRecognitionType,
  TrainingSessionStatus,
} from '../../generated/prisma/client.js';
import type { DecideTrainingConsumeCorrectionDto } from '../training.dto.js';
import { transitionOrder } from '../../orders/order-transition.js';
import {
  assertTrainingLedgerOpen,
  assertSettlementPeriodUnlocked,
  trainingTransaction,
} from '../settlements/training-settlement-ledger.js';
import { assertTrainingApprover } from '../training-access.js';
import {
  correctionCommandResponse,
  assertCorrectionDecisionReplay,
} from './correction-policy.js';

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
              select: { id: true, status: true, startsAt: true, endsAt: true },
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
    // The restored attendance must be able to follow the normal propose/confirm
    // workflow. Reopen only through this approved, ledger-unlocked correction.
    if (attendance.session.status === TrainingSessionStatus.COMPLETED) {
      const reopened = await tx.trainingSession.updateMany({
        where: {
          id: attendance.session.id,
          status: TrainingSessionStatus.COMPLETED,
        },
        data: { status: TrainingSessionStatus.SCHEDULED },
      });
      if (reopened.count !== 1)
        throw new ConflictException('课次状态已变化，请刷新后重试');
      await tx.auditLog.create({
        data: {
          actorId: actor.sub,
          actorRole: actor.roles[0],
          action: 'TRAINING_SESSION_REOPENED',
          objectType: 'TrainingSession',
          objectId: attendance.session.id,
          reason: reviewReason,
          oldValue: { status: TrainingSessionStatus.COMPLETED },
          newValue: {
            status: TrainingSessionStatus.SCHEDULED,
            correctionId: correction.id,
            attendanceId: attendance.id,
          },
          requestId: dto.idempotencyKey,
        },
      });
    }
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
