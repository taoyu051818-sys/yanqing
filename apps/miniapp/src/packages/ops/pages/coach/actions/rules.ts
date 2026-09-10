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
      const reason = requiredReason(ruleReason.value);
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
        effectiveFrom: `${ruleEffectiveDate.value}T${ruleEffectiveTime.value}:00+08:00`,
        reason,
      };
      if (command.warningThresholdDays > command.maxValidityDays) {
        throw new Error("到期预警阈值不能超过最大有效期限。");
      }
      const confirmation = await uni.showModal({
        title: "提交监管规则草案",
        content: `所有数值均来自本次管理员配置，不代表系统内置法定值。\n生效：${ruleEffectiveDate.value} ${ruleEffectiveTime.value}\n提交后须由另一 SUPER_ADMIN 复核。`,
        confirmText: "确认制单",
      });
      if (!confirmation.confirm) return;
      const succeeded = await runCreation(
        "create-youth-rule",
        "监管规则草案已提交，等待异人复核。",
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
        ruleWarningDays.value = "";
        ruleReason.value = "";
      }
    } catch (cause: any) {
      errorMessage.value = cause?.message || "监管规则表单校验失败。";
    }
  }

  function decideYouthRule(rule: any, decision: "publish" | "reject") {
    if (!canReviewYouthRule.value || actionKey.value) return;
    task.start({
      title: decision === "publish" ? "复核发布监管规则" : "驳回监管草案",
      description:
        "须由独立复核人核对课时、有效期与金额边界。发布按生效时间启用，不改历史合同。",
      confirmText: decision === "publish" ? "确认复核发布" : "确认驳回",
      fields: [reasonField("独立复核意见")],
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
          ? "规则已复核发布，将按生效时间启用。"
          : "规则草案已驳回。";
      },
    });
  }
  return { setRuleHardBlock, createYouthRule, decideYouthRule };
}
