import { requiredReason } from "./validation";
import type { TrainingEnrollmentView } from "@yanqing/shared";
import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey, shortDate } from "../../../../../utils/format";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";

interface ActionContext {
  trialSessionIndex: Ref<number, number>;
  trialCoachId: Ref<string, string>;
  selectedTrialClass: ComputedRef<any>;
  trialLinkLead: Ref<boolean, boolean>;
  canManageTrials: ComputedRef<boolean>;
  actionKey: Ref<string, string>;
  selectedTrialSession: ComputedRef<any>;
  selectedTrialProduct: ComputedRef<any>;
  selectedTrialSubject: ComputedRef<any>;
  trialReason: Ref<string, string>;
  trialSubjectIndex: Ref<number, number>;
  trialSourceOptions: { value: string; label: string }[];
  trialSourceIndex: Ref<number, number>;
  leads: Ref<any[], any[]>;
  trialLeadIndex: Ref<number, number>;
  coachDisplayName: (coachId?: string, fallback?: string) => any;
  runCreation: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
  ) => Promise<boolean>;
  errorMessage: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  operationWindowReason: (options: {
    startsAt: string;
    endsAt: string;
    earlyMinutes: number;
    lateMinutes: number;
    reason?: string;
    label: string;
  }) => Promise<{ allowed: boolean; reason: string | undefined }>;
  load: () => Promise<void>;
  canAssessTrials: ComputedRef<boolean>;
  canConvertTrials: ComputedRef<boolean>;
  enrollments: Ref<TrainingEnrollmentView[]>;
}

export function useCoachTrialsActions({
  trialSessionIndex,
  trialCoachId,
  selectedTrialClass,
  trialLinkLead,
  canManageTrials,
  actionKey,
  selectedTrialSession,
  selectedTrialProduct,
  selectedTrialSubject,
  trialReason,
  trialSubjectIndex,
  trialSourceOptions,
  trialSourceIndex,
  leads,
  trialLeadIndex,
  coachDisplayName,
  runCreation,
  errorMessage,
  task,
  operationWindowReason,
  load,
  canAssessTrials,
  canConvertTrials,
  enrollments,
}: ActionContext) {
  function changeTrialSession(event: any) {
    trialSessionIndex.value = Number(event.detail.value);
    trialCoachId.value = selectedTrialClass.value?.coachId || "";
  }

  function setTrialLinkLead(event: any) {
    trialLinkLead.value = Boolean(event.detail.value);
  }

  async function createTrial() {
    if (!canManageTrials.value || actionKey.value) return;
    try {
      const trialSession = selectedTrialSession.value;
      const trainingClass = selectedTrialClass.value;
      const product = selectedTrialProduct.value;
      const subject = selectedTrialSubject.value;
      const reason = requiredReason(trialReason.value);
      if (!trialSession || !trainingClass || !product)
        throw new Error("请先选择已有场地资源的待开课次。");
      if (!subject) throw new Error("请选择试听主体。");
      if (!trialCoachId.value.trim())
        throw new Error("所选班级尚未配置试听教练，请先完善班级人员。");
      if (trialSubjectIndex.value === 2 && product.audience !== "YOUTH") {
        throw new Error("青少年学员只能预约青少年培训产品。");
      }
      if (trialSubjectIndex.value !== 2 && product.audience === "YOUTH") {
        throw new Error("青少年产品必须选择已授权学员。");
      }
      const command: Record<string, any> = {
        productId: product.id,
        classId: trainingClass.id,
        sessionId: trialSession.id,
        coachId: trialCoachId.value.trim(),
        sourceChannel: trialSourceOptions[trialSourceIndex.value].value,
        scheduledStartsAt: trialSession.startsAt,
        scheduledEndsAt: trialSession.endsAt,
        reason,
      };
      if (trialSubjectIndex.value === 0) command.memberId = subject.id;
      if (trialSubjectIndex.value === 1) command.leadId = subject.id;
      if (trialSubjectIndex.value === 2) {
        command.studentId = subject.id;
        if (trialLinkLead.value && leads.value[trialLeadIndex.value]) {
          command.leadId = leads.value[trialLeadIndex.value].id;
        }
      }
      const confirmed = await uni.showModal({
        title: "确认预约试听",
        content: `${subject.displayName} · ${product.name}\n${shortDate(trialSession.startsAt)} · 教练 ${coachDisplayName(command.coachId)}\n原因：${reason}`,
        confirmText: "确认预约",
      });
      if (!confirmed.confirm) return;
      const succeeded = await runCreation(
        "create-trial",
        "试听预约已进入待到场队列。",
        () =>
          withPendingCreationKey(
            "training.trial.reserve",
            command,
            (idempotencyKey) =>
              endpoints.createTrainingTrial({ ...command, idempotencyKey }),
          ),
      );
      if (succeeded) trialReason.value = "";
    } catch (cause: any) {
      errorMessage.value = cause?.message || "试听预约校验失败。";
    }
  }

  function transitionTrial(
    trial: any,
    action: "check-in" | "no-show" | "lost" | "cancel",
  ) {
    if (actionKey.value) return;
    const labels = {
      "check-in": "确认到场",
      "no-show": "登记未到",
      lost: "确认流失",
      cancel: "取消试听",
    };
    task.start({
      title: labels[action],
      description:
        (trial.student?.name ||
          trial.member?.displayName ||
          trial.lead?.displayName ||
          "当前学员") + " · 按现场事实提交，时间窗口由服务器校验。",
      confirmText: labels[action],
      fields: [
        reasonField(
          "核实依据",
          action === "check-in"
            ? ["已核对学员本人到场"]
            : action === "no-show"
              ? ["已结束且未到场，已尝试联系"]
              : action === "lost"
                ? ["暂时无培训计划", "时间无法安排"]
                : ["学员行程有变", "场馆安排调整"],
        ),
      ],
      submit: async ({ reason }) => {
        if (action === "check-in" || action === "no-show") {
          const gate = await operationWindowReason({
            startsAt:
              action === "check-in"
                ? trial.scheduledStartsAt
                : trial.scheduledEndsAt,
            endsAt: trial.scheduledEndsAt,
            earlyMinutes: action === "check-in" ? 30 : 0,
            lateMinutes: action === "check-in" ? 120 : 240,
            reason,
            label: labels[action],
          });
          if (!gate.allowed)
            throw new Error("当前不在允许操作时间，请核对预约");
        }
        const handlers = {
          "check-in": endpoints.checkInTrainingTrial,
          "no-show": endpoints.noShowTrainingTrial,
          lost: endpoints.loseTrainingTrial,
          cancel: endpoints.cancelTrainingTrial,
        };
        await withPendingCreationKey(
          "training.trial." + trial.id + "." + action,
          { reason },
          (idempotencyKey) =>
            handlers[action](trial.id, { reason, idempotencyKey }),
        );
        await load();
        return "试听已" + labels[action] + "，状态与审计已记录。";
      },
    });
  }

  function assessTrial(trial: any) {
    if (!canAssessTrials.value || actionKey.value) return;
    const dimensions = [
      { key: "movement", label: "步法与移动" },
      { key: "racket", label: "持拍与击球" },
      { key: "fitness", label: "体能与协调" },
    ];
    task.start({
      title: "试听测评",
      description:
        (trial.student?.name ||
          trial.member?.displayName ||
          trial.lead?.displayName ||
          "当前学员") + " · 三项评分与训练建议一起提交。",
      confirmText: "确认提交测评",
      fields: [
        ...dimensions.map((item) => ({
          ...item,
          kind: "choices" as const,
          options: [1, 2, 3, 4, 5].map((score) => ({
            value: String(score),
            label: score + "分",
          })),
        })),
        { key: "recommendation", label: "分班或训练建议", min: 2, max: 500 },
      ],
      submit: async (values) => {
        const command = {
          dimensions: dimensions.map((item) => ({
            ...item,
            score: Number(values[item.key]),
          })),
          recommendation: values.recommendation,
          reason: "教练完成现场结构化测评",
        };
        await withPendingCreationKey(
          "training.trial." + trial.id + ".assess",
          command,
          (idempotencyKey) =>
            endpoints.assessTrainingTrial(trial.id, {
              ...command,
              idempotencyKey,
            }),
        );
        await load();
        return "测评已提交，等待管理员确认转正式课或后续跟进。";
      },
    });
  }

  function convertTrial(trial: any) {
    if (!canConvertTrials.value || actionKey.value) return;
    const candidates = enrollments.value.filter(
      (item) =>
        ["ACTIVE", "PARTIALLY_REFUNDED"].includes(item.status) &&
        (item.productId || item.product?.id) === trial.productId &&
        (trial.studentId
          ? item.studentId === trial.studentId &&
            item.buyerId === trial.guardianId
          : !item.studentId &&
            item.buyerId === (trial.memberId || trial.lead?.convertedMemberId)),
    );
    if (!candidates.length) {
      errorMessage.value =
        "请先完成同产品、同学员的正式报名与支付，再回来关联试听。";
      return;
    }
    task.start({
      title: "试听转正式课",
      description: "选择已付款的正式课合同，核对同一学员及产品后关联。",
      confirmText: "确认关联正式课",
      fields: [
        {
          key: "enrollmentId",
          label: "正式课合同",
          kind: "choices",
          initial: candidates.length === 1 ? candidates[0].id : "",
          options: candidates.map((item) => ({
            value: item.id,
            label: item.product?.name || trial.product?.name,
            description: item.enrollmentNo,
          })),
        },
      ],
      submit: async ({ enrollmentId }) => {
        const command = {
          enrollmentId,
          reason: "正式课已支付并完成试听归属核对",
        };
        await withPendingCreationKey(
          "training.trial." + trial.id + ".convert",
          command,
          (idempotencyKey) =>
            endpoints.convertTrainingTrial(trial.id, {
              ...command,
              idempotencyKey,
            }),
        );
        await load();
        return "试听已关联正式课，归属与转化记录已同步。";
      },
    });
  }

  function trialSourceLabel(source?: string) {
    return (
      trialSourceOptions.find((item) => item.value === source)?.label ||
      "其他渠道"
    );
  }
  return {
    changeTrialSession,
    setTrialLinkLead,
    createTrial,
    transitionTrial,
    assessTrial,
    convertTrial,
    trialSourceLabel,
  };
}
