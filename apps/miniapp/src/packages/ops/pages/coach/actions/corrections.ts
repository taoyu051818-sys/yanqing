import type {
  TrainingEnrollmentView,
  TrainingSessionView,
} from "@yanqing/shared";
import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import type { useSessionStore } from "../../../../../stores/session";
import { idempotencyKey } from "../../../../../utils/format";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";

interface ActionContext {
  attendanceFor: (
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) => any;
  corrections: Ref<any[], any[]>;
  session: ReturnType<typeof useSessionStore>;
  canRequestCorrection: ComputedRef<boolean>;
  errorMessage: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  load: () => Promise<void>;
  isChecker: ComputedRef<boolean>;
}

export function useCoachCorrectionsActions({
  attendanceFor,
  corrections,
  session,
  canRequestCorrection,
  errorMessage,
  task,
  load,
  isChecker,
}: ActionContext) {
  function recognitionTimeline(
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) {
    return [
      ...(attendanceFor(lesson, enrollment)?.revenueRecognitions || []),
    ].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence));
  }

  function activeRecognition(
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) {
    return [...recognitionTimeline(lesson, enrollment)]
      .reverse()
      .find((item: any) => item.type === "CONSUME" && !item.reversedBy);
  }

  function activeCorrection(recognitionId: string) {
    return corrections.value.find(
      (item) =>
        item.recognitionId === recognitionId &&
        ["REQUESTED", "APPROVED"].includes(item.status),
    );
  }

  function isOwnCorrection(correction: any) {
    return correction.requestedBy?.id === session.user?.id;
  }

  function correctionStudentName(correction: any) {
    return (
      correction.attendance?.enrollment?.student?.displayName ||
      correction.attendance?.enrollment?.buyer?.displayName ||
      "成人学员"
    );
  }

  function requestCorrection(
    lesson: TrainingSessionView,
    enrollment: TrainingEnrollmentView,
  ) {
    if (!canRequestCorrection.value) return;
    const recognition = activeRecognition(lesson, enrollment);
    if (!recognition || activeCorrection(recognition.id)) {
      errorMessage.value = "没有可冲正的消课，或已经有待处理冲正。";
      return;
    }
    task.start({
      title: "申请消课冲正",
      description:
        (enrollment.student?.displayName ||
          enrollment.buyer?.displayName ||
          "成人学员") +
        " · 申请不立即改变课时和收入，原消课保留，须另一名管理员批准。",
      confirmText: "确认提交冲正复核",
      fields: [reasonField("误消原因与核对依据")],
      submit: async ({ reason }) => {
        const command = { recognitionId: recognition.id, reason };
        await withPendingCreationKey(
          "training.consume-correction." + recognition.id,
          command,
          (idempotencyKey) =>
            endpoints.requestTrainingConsumeCorrection({
              ...command,
              idempotencyKey,
            }),
        );
        await load();
        return "冲正申请已提交；原消课仍有效，请等待另一名管理员复核。";
      },
    });
  }

  function decideCorrection(correction: any, action: "approve" | "reject") {
    if (!isChecker.value || isOwnCorrection(correction)) {
      errorMessage.value = "申请人与复核人不能是同一账号。";
      return;
    }
    task.start({
      title: action === "approve" ? "批准消课冲正" : "驳回消课冲正",
      description:
        correctionStudentName(correction) +
        (action === "approve"
          ? " · 确认后生成负向流水，回滚该次收入、课时与成长积分，出勤事实仍保留。"
          : " · 原消课流水与余额保持不变。"),
      confirmText: action === "approve" ? "确认生成负向流水" : "确认驳回",
      fields: [reasonField("复核凭证与依据")],
      submit: async ({ reason }) => {
        await withPendingCreationKey(
          "training.consume-correction." + correction.id + "." + action,
          { correctionId: correction.id, action, reason },
          (idempotencyKey) =>
            action === "approve"
              ? endpoints.approveTrainingConsumeCorrection(correction.id, {
                  reason,
                  idempotencyKey,
                })
              : endpoints.rejectTrainingConsumeCorrection(correction.id, {
                  reason,
                  idempotencyKey,
                }),
        );
        await load();
        return action === "approve"
          ? "冲正已入账，课时、收入和积分已按负向流水回滚，审计保留。"
          : "冲正已驳回，原消课继续有效。";
      },
    });
  }
  return {
    recognitionTimeline,
    activeRecognition,
    activeCorrection,
    isOwnCorrection,
    correctionStudentName,
    requestCorrection,
    decideCorrection,
  };
}
