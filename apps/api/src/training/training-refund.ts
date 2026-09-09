import {
  AttendanceStatus,
  Prisma,
  TrainingEnrollmentStatus,
} from '../generated/prisma/client.js';
import type { TrainingEnrollment } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth/auth-user.js';

/** Called only on refund success, inside the payment/refund transaction. */
export async function applyTrainingRefund(
  tx: Prisma.TransactionClient,
  enrollment: Pick<
    TrainingEnrollment,
    'id' | 'totalAmountCents' | 'refundedCents' | 'prepaidBalanceCents'
  >,
  refund: {
    id: string;
    amountCents: number;
    fullyRefunded: boolean;
    reason: string;
  },
  actor: Pick<AuthUser, 'sub' | 'roles'>,
) {
  const remainingPrepaid = Math.max(
    0,
    enrollment.prepaidBalanceCents - refund.amountCents,
  );
  await tx.trainingEnrollment.update({
    where: { id: enrollment.id },
    data: {
      refundedCents: Math.min(
        enrollment.totalAmountCents,
        enrollment.refundedCents + refund.amountCents,
      ),
      prepaidBalanceCents: remainingPrepaid,
      // Keep the financial history: a used lesson plus refund of the rest
      // remains a partial refund. Operational eligibility also checks balance.
      status: refund.fullyRefunded
        ? TrainingEnrollmentStatus.REFUNDED
        : TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
    },
  });
  if (remainingPrepaid > 0) return;

  // Cancel only unfulfilled obligations. Never rewrite arrival, consumption,
  // recognized revenue, absences or correction history to make a refund fit.
  const cancellable: Prisma.TrainingAttendanceWhereInput = {
    enrollmentId: enrollment.id,
    status: {
      in: [
        AttendanceStatus.PENDING,
        AttendanceStatus.LEAVE,
        AttendanceStatus.MAKEUP_REQUIRED,
        AttendanceStatus.MADE_UP,
      ],
    },
    consumedSessions: 0,
    checkedInAt: null,
    consumedAt: null,
    revenueRecognitions: {
      none: { type: 'CONSUME', reversedBy: { is: null } },
    },
  };
  const pending = await tx.trainingAttendance.findMany({
    where: cancellable,
    select: { id: true, status: true, makeupTargetId: true },
  });
  if (!pending.length) return;
  await tx.trainingAttendance.updateMany({
    where: { ...cancellable, id: { in: pending.map((row) => row.id) } },
    data: { status: AttendanceStatus.CANCELLED, makeupTargetId: null },
  });
  await tx.auditLog.create({
    data: {
      actorId: actor.sub,
      actorRole: actor.roles[0],
      action: 'TRAINING_REFUND_ROSTER_RELEASED',
      objectType: 'TrainingEnrollment',
      objectId: enrollment.id,
      reason: refund.reason,
      oldValue: { attendances: pending },
      newValue: {
        refundId: refund.id,
        prepaidBalanceCents: 0,
        status: AttendanceStatus.CANCELLED,
        attendanceIds: pending.map((row) => row.id),
      },
    },
  });
}
