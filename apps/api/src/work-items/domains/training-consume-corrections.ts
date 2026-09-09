import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  TrainingConsumeCorrectionStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadTrainingConsumeCorrections(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewTrainingCorrections'>,
) {
  const { limit, canReviewTrainingCorrections } = context;
  return canReviewTrainingCorrections
    ? prisma.trainingConsumeCorrection.findMany({
        where: { status: TrainingConsumeCorrectionStatus.REQUESTED },
        include: {
          attendance: {
            include: {
              session: { include: { class: { select: { name: true } } } },
              enrollment: {
                include: {
                  student: { select: { displayName: true } },
                  buyer: { select: { displayName: true } },
                },
              },
            },
          },
          requestedBy: { select: { displayName: true } },
        },
        orderBy: { requestedAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapTrainingConsumeCorrectionsWorkItems(
  trainingConsumeCorrections: Awaited<
    ReturnType<typeof loadTrainingConsumeCorrections>
  >,
): WorkItem[] {
  return trainingConsumeCorrections.map((correction) => {
    const studentName =
      correction.attendance.enrollment.student?.displayName ||
      correction.attendance.enrollment.buyer.displayName ||
      '成人学员';
    return {
      id: `training-consume-correction:${correction.id}`,
      kind: 'TRAINING_CONSUME_CORRECTION_REVIEW' as const,
      objectType: 'TrainingConsumeCorrection',
      objectId: correction.id,
      status: correction.status,
      priority: 92,
      title: `消课冲正待复核 · ${studentName}`,
      description: `${correction.attendance.session.class.name} · 学员 ${studentName} · 申请人 ${correction.requestedBy.displayName} · ${correction.reason}`,
      ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
      createdAt: correction.requestedAt.toISOString(),
      action: `/training/consume-corrections/${correction.id}/approve`,
      metadata: {
        recognitionId: correction.recognitionId,
        attendanceId: correction.attendanceId,
        requestedById: correction.requestedById,
      },
    };
  });
}
