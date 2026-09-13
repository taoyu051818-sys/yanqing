import { NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  TrainingEnrollmentStatus,
} from '../../generated/prisma/client.js';
import {
  FRONT_DESK_ACCOUNT_TYPES,
  maskPhone,
  frontDeskPaymentSummary,
} from '../shared/members-support.js';
import { assertAnyRole } from '../shared/members-policy.js';
import { memberPrivacyScope } from './members-directory.commands.js';

export async function profile(
  prisma: PrismaService,
  userId: string,
  actor: AuthUser,
) {
  assertAnyRole(
    actor,
    [
      AppRole.FRONT_DESK,
      AppRole.COACH,
      AppRole.FINANCE,
      AppRole.ADMIN,
      AppRole.SUPER_ADMIN,
    ],
    '无权查看会员档案',
  );
  const privileged = actor.roles.some((role) =>
    (
      [
        AppRole.FRONT_DESK,
        AppRole.FINANCE,
        AppRole.ADMIN,
        AppRole.SUPER_ADMIN,
      ] as AppRole[]
    ).includes(role),
  );

  // Coaches are deliberately scoped to their own classes. The old route
  // accepted any member id, which exposed unrelated phone/account data to a
  // coach who guessed an id. Check the assignment before loading the
  // profile, and return only the teaching context needed for the class.
  if (!privileged && actor.roles.includes(AppRole.COACH)) {
    const assigned = await prisma.trainingEnrollment.findFirst({
      where: {
        status: {
          in: [
            TrainingEnrollmentStatus.ACTIVE,
            TrainingEnrollmentStatus.COMPLETED,
            TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
          ],
        },
        class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
        OR: [{ buyerId: userId }, { student: { guardianId: userId } }],
      },
      select: { id: true },
    });
    if (!assigned) throw new NotFoundException('会员不在当前教练负责的班级中');

    return prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        memberProfile: {
          select: { level: true, tags: true, lastVisitAt: true },
        },
        trainingPurchases: {
          where: {
            status: {
              in: [
                TrainingEnrollmentStatus.ACTIVE,
                TrainingEnrollmentStatus.COMPLETED,
                TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
              ],
            },
            class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
          },
          select: {
            id: true,
            enrollmentNo: true,
            status: true,
            totalSessions: true,
            consumedSessions: true,
            class: { select: { id: true, name: true } },
            student: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        guardianStudents: {
          where: {
            enrollments: {
              some: {
                status: {
                  in: [
                    TrainingEnrollmentStatus.ACTIVE,
                    TrainingEnrollmentStatus.COMPLETED,
                    TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
                  ],
                },
                class: {
                  OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
                },
              },
            },
          },
          select: {
            id: true,
            displayName: true,
            guardianConsentStatus: true,
            enrollments: {
              where: {
                status: {
                  in: [
                    TrainingEnrollmentStatus.ACTIVE,
                    TrainingEnrollmentStatus.COMPLETED,
                    TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
                  ],
                },
                class: {
                  OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
                },
              },
              select: {
                id: true,
                enrollmentNo: true,
                status: true,
                totalSessions: true,
                consumedSessions: true,
                class: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
  }

  const privacyScope = memberPrivacyScope(actor);
  const member = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      phone: true,
      status: true,
      primaryRole: true,
      createdAt: true,
      updatedAt: true,
      memberProfile: {
        select: {
          level: true,
          tags: true,
          sourceChannel: true,
          membershipExpiresAt: true,
          isNewCustomer: true,
          firstVisitAt: true,
          lastVisitAt: true,
          visitCount: true,
        },
      },
      accounts: {
        ...(privacyScope === 'FRONT_DESK_LIMITED'
          ? { where: { type: { in: FRONT_DESK_ACCOUNT_TYPES } } }
          : {}),
        select: {
          id: true,
          type: true,
          balance: true,
          frozenBalance: true,
          updatedAt: true,
        },
        orderBy: { type: 'asc' },
      },
      guardianStudents: {
        select: {
          id: true,
          displayName: true,
          birthMonth: true,
          guardianConsentStatus: true,
        },
      },
      referrer:
        privacyScope === 'ADMIN'
          ? { select: { id: true, displayName: true } }
          : { select: { displayName: true } },
    },
  });
  return {
    ...member,
    phone: privacyScope === 'ADMIN' ? member.phone : maskPhone(member.phone),
    accounts: privacyScope === 'FRONT_DESK_LIMITED' ? [] : member.accounts,
    paymentSummary:
      privacyScope === 'FRONT_DESK_LIMITED'
        ? frontDeskPaymentSummary(member.accounts)
        : undefined,
    privacyScope,
    accountTypesLimited: privacyScope === 'FRONT_DESK_LIMITED',
  };
}
