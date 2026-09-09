import { PrismaService } from '../../database/prisma.service.js';
import { AppRole, AttendanceStatus } from '../../generated/prisma/client.js';
import { WorkItem, WorkItemContext } from '../work-item-context.js';

export function loadAttendances(
  prisma: PrismaService,
  context: Pick<WorkItemContext, 'limit' | 'canReviewTrainingConsumes'>,
) {
  const { limit, canReviewTrainingConsumes } = context;
  return canReviewTrainingConsumes
    ? prisma.trainingAttendance.findMany({
        where: {
          status: AttendanceStatus.ATTENDED,
          operatorId: { not: null },
          consumedAt: null,
          consumedSessions: 0,
        },
        include: {
          session: { include: { class: { select: { name: true } } } },
          enrollment: {
            include: { student: { select: { displayName: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
    : Promise.resolve([]);
}

export function mapAttendancesWorkItems(
  attendances: Awaited<ReturnType<typeof loadAttendances>>,
): WorkItem[] {
  return attendances.map((attendance) => ({
    id: `training-attendance:${attendance.id}`,
    kind: 'TRAINING_ATTENDANCE' as const,
    objectType: 'TrainingAttendance',
    objectId: attendance.id,
    status: attendance.status,
    priority: 80,
    title: `消课建议待确认 · ${attendance.enrollment.student?.displayName || '成人学员'}`,
    description: `${attendance.session.class.name} · 教练已提交 · ${attendance.session.startsAt.toISOString()}`,
    ownerRoles: [AppRole.ADMIN, AppRole.SUPER_ADMIN],
    createdAt: attendance.createdAt.toISOString(),
    dueAt: attendance.session.endsAt.toISOString(),
    action: `/training/sessions/${attendance.sessionId}/consume`,
    metadata: {
      sessionId: attendance.sessionId,
      enrollmentId: attendance.enrollmentId,
    },
  }));
}
