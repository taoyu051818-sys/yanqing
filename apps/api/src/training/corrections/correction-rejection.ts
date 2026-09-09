import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { TrainingConsumeCorrectionStatus } from '../../generated/prisma/client.js';
import type { DecideTrainingConsumeCorrectionDto } from '../training.dto.js';
import { assertTrainingApprover } from '../training-access.js';
import {
  correctionCommandResponse,
  assertCorrectionDecisionReplay,
} from './correction-policy.js';

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
