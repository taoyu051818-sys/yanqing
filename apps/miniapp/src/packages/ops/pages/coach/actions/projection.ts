import type {
  TrainingEnrollmentView,
  TrainingProductView,
  TrainingSessionView,
} from "@yanqing/shared";
import type { Ref, ComputedRef } from "vue";
import { computed } from "vue";
import { hasOperationsAccess } from "../../../../../config/operations";
import type { useSessionStore } from "../../../../../stores/session";
import type { CourtAvailability } from "../../../../../types/domain";

interface ActionContext {
  session: ReturnType<typeof useSessionStore>;
  staffUsers: Ref<any[], any[]>;
  corrections: Ref<any[], any[]>;
  products: Ref<TrainingProductView[]>;
  classProductIndex: Ref<number, number>;
  sessionClassIndex: Ref<number, number>;
  lessons: Ref<TrainingSessionView[]>;
  trialSessionIndex: Ref<number, number>;
  trialSubjectIndex: Ref<number, number>;
  leads: Ref<any[], any[]>;
  trialLeadIndex: Ref<number, number>;
  trialStudents: Ref<any[], any[]>;
  trialStudentIndex: Ref<number, number>;
  trialMembers: Ref<any[], any[]>;
  trialMemberIndex: Ref<number, number>;
  courtAvailability: Ref<CourtAvailability | null>;
  sessionDate: Ref<string, string>;
  sessionStartTime: Ref<string, string>;
  sessionEndTime: Ref<string, string>;
  enrollments: Ref<TrainingEnrollmentView[]>;
  trials: Ref<any[], any[]>;
}

export function useCoachViewModel({
  session,
  staffUsers,
  corrections,
  products,
  classProductIndex,
  sessionClassIndex,
  lessons,
  trialSessionIndex,
  trialSubjectIndex,
  leads,
  trialLeadIndex,
  trialStudents,
  trialStudentIndex,
  trialMembers,
  trialMemberIndex,
  courtAvailability,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  enrollments,
  trials,
}: ActionContext) {
  const mayViewTraining = computed(() =>
    hasOperationsAccess(session.roles, "training"),
  );

  const canConfigureTraining = computed(() =>
    session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
  );

  const canManageTrials = computed(() =>
    session.roles.some((role) =>
      ["FRONT_DESK", "ADMIN", "SUPER_ADMIN"].includes(role),
    ),
  );

  const canAssessTrials = computed(() =>
    session.roles.some((role) =>
      ["COACH", "ADMIN", "SUPER_ADMIN"].includes(role),
    ),
  );

  const canConvertTrials = computed(() =>
    session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
  );

  const canDraftYouthRule = computed(() => session.roles.includes("ADMIN"));

  const canReviewYouthRule = computed(() =>
    session.roles.includes("SUPER_ADMIN"),
  );

  const canCreateSession = computed(() =>
    session.roles.some((role) =>
      ["COACH", "ADMIN", "SUPER_ADMIN"].includes(role),
    ),
  );

  const canProposeConsume = computed(
    () =>
      session.roles.includes("COACH") &&
      !session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role)),
  );

  const roleLabel = computed(() => {
    if (session.roles.includes("SUPER_ADMIN")) return "超级管理员";
    if (session.roles.includes("ADMIN")) return "培训管理员";
    if (session.roles.includes("COACH")) return "教练";
    if (session.roles.includes("FINANCE")) return "财务只读";
    return "前台协作";
  });

  const isChecker = computed(
    () =>
      session.roles.includes("ADMIN") || session.roles.includes("SUPER_ADMIN"),
  );

  const canMarkAttendance = computed(() =>
    session.roles.some((role) =>
      ["COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"].includes(role),
    ),
  );

  const canRequestCorrection = computed(() =>
    session.roles.some((role) =>
      ["COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN"].includes(role),
    ),
  );

  const coachUsers = computed(() =>
    staffUsers.value.filter((user) => {
      const roles = [
        user.primaryRole,
        ...(user.roles || []).map((item: any) =>
          typeof item === "string" ? item : item.role,
        ),
      ];
      return user.status !== "DISABLED" && roles.includes("COACH");
    }),
  );

  const coachOptions = computed(() => [
    { id: "", displayName: "暂不指定" },
    ...coachUsers.value,
  ]);

  const requestedCorrections = computed(() =>
    corrections.value.filter((item) => item.status === "REQUESTED"),
  );

  const activeProducts = computed(() =>
    products.value.filter((item) => item.enabled !== false),
  );

  const activeClasses = computed(() =>
    activeProducts.value.flatMap((product) =>
      (product.classes || [])
        .filter((trainingClass) => trainingClass.active !== false)
        .map((trainingClass) => ({ ...trainingClass, product })),
    ),
  );

  const sessionClasses = computed(() => {
    return activeClasses.value;
  });

  const selectedClassProduct = computed(
    () => activeProducts.value[classProductIndex.value] || null,
  );

  const selectedSessionClass = computed(
    () => sessionClasses.value[sessionClassIndex.value] || null,
  );

  const schedulableTrialSessions = computed(() =>
    lessons.value.filter(
      (item) =>
        item.status === "SCHEDULED" &&
        new Date(item.endsAt || item.startsAt).getTime() > Date.now(),
    ),
  );

  const selectedTrialSession = computed(
    () => schedulableTrialSessions.value[trialSessionIndex.value] || null,
  );

  const selectedTrialClass = computed(() => {
    const selected = selectedTrialSession.value;
    if (!selected) return null;
    return (
      activeClasses.value.find((item) => item.id === selected.classId) ||
      selected.class ||
      null
    );
  });

  const selectedTrialProduct = computed(
    () =>
      selectedTrialClass.value?.product ||
      activeProducts.value.find(
        (item) => item.id === selectedTrialClass.value?.product?.id,
      ) ||
      null,
  );

  const selectedTrialSubject = computed(() => {
    if (trialSubjectIndex.value === 1)
      return leads.value[trialLeadIndex.value] || null;
    if (trialSubjectIndex.value === 2)
      return trialStudents.value[trialStudentIndex.value] || null;
    return trialMembers.value[trialMemberIndex.value] || null;
  });

  const sessionCourts = computed(() =>
    (courtAvailability.value?.courts || []).filter((court) => court.enabled),
  );

  const sessionStartsAt = computed(
    () => `${sessionDate.value}T${sessionStartTime.value}:00+08:00`,
  );

  const sessionEndsAt = computed(
    () => `${sessionDate.value}T${sessionEndTime.value}:00+08:00`,
  );

  const blockedCourtIds = computed(() => {
    const blocked = new Set<string>();
    const startsAt = new Date(sessionStartsAt.value).getTime();
    const endsAt = new Date(sessionEndsAt.value).getTime();
    if (
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      endsAt <= startsAt
    )
      return blocked;
    for (const booking of courtAvailability.value?.bookings || []) {
      if (
        booking.status !== "CANCELLED" &&
        new Date(booking.startsAt).getTime() < endsAt &&
        new Date(booking.endsAt).getTime() > startsAt
      )
        blocked.add(booking.courtId);
    }
    for (const closure of courtAvailability.value?.closures || []) {
      if (
        closure.status === "ACTIVE" &&
        new Date(closure.startsAt).getTime() < endsAt &&
        new Date(closure.endsAt).getTime() > startsAt
      )
        blocked.add(closure.courtId);
    }
    return blocked;
  });

  const activeLessons = computed(() =>
    lessons.value.filter(
      (item) => !["COMPLETED", "CANCELLED"].includes(item.status),
    ),
  );

  const activeStudents = computed(() =>
    enrollments.value.filter((item) =>
      ["ACTIVE", "PARTIALLY_REFUNDED"].includes(item.status),
    ),
  );

  const metrics = computed(() => [
    ["待处理课次", String(activeLessons.value.length), "含今日与已排课"],
    ["待签到学员", String(activeStudents.value.length), "可消课课包"],
    [
      "已消课",
      String(
        enrollments.value.reduce(
          (total, item) => total + Number(item.consumedSessions || 0),
          0,
        ),
      ),
      "累计课次",
    ],
    ["待冲正复核", String(requestedCorrections.value.length), "不可变流水"],
    [
      "待到场试听",
      String(trials.value.filter((item) => item.status === "RESERVED").length),
      "前台跟进",
    ],
    [
      "试听转课",
      String(trials.value.filter((item) => item.status === "CONVERTED").length),
      "已绑定正式报名",
    ],
  ]);
  return {
    mayViewTraining,
    canConfigureTraining,
    canManageTrials,
    canAssessTrials,
    canConvertTrials,
    canDraftYouthRule,
    canReviewYouthRule,
    canCreateSession,
    canProposeConsume,
    roleLabel,
    isChecker,
    canMarkAttendance,
    canRequestCorrection,
    coachUsers,
    coachOptions,
    requestedCorrections,
    activeProducts,
    activeClasses,
    sessionClasses,
    selectedClassProduct,
    selectedSessionClass,
    schedulableTrialSessions,
    selectedTrialSession,
    selectedTrialClass,
    selectedTrialProduct,
    selectedTrialSubject,
    sessionCourts,
    sessionStartsAt,
    sessionEndsAt,
    blockedCourtIds,
    activeLessons,
    activeStudents,
    metrics,
  };
}
