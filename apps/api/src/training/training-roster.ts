import type { Prisma } from '../generated/prisma/client.js';

type Enrollment = {
  id: string;
  classId: string | null;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  prepaidBalanceCents: number;
  consumedSessions: number;
  totalSessions: number;
};
type Session = { startsAt: Date; endsAt: Date };

export function trainingEnrollmentCoversSession(
  enrollment: Enrollment,
  session: Session,
) {
  return (
    ['ACTIVE', 'PARTIALLY_REFUNDED'].includes(enrollment.status) &&
    enrollment.prepaidBalanceCents > 0 &&
    enrollment.consumedSessions < enrollment.totalSessions &&
    enrollment.startsAt <= session.startsAt &&
    enrollment.expiresAt >= session.endsAt &&
    session.startsAt < session.endsAt
  );
}

/** Runs in the same Serializable transaction as activation. Session creation
 * reads enrollments in its Serializable transaction, so a concurrent
 * activation/scheduling cycle aborts one command for an idempotent retry.
 */
export async function syncTrainingEnrollmentRoster(
  tx: Prisma.TransactionClient,
  enrollment: Enrollment,
  now: Date,
) {
  if (!enrollment.classId) return;
  const sessions = await tx.trainingSession.findMany({
    where: {
      classId: enrollment.classId,
      status: 'SCHEDULED',
      startsAt: { gt: now, gte: enrollment.startsAt },
      endsAt: { lte: enrollment.expiresAt },
    },
    select: { id: true, startsAt: true, endsAt: true },
  });
  const data = sessions
    .filter((session) => trainingEnrollmentCoversSession(enrollment, session))
    .map((session) => ({ sessionId: session.id, enrollmentId: enrollment.id }));
  if (data.length)
    await tx.trainingAttendance.createMany({ data, skipDuplicates: true });
}
