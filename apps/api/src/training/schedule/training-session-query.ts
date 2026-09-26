import type { TrainingSessionView } from '@yanqing/shared';
import { trainingSessionScope } from '../../common/auth/operation-scopes.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AppRole, type Prisma } from '../../generated/prisma/client.js';
import {
  resolveOperationWindowConfiguration,
  TRAINING_ATTENDANCE_WINDOW_PARAMETER,
  TRAINING_COMPLETION_WINDOW_PARAMETER,
} from '../../common/time-window/operation-time-window.js';

/** All session reads share coach ownership and the same public projection. */
export async function queryTrainingSessions(
  prisma: PrismaService,
  actor: AuthUser | undefined,
  options: {
    where?: Prisma.TrainingSessionWhereInput;
    take: number;
    skip?: number;
    upcoming?: boolean;
  },
): Promise<TrainingSessionView<Date, Prisma.Decimal>[]> {
  const observedAt = new Date();
  const [sessions, attendanceConfiguration, completionConfiguration] =
    await Promise.all([
      prisma.trainingSession.findMany({
        where: {
          AND: [trainingSessionScope(actor) || {}, options.where || {}],
        },
        include: {
          class: { include: { product: true } },
          attendances: {
            include: {
              enrollment: {
                include: {
                  buyer: { select: { displayName: true } },
                  student: true,
                },
              },
            },
          },
        },
        orderBy: [
          { startsAt: options.upcoming ? 'asc' : 'desc' },
          { id: options.upcoming ? 'asc' : 'desc' },
        ],
        take: options.take,
        skip: options.skip || 0,
      }),
      resolveOperationWindowConfiguration(
        prisma,
        TRAINING_ATTENDANCE_WINDOW_PARAMETER,
        { earlyMinutes: 30, lateMinutes: 120 },
        observedAt,
      ),
      resolveOperationWindowConfiguration(
        prisma,
        TRAINING_COMPLETION_WINDOW_PARAMETER,
        { earlyMinutes: 0, lateMinutes: 240 },
        observedAt,
      ),
    ]);
  const mayHistoricallyOverride = Boolean(
    actor?.roles.some((role) =>
      [AppRole.ADMIN, AppRole.SUPER_ADMIN].includes(role as never),
    ),
  );
  const windowProjection = (
    startsAt: Date,
    endsAt: Date,
    configuration: { earlyMinutes: number; lateMinutes: number },
  ) => {
    const opensAt = new Date(
      startsAt.getTime() - configuration.earlyMinutes * 60_000,
    );
    const closesAt = new Date(
      endsAt.getTime() + configuration.lateMinutes * 60_000,
    );
    const state =
      observedAt < opensAt
        ? ('NOT_OPEN' as const)
        : observedAt <= closesAt
          ? ('OPEN' as const)
          : ('CLOSED' as const);
    return {
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      state,
      mayHistoricallyOverride: state === 'CLOSED' && mayHistoricallyOverride,
    };
  };
  return sessions.map((session) => ({
    id: session.id,
    classId: session.classId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    status: session.status,
    courtCount: session.courtCount,
    occupiedCourtHours: session.occupiedCourtHours,
    note: session.note,
    attendanceWindow: windowProjection(
      session.startsAt,
      session.endsAt,
      attendanceConfiguration,
    ),
    completionWindow: windowProjection(
      session.endsAt,
      session.endsAt,
      completionConfiguration,
    ),
    class: {
      id: session.class.id,
      name: session.class.name,
      capacity: session.class.capacity,
      active: session.class.active,
      product: {
        id: session.class.product.id,
        name: session.class.product.name,
        audience: session.class.product.audience,
      },
    },
    attendances: session.attendances.map((attendance) => ({
      id: attendance.id,
      sessionId: attendance.sessionId,
      enrollmentId: attendance.enrollmentId,
      status: attendance.status,
      consumedSessions: attendance.consumedSessions,
      confirmedRevenueCents: attendance.confirmedRevenueCents,
      growthPointsAwarded: attendance.growthPointsAwarded,
      feedback: attendance.feedback,
      checkedInAt: attendance.checkedInAt,
      consumedAt: attendance.consumedAt,
      enrollment: {
        id: attendance.enrollment.id,
        enrollmentNo: attendance.enrollment.enrollmentNo,
        status: attendance.enrollment.status,
        student: attendance.enrollment.student
          ? {
              id: attendance.enrollment.student.id,
              displayName: attendance.enrollment.student.displayName,
            }
          : null,
        buyer: attendance.enrollment.buyer,
      },
    })),
  }));
}
