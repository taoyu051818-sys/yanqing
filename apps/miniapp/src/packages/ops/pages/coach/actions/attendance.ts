import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import { money } from "../../../../../utils/format";

interface ActionContext {
  activeStudents: ComputedRef<any[]>;
  session: ReturnType<typeof useSessionStore>;
  task: ReturnType<typeof useOperationTask>;
  load: () => Promise<void>;
  errorMessage: Ref<string, string>;
}

export function useCoachAttendanceActions({
  activeStudents,
  session,
  task,
  load,
  errorMessage,
}: ActionContext) {
  function studentsFor(lesson: any) {
    return activeStudents.value.filter(
      (item) => item.classId === lesson.classId,
    );
  }

  function attendanceFor(lesson: any, enrollment: any) {
    return (enrollment.attendances || []).find(
      (item: any) =>
        item.sessionId === lesson.id || item.session?.id === lesson.id,
    );
  }

  function attendanceStatus(lesson: any, enrollment: any) {
    return attendanceFor(lesson, enrollment)?.status || "PENDING";
  }

  function isRefundPending(enrollment: any) {
    return enrollment.order?.status === "REFUND_PENDING";
  }

  function attendanceLabel(status: string) {
    const labels: Record<string, string> = {
      PENDING: "待点名",
      ATTENDED: "已到场",
      ABSENT: "缺席",
      MAKEUP_REQUIRED: "请假待补课",
      MADE_UP: "已安排补课",
      CANCELLED: "已取消",
    };
    return labels[status] || status;
  }

  function hasPendingProposal(lesson: any, enrollment: any) {
    const attendance = attendanceFor(lesson, enrollment);
    return (
      attendance?.status === "ATTENDED" &&
      Boolean(attendance.operatorId) &&
      !attendance.consumedAt
    );
  }

  function isConsumableLesson(lesson: any) {
    return !["COMPLETED", "CANCELLED"].includes(lesson.status);
  }

  function lessonWindowState(
    lesson: any,
    kind: "attendanceWindow" | "completionWindow",
  ) {
    if (lesson?.[kind]?.state) return lesson[kind].state;
    const startsAt = new Date(
      kind === "attendanceWindow" ? lesson?.startsAt : lesson?.endsAt,
    ).getTime();
    const endsAt = new Date(lesson?.endsAt).getTime();
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return "CLOSED";
    const earlyMinutes = kind === "attendanceWindow" ? 30 : 0;
    const lateMinutes = kind === "attendanceWindow" ? 120 : 240;
    if (Date.now() < startsAt - earlyMinutes * 60_000) return "NOT_OPEN";
    if (Date.now() <= endsAt + lateMinutes * 60_000) return "OPEN";
    return "CLOSED";
  }

  function canUseLessonWindow(
    lesson: any,
    kind: "attendanceWindow" | "completionWindow",
  ) {
    const state = lessonWindowState(lesson, kind);
    return (
      state === "OPEN" ||
      (state === "CLOSED" && lesson?.[kind]?.mayHistoricallyOverride)
    );
  }

  function attendanceWindowHint(lesson: any) {
    const state = lessonWindowState(lesson, "attendanceWindow");
    if (state === "NOT_OPEN") return "未到点名窗口";
    if (state === "CLOSED" && lesson?.attendanceWindow?.mayHistoricallyOverride)
      return "管理员可补录点名";
    if (state === "CLOSED") return "点名窗口已关闭";
    return "";
  }

  function completionActionLabel(lesson: any) {
    const state = lessonWindowState(lesson, "completionWindow");
    if (state === "NOT_OPEN") return "待下课后确认";
    if (state === "CLOSED" && lesson?.completionWindow?.mayHistoricallyOverride)
      return "补录确认入账";
    if (state === "CLOSED") return "确认窗口已关闭";
    return "确认入账";
  }

  function hasUnresolvedAttendance(lesson: any) {
    return studentsFor(lesson).some((enrollment: any) => {
      const attendance = attendanceFor(lesson, enrollment);
      if (!attendance) return true;
      if (["PENDING", "LEAVE", "MAKEUP_REQUIRED"].includes(attendance.status))
        return true;
      return (
        attendance.status === "ATTENDED" &&
        Number(attendance.consumedSessions || 0) === 0
      );
    });
  }

  async function operationWindowReason(options: {
    startsAt: string;
    endsAt: string;
    earlyMinutes: number;
    lateMinutes: number;
    reason?: string;
    label: string;
  }) {
    const startsAt = new Date(options.startsAt).getTime();
    const endsAt = new Date(options.endsAt).getTime();
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
      uni.showToast({ title: `${options.label}时间无效`, icon: "none" });
      return { allowed: false, reason: options.reason };
    }
    if (Date.now() < startsAt - options.earlyMinutes * 60_000) {
      uni.showToast({
        title: `未到${options.label}窗口，不能提前操作`,
        icon: "none",
      });
      return { allowed: false, reason: options.reason };
    }
    if (Date.now() <= endsAt + options.lateMinutes * 60_000) {
      return { allowed: true, reason: options.reason };
    }
    if (
      !session.roles.some((role) => ["ADMIN", "SUPER_ADMIN"].includes(role))
    ) {
      uni.showToast({
        title: `${options.label}已过窗口，请由管理员历史补录`,
        icon: "none",
      });
      return { allowed: false, reason: options.reason };
    }
    if (options.reason && options.reason.trim().length >= 2) {
      return { allowed: true, reason: options.reason.trim() };
    }
    throw new Error(options.label + "历史补录须填写核对原因（2-300字）");
  }

  function mark(
    lesson: any,
    enrollment: any,
    status: "ATTENDED" | "ABSENT" | "LEAVE" | "CANCELLED",
  ) {
    const labels = {
      ATTENDED: "登记到场",
      ABSENT: "登记缺席",
      LEAVE: "登记请假",
      CANCELLED: "取消本次课次",
    };
    task.start({
      title: labels[status],
      description:
        (enrollment.student?.displayName ||
          enrollment.buyer?.displayName ||
          "成人学员") + " · 只登记出勤，不自动扣课或确认收入。",
      confirmText: "确认" + labels[status],
      fields: [
        reasonField(
          "核对依据",
          status === "ATTENDED"
            ? ["已核对本人到场"]
            : status === "ABSENT"
              ? ["课程结束，未到场且无请假记录"]
              : ["学员主动请假", "课程安排调整"],
        ),
      ],
      submit: async ({ reason }) => {
        const gate = await operationWindowReason({
          startsAt: lesson.startsAt,
          endsAt: lesson.endsAt,
          earlyMinutes: 30,
          lateMinutes: 120,
          reason,
          label: "培训点名",
        });
        if (!gate.allowed) throw new Error("当前不在允许点名时间，请核对课次");
        await endpoints.markTrainingAttendance(lesson.id, {
          enrollmentId: enrollment.id,
          status,
          reason,
          feedback:
            status === "ATTENDED" ? "已到场，待提交消课建议" : undefined,
        });
        await load();
        return "出勤状态已更新；到场学员下一步由教练提交消课建议。";
      },
    });
  }

  function propose(lesson: any, enrollment: any) {
    if (!isConsumableLesson(lesson)) {
      errorMessage.value = "已结束或取消的课次不能继续消课";
      return;
    }
    task.start({
      title: "提交消课建议",
      description:
        (enrollment.student?.displayName ||
          enrollment.buyer?.displayName ||
          "当前学员") + " · 提交后须另一位培训主管确认，才扣课包并确认收入。",
      confirmText: "确认提交消课建议",
      fields: [
        {
          key: "feedback",
          label: "训练反馈",
          required: false,
          max: 500,
          hint: "可以补充本次训练情况，主管复核时可见。",
        },
      ],
      submit: async ({ feedback }) => {
        await endpoints.consumeTraining(lesson.id, {
          enrollmentId: enrollment.id,
          feedback: feedback || "已到场，完成本次训练",
          attendanceStatus: "PRESENT",
        });
        await load();
        return "消课建议已提交，课时与收入暂未变化，等待独立确认。";
      },
    });
  }

  function confirm(lesson: any, enrollment: any) {
    if (!isConsumableLesson(lesson)) return;
    const attendance = attendanceFor(lesson, enrollment);
    if (!attendance?.operatorId || attendance.operatorId === session.user?.id) {
      errorMessage.value = "须由教练先提交建议，且提交人与确认人不同。";
      return;
    }
    task.start({
      title: "确认消课入账",
      description:
        (enrollment.student?.displayName ||
          enrollment.buyer?.displayName ||
          "当前学员") +
        " · 确认扣减1课次并确认本节收入，按原合同快照核算。误操作须通过冲正复核恢复。",
      confirmText: "确认扣课并入账",
      fields: [reasonField("独立复核依据", ["已核对点名与教练反馈"])],
      submit: async ({ reason }) => {
        const gate = await operationWindowReason({
          startsAt: lesson.endsAt,
          endsAt: lesson.endsAt,
          earlyMinutes: 0,
          lateMinutes: 240,
          reason,
          label: "确认消课",
        });
        if (!gate.allowed) throw new Error("当前不在允许入账时间，请核对课次");
        const result: any = await endpoints.confirmTrainingConsume(lesson.id, {
          enrollmentId: enrollment.id,
          reason,
        });
        await load();
        return (
          "消课已入账，确认收入 " +
          money(
            result?.effectiveRevenueCents ||
              result?.recognizedRevenueCents ||
              0,
          ) +
          "，课包及审计已同步。"
        );
      },
    });
  }

  function complete(lesson: any) {
    if (!isConsumableLesson(lesson)) return;
    if (hasUnresolvedAttendance(lesson)) {
      errorMessage.value = "仍有未处理出勤或未确认消课，请逐个处理后结束课次。";
      return;
    }
    task.start({
      title: "结束课次",
      description:
        "确认该课次全部出勤和消课已处理。结束后不可继续点名或消课，历史证据保留。",
      confirmText: "确认结束课次",
      fields: [reasonField("结课依据", ["已核对全部出勤与消课记录"])],
      submit: async ({ reason }) => {
        const gate = await operationWindowReason({
          startsAt: lesson.endsAt,
          endsAt: lesson.endsAt,
          earlyMinutes: 0,
          lateMinutes: 240,
          reason,
          label: "培训结课",
        });
        if (!gate.allowed) throw new Error("当前不在允许结课时间");
        await endpoints.completeTrainingSession(lesson.id, { reason });
        await load();
        return "课次已结束，履约及收入记录可追溯。";
      },
    });
  }
  return {
    studentsFor,
    attendanceFor,
    attendanceStatus,
    isRefundPending,
    attendanceLabel,
    hasPendingProposal,
    isConsumableLesson,
    lessonWindowState,
    canUseLessonWindow,
    attendanceWindowHint,
    completionActionLabel,
    hasUnresolvedAttendance,
    operationWindowReason,
    mark,
    propose,
    confirm,
    complete,
  };
}
