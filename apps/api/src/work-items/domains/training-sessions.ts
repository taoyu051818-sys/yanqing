import { trainingSessionScope } from '../../common/auth/operation-scopes.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  AttendanceStatus,
  TrainingSessionStatus,
} from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadTrainingSessions(
  prisma: PrismaService,
  context: Pick<
    WorkItemContext,
    'actor' | 'limit' | 'nowDate' | 'canOperateTrainingSessions'
  >,
) {
  const { actor, limit, nowDate, canOperateTrainingSessions } = context;
  return canOperateTrainingSessions && prisma.trainingSession?.findMany
    ? prisma.trainingSession.findMany({
        where: {
          status: {
            in: [
              TrainingSessionStatus.SCHEDULED,
              TrainingSessionStatus.IN_PROGRESS,
            ],
          },
          startsAt: { lte: nowDate },
          ...trainingSessionScope(actor),
        },
        select: {
          id: true,
          status: true,
          startsAt: true,
          endsAt: true,
          class: { select: { id: true, name: true, coachId: true } },
          _count: {
            select: {
              attendances: {
                where: { status: AttendanceStatus.PENDING },
              },
            },
          },
        },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapTrainingSessionsWorkItems(
  trainingSessions: Awaited<ReturnType<typeof loadTrainingSessions>>,
  context: Pick<WorkItemContext, 'now'>,
): WorkItem[] {
  const { now } = context;
  return trainingSessions.map((session) => {
    const ended = session.endsAt.getTime() <= now;
    const pending = session._count.attendances;
    return {
      id: `training-session-operation:${session.id}`,
      kind: 'TRAINING_SESSION_OPERATION' as const,
      objectType: 'TrainingSession',
      objectId: session.id,
      status: session.status,
      priority: ended ? 91 : 83,
      title: `${ended ? '课次待结课' : '课次待点名'} · ${session.class.name}`,
      description: `${pending} 名待登记 · 完成点名后提交消课建议`,
      ownerRoles: [
        AppRole.COACH,
        AppRole.FRONT_DESK,
        AppRole.ADMIN,
        AppRole.SUPER_ADMIN,
      ],
      createdAt: session.startsAt.toISOString(),
      dueAt: (ended ? session.endsAt : session.startsAt).toISOString(),
      action: `/packages/ops/pages/coach/index?focus=session&sessionId=${session.id}`,
      metadata: {
        sessionId: session.id,
        classId: session.class.id,
        coachId: session.class.coachId,
        pendingAttendanceCount: pending,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
      },
    };
  });
}
