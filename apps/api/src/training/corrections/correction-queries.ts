import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { AppRole } from '../../generated/prisma/client.js';
import { hasAnyRole } from '../training-access.js';
import { isCoachOnly } from './correction-policy.js';

export async function listConsumeCorrections(
  prisma: PrismaService,
  actor: AuthUser,
) {
  const allowed = [
    AppRole.COACH,
    AppRole.FRONT_DESK,
    AppRole.FINANCE,
    AppRole.ADMIN,
    AppRole.SUPER_ADMIN,
  ] as const;
  if (!hasAnyRole(actor, allowed)) {
    throw new ForbiddenException('当前角色无权查看消课冲正申请');
  }
  const coachScope = isCoachOnly(actor);
  const corrections = await prisma.trainingConsumeCorrection.findMany({
    where: coachScope
      ? {
          attendance: {
            session: {
              class: {
                OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
              },
            },
          },
        }
      : undefined,
    include: {
      recognition: {
        select: {
          id: true,
          type: true,
          sequence: true,
          effectiveRevenueCents: true,
          createdAt: true,
        },
      },
      reversalRecognition: {
        select: {
          id: true,
          type: true,
          sequence: true,
          effectiveRevenueCents: true,
          createdAt: true,
        },
      },
      attendance: {
        select: {
          id: true,
          status: true,
          consumedSessions: true,
          confirmedRevenueCents: true,
          growthPointsAwarded: true,
          feedback: true,
          session: {
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              status: true,
              class: { select: { id: true, name: true } },
            },
          },
          enrollment: {
            select: {
              id: true,
              status: true,
              student: { select: { id: true, displayName: true } },
              buyer: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      requestedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { requestedAt: 'desc' },
  });
  return corrections.map((correction) => ({
    id: correction.id,
    status: correction.status,
    reason: correction.reason,
    reviewReason: correction.reviewReason,
    requestedAt: correction.requestedAt,
    reviewedAt: correction.reviewedAt,
    recognitionId: correction.recognitionId,
    recognition: {
      id: correction.recognition.id,
      type: correction.recognition.type,
      sequence: correction.recognition.sequence,
      effectiveRevenueCents: correction.recognition.effectiveRevenueCents,
      createdAt: correction.recognition.createdAt,
    },
    reversalRecognition: correction.reversalRecognition
      ? {
          id: correction.reversalRecognition.id,
          type: correction.reversalRecognition.type,
          sequence: correction.reversalRecognition.sequence,
          effectiveRevenueCents:
            correction.reversalRecognition.effectiveRevenueCents,
          createdAt: correction.reversalRecognition.createdAt,
        }
      : null,
    attendance: {
      id: correction.attendance.id,
      status: correction.attendance.status,
      consumedSessions: correction.attendance.consumedSessions,
      confirmedRevenueCents: correction.attendance.confirmedRevenueCents,
      growthPointsAwarded: correction.attendance.growthPointsAwarded,
      feedback: correction.attendance.feedback,
      session: correction.attendance.session,
      enrollment: correction.attendance.enrollment,
    },
    requestedBy: correction.requestedBy,
    reviewedBy: correction.reviewedBy,
  }));
}
