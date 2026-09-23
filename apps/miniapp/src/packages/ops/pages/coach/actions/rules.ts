import { requiredReason, positiveInteger, yuanToCents } from "./validation";
import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey } from "../../../../../utils/format";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";

interface ActionContext {
  ruleHardBlock: Ref<boolean, boolean>;
  canDraftYouthRule: ComputedRef<boolean>;
  actionKey: Ref<string, string>;
  ruleReason: Ref<string, string>;
  ruleMaxSessions: Ref<string, string>;
  ruleMaxValidityDays: Ref<string, string>;
  ruleMaxAmountYuan: Ref<string, string>;
  ruleWarningDays: Ref<string, string>;
  ruleEffectiveImmediately: Ref<boolean>;
  ruleEffectiveDate: Ref<string, string>;
  ruleEffectiveTime: Ref<string, string>;
  runCreation: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
  ) => Promise<boolean>;
  errorMessage: Ref<string, string>;
  canReviewYouthRule: ComputedRef<boolean>;
  task: ReturnType<typeof useOperationTask>;
  load: () => Promise<void>;
}

export function useCoachRulesActions({
  ruleHardBlock,
  canDraftYouthRule,
  actionKey,
  ruleReason,
  ruleMaxSessions,
  ruleMaxValidityDays,
  ruleMaxAmountYuan,
  ruleWarningDays,
  ruleEffectiveImmediately,
  ruleEffectiveDate,
  ruleEffectiveTime,
  runCreation,
  errorMessage,
  canReviewYouthRule,
  task,
  load,
}: ActionContext) {
  function setRuleHardBlock(event: any) {
    ruleHardBlock.value = Boolean(event.detail.value);
  }

  async function createYouthRule() {
    if (!canDraftYouthRule.value || actionKey.value) return;
    try {
      const reason = requiredReason(
        ruleReason.value.trim() || "管理员设置课包限制",
      );
      const command = {
        maxTotalSessions: positiveInteger(ruleMaxSessions.value, "最大总课时"),
        maxValidityDays: positiveInteger(
          ruleMaxValidityDays.value,
          "最大有效期限",
        ),
        maxContractAmountCents: yuanToCents(
          ruleMaxAmountYuan.value,
          "单合同金额上限",
          true,
        ),
        warningThresholdDays: positiveInteger(
          ruleWarningDays.value,
          "到期预警阈值",
          0,
        ),
        hardBlock: ruleHardBlock.value,
        ...(ruleEffectiveImmediately.value
          ? { effectiveImmediately: true }
          : {
              effectiveFrom: `${ruleEffectiveDate.value}T${ruleEffectiveTime.value}:00+08:00`,
            }),
        reason,
      };
      if (command.warningThresholdDays > command.maxValidityDays) {
        throw new Error("到期预警阈值不能超过最大有效期限。");
      }
      const succeeded = await runCreation(
        "create-youth-rule",
        ruleEffectiveImmediately.value
          ? "课包限制已立即生效。"
          : "课包限制已发布，将按指定时间生效。",
        () =>
          withPendingCreationKey(
            "training.youth-rule.create",
            command,
            (idempotencyKey) =>
              endpoints.createYouthTrainingRule({ ...command, idempotencyKey }),
          ),
      );
      if (succeeded) {
        ruleMaxSessions.value = "";
        ruleMaxValidityDays.value = "";
        ruleMaxAmountYuan.value = "";
        ruleWarningDays.value = "0";
        ruleReason.value = "";
      }
      return succeeded;
    } catch (cause: any) {
      errorMessage.value = cause?.message || "课包限制表单校验失败。";
      return false;
    }
  }

  function decideYouthRule(rule: any, decision: "publish" | "reject") {
    if (!canReviewYouthRule.value || actionKey.value) return;
    task.start({
      title: decision === "publish" ? "发布监管规则" : "驳回监管草案",
      description:
        "请核对课时、有效期与金额边界。发布按生效时间启用，不改历史合同。",
      confirmText: decision === "publish" ? "确认发布" : "确认驳回",
      fields: [reasonField("操作原因")],
      submit: async ({ reason }) => {
        await withPendingCreationKey(
          "training.youth-rule." + rule.id + "." + decision,
          { reason, decision },
          (idempotencyKey) =>
            decision === "publish"
              ? endpoints.publishYouthTrainingRule(rule.id, {
                  reason,
                  idempotencyKey,
                })
              : endpoints.rejectYouthTrainingRule(rule.id, {
                  reason,
                  idempotencyKey,
                }),
        );
        await load();
        return decision === "publish"
          ? "规则已发布，将按生效时间启用。"
          : "规则草案已驳回。";
      },
    });
  }
  return { setRuleHardBlock, createYouthRule, decideYouthRule };
}
