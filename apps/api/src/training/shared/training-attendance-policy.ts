import {
  TrainingEnrollmentStatus,
  TrainingRecognitionType,
} from '../../generated/prisma/client.js';

export const TRAINING_ATTENDING_STATUSES: readonly TrainingEnrollmentStatus[] =
  [
    TrainingEnrollmentStatus.ACTIVE,
    TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
  ];

export function activeConsumeRecognition<
  T extends {
    type: TrainingRecognitionType;
    reversedBy?: unknown | null;
  },
>(recognitions: readonly T[] = []): T | undefined {
  return recognitions.find(
    (item) => item.type === TrainingRecognitionType.CONSUME && !item.reversedBy,
  );
}
