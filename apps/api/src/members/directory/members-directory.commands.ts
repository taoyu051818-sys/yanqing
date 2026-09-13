import type { AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AppRole,
  Prisma,
  TrainingEnrollmentStatus,
} from '../../generated/prisma/client.js';
import type { MemberQueryDto } from '../members.dto.js';
import { maskPhone } from '../shared/members-support.js';
import { isCoachOnly, assertAnyRole } from '../shared/members-policy.js';

export async function list(
  prisma: PrismaService,
  query: MemberQueryDto,
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
    '无权查看会员目录',
  );
  const coachOnly = isCoachOnly(actor);
  const activeTrainingStatuses: TrainingEnrollmentStatus[] = [
    TrainingEnrollmentStatus.ACTIVE,
    TrainingEnrollmentStatus.COMPLETED,
    TrainingEnrollmentStatus.PARTIALLY_REFUNDED,
  ];
  const conditions: Prisma.UserWhereInput[] = [
    { memberProfile: query.level ? { level: query.level } : { isNot: null } },
  ];
  if (query.keyword) {
    conditions.push({
      OR: [
        { displayName: { contains: query.keyword, mode: 'insensitive' } },
        // A coach may search by name only.  Keeping phone out of the coach
        // predicate prevents an otherwise hidden PII field from becoming a
        // side-channel for discovering unrelated members.
        ...(coachOnly ? [] : [{ phone: { contains: query.keyword } }]),
      ],
    });
  }
  if (coachOnly) {
    conditions.push({
      OR: [
        {
          trainingPurchases: {
            some: {
              status: { in: activeTrainingStatuses },
              class: {
                OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
              },
            },
          },
        },
        {
          guardianStudents: {
            some: {
              enrollments: {
                some: {
                  status: { in: activeTrainingStatuses },
                  class: {
                    OR: [{ coachId: actor.sub }, { assistantId: actor.sub }],
                  },
                },
              },
            },
          },
        },
      ],
    });
  }
  const where: Prisma.UserWhereInput =
    conditions.length === 1 ? conditions[0] : { AND: conditions };

  const coachSelect: Prisma.UserSelect = {
    id: true,
    displayName: true,
    avatarUrl: true,
    memberProfile: { select: { level: true, tags: true, lastVisitAt: true } },
    trainingPurchases: {
      where: {
        status: { in: activeTrainingStatuses },
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
      orderBy: { createdAt: 'desc' as const },
    },
    guardianStudents: {
      where: {
        enrollments: {
          some: {
            status: { in: activeTrainingStatuses },
            class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
          },
        },
      },
      select: {
        id: true,
        displayName: true,
        guardianConsentStatus: true,
        enrollments: {
          where: {
            status: { in: activeTrainingStatuses },
            class: { OR: [{ coachId: actor.sub }, { assistantId: actor.sub }] },
          },
          select: {
            id: true,
            enrollmentNo: true,
            status: true,
            totalSessions: true,
            consumedSessions: true,
            class: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' as const },
        },
      },
    },
  };

  if (coachOnly) {
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: coachSelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.user.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        privacyScope: 'COACH_ASSIGNED' as const,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // A directory lookup is not an account export. Return an explicit
  // operational identity whitelist and load balances only from customer360.
  // This also prevents openId/unionId from leaking through a whole-row User
  // include when an employee opens the member picker.
  const directorySelect = {
    id: true,
    displayName: true,
    avatarUrl: true,
    phone: true,
    status: true,
    createdAt: true,
    memberProfile: {
      select: {
        level: true,
        tags: true,
        membershipExpiresAt: true,
        isNewCustomer: true,
        firstVisitAt: true,
        lastVisitAt: true,
        visitCount: true,
      },
    },
  } satisfies Prisma.UserSelect;
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: directorySelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  const privacyScope = memberPrivacyScope(actor);
  const revealPhone = privacyScope === 'ADMIN';
  return {
    items: items.map((item) => ({
      ...item,
      phone: revealPhone ? item.phone : maskPhone(item.phone),
      privacyScope,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function isFrontDeskLimited(actor: AuthUser) {
  return (
    actor.roles.includes(AppRole.FRONT_DESK) &&
    !actor.roles.some((role) =>
      (
        [AppRole.FINANCE, AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]
      ).includes(role),
    )
  );
}

export function memberPrivacyScope(
  actor: AuthUser,
): 'FRONT_DESK_LIMITED' | 'COACH_ASSIGNED' | 'FINANCE' | 'ADMIN' {
  if (
    actor.roles.some((role) =>
      ([AppRole.ADMIN, AppRole.SUPER_ADMIN] as AppRole[]).includes(role),
    )
  )
    return 'ADMIN';
  if (actor.roles.includes(AppRole.FINANCE)) return 'FINANCE';
  if (actor.roles.includes(AppRole.FRONT_DESK)) return 'FRONT_DESK_LIMITED';
  return 'COACH_ASSIGNED';
}
