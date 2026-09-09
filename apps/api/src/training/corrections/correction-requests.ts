import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  Prisma,
  TrainingConsumeCorrectionStatus,
  TrainingRecognitionType,
} from '../../generated/prisma/client.js';
import type { CreateTrainingConsumeCorrectionDto } from '../training.dto.js';
import { hasAnyRole } from '../training-access.js';
import {
  TRAINING_CORRECTION_MAKER_ROLES,
  isCoachOnly,
  correctionCommandResponse,
  assertCorrectionRequestReplay,
} from './correction-policy.js';

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
