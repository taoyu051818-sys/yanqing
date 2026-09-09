import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, TrainingTrialStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadTrainingTrials(
  prisma: PrismaService,
  context: Pick<
    WorkItemContext,
    | 'actor'
    | 'limit'
    | 'isOperationsAdmin'
    | 'canCheckInTrials'
    | 'canAssessTrials'
    | 'canDecideTrials'
  >,
) {
  const {
    actor,
    limit,
    isOperationsAdmin,
    canCheckInTrials,
    canAssessTrials,
    canDecideTrials,
  } = context;
  return (canCheckInTrials || canAssessTrials || canDecideTrials) &&
    prisma.trainingTrial?.findMany
    ? prisma.trainingTrial.findMany({
        where: {
          OR: [
            ...(canCheckInTrials
              ? [{ status: TrainingTrialStatus.RESERVED }]
              : []),
            ...(canAssessTrials
              ? [
                  {
                    status: TrainingTrialStatus.CHECKED_IN,
                    ...(isOperationsAdmin ? {} : { coachId: actor.sub }),
                  },
                ]
              : []),
            ...(canDecideTrials
              ? [{ status: TrainingTrialStatus.ASSESSED }]
              : []),
          ],
        },
        include: {
          product: { select: { name: true } },
          student: { select: { displayName: true } },
          member: { select: { displayName: true } },
          lead: { select: { displayName: true } },
          coach: { select: { displayName: true } },
        },
        orderBy: { scheduledStartsAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapTrainingTrialsWorkItems(
  trainingTrials: Awaited<ReturnType<typeof loadTrainingTrials>>,
  context: Pick<WorkItemContext, 'now'>,
): WorkItem[] {
  const { now } = context;
  return trainingTrials.map((trial) => {
    const subjectName =
      trial.student?.displayName ||
      trial.member?.displayName ||
      trial.lead?.displayName ||
      '待确认学员';
    const isArrival = trial.status === TrainingTrialStatus.RESERVED;
    const isAssessment = trial.status === TrainingTrialStatus.CHECKED_IN;
    const dueAt = isArrival ? trial.scheduledStartsAt : trial.scheduledEndsAt;
    return {
      id: `training-trial:${trial.id}`,
      kind: isArrival
        ? ('TRAINING_TRIAL_CHECK_IN' as const)
        : isAssessment
          ? ('TRAINING_TRIAL_ASSESSMENT' as const)
          : ('TRAINING_TRIAL_DECISION' as const),
      objectType: 'TrainingTrial',
      objectId: trial.id,
      status: trial.status,
      priority:
        isArrival && dueAt.getTime() <= now ? 94 : isAssessment ? 89 : 87,
      title: isArrival
        ? `试听待到场 · ${subjectName}`
        : isAssessment
          ? `试听待测评 · ${subjectName}`
          : `试听待转化决策 · ${subjectName}`,
      description: `${trial.product.name} · ${trial.coach.displayName} · ${trial.scheduledStartsAt.toISOString()}`,
      ownerRoles: isArrival
        ? [AppRole.FRONT_DESK, AppRole.ADMIN, AppRole.SUPER_ADMIN]
        : isAssessment
          ? [AppRole.COACH, AppRole.ADMIN, AppRole.SUPER_ADMIN]
          : [AppRole.ADMIN, AppRole.SUPER_ADMIN],
      createdAt: trial.createdAt.toISOString(),
      dueAt: dueAt.toISOString(),
      action: `/packages/ops/pages/coach/index?focus=trials&id=${trial.id}`,
      metadata: {
        trialNo: trial.trialNo,
        productId: trial.productId,
        coachId: trial.coachId,
        scheduledStartsAt: trial.scheduledStartsAt.toISOString(),
        scheduledEndsAt: trial.scheduledEndsAt.toISOString(),
      },
    };
  });
}
