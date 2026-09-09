import { ConflictException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  AppRole,
  TrainingConsumeCorrectionStatus,
} from '../../generated/prisma/client.js';
import type { CreateTrainingConsumeCorrectionDto } from '../training.dto.js';

export const TRAINING_CORRECTION_MAKER_ROLES: readonly AppRole[] = [
  AppRole.COACH,
  AppRole.FRONT_DESK,
  AppRole.ADMIN,
  AppRole.SUPER_ADMIN,
];

export function isCoachOnly(actor: AuthUser): boolean {
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

export function correctionCommandResponse<
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

export function assertCorrectionRequestReplay<
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

export function assertCorrectionDecisionReplay<
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
