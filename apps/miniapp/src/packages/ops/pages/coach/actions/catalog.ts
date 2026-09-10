import { requiredReason, positiveInteger, yuanToCents } from "./validation";
import type { TrainingProductView } from "@yanqing/shared";
import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey, money } from "../../../../../utils/format";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";

interface ActionContext {
  canConfigureTraining: ComputedRef<boolean>;
  actionKey: Ref<string, string>;
  errorMessage: Ref<string, string>;
  productCode: Ref<string, string>;
  productName: Ref<string, string>;
  productReason: Ref<string, string>;
  audienceOptions: { label: string; value: string }[];
  productAudienceIndex: Ref<number, number>;
  productTotalSessions: Ref<string, string>;
  productValidityDays: Ref<string, string>;
  productPriceYuan: Ref<string, string>;
  runCreation: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
  ) => Promise<boolean>;
  editingProductId: Ref<string, string>;
  editProductName: Ref<string, string>;
  editProductTotalSessions: Ref<string, string>;
  editProductValidityDays: Ref<string, string>;
  editProductPriceYuan: Ref<string, string>;
  editProductReason: Ref<string, string>;
  task: ReturnType<typeof useOperationTask>;
  load: () => Promise<void>;
  actionMessage: Ref<string, string>;
  selectedClassProduct: ComputedRef<any>;
  classCode: Ref<string, string>;
  className: Ref<string, string>;
  classReason: Ref<string, string>;
  classEndTime: Ref<string, string>;
  classStartTime: Ref<string, string>;
  classCoachId: Ref<string, string>;
  classAssistantId: Ref<string, string>;
  classWeekdayIndex: Ref<number, number>;
  classCapacity: Ref<string, string>;
  classCoachCostYuan: Ref<string, string>;
  classAssistantCostYuan: Ref<string, string>;
  classMaterialCostYuan: Ref<string, string>;
  weekdayOptions: string[];
  coachOptions: ComputedRef<any[]>;
}

export function useCoachCatalogActions({
  canConfigureTraining,
  actionKey,
  errorMessage,
  productCode,
  productName,
  productReason,
  audienceOptions,
  productAudienceIndex,
  productTotalSessions,
  productValidityDays,
  productPriceYuan,
  runCreation,
  editingProductId,
  editProductName,
  editProductTotalSessions,
  editProductValidityDays,
  editProductPriceYuan,
  editProductReason,
  task,
  load,
  actionMessage,
  selectedClassProduct,
  classCode,
  className,
  classReason,
  classEndTime,
  classStartTime,
  classCoachId,
  classAssistantId,
  classWeekdayIndex,
  classCapacity,
  classCoachCostYuan,
  classAssistantCostYuan,
  classMaterialCostYuan,
  weekdayOptions,
  coachOptions,
}: ActionContext) {
  async function createProduct() {
    if (!canConfigureTraining.value || actionKey.value) return;
    errorMessage.value = "";
    try {
      const code = productCode.value.trim().toUpperCase();
      const name = productName.value.trim();
      const reason = requiredReason(productReason.value);
      if (!code || code.length > 40 || !name || name.length > 100) {
        throw new Error(
          "产品编码和名称不能为空，编码最多 40 字符、名称最多 100 字符。",
        );
      }
      const command = {
        code,
        name,
        audience: audienceOptions[productAudienceIndex.value].value,
        totalSessions: positiveInteger(productTotalSessions.value, "总课次"),
        validityDays: positiveInteger(productValidityDays.value, "有效期天数"),
        priceCents: yuanToCents(productPriceYuan.value, "课程售价", true),
        refundRule: {
          beforeStart: "FULL_REFUND",
          afterStart: "REFUND_UNUSED_SESSIONS",
        },
        reason,
      };
      const modal = await uni.showModal({
        title: "确认创建课程产品",
        content: `${name}\n${command.totalSessions} 课次 · 有效 ${command.validityDays} 天 · ${money(command.priceCents)}\n原因：${reason}`,
        confirmText: "确认创建",
      });
      if (!modal.confirm) return;
      const succeeded = await runCreation(
        "create-product",
        "课程产品已创建并写入审计记录。",
        () =>
          withPendingCreationKey(
            "training.product.create",
            command,
            (creationIdempotencyKey) =>
              endpoints.createTrainingProduct({
                ...command,
                creationIdempotencyKey,
              }),
          ),
      );
      if (succeeded) {
        productCode.value = "";
        productName.value = "";
        productReason.value = "";
      }
    } catch (cause: any) {
      errorMessage.value = cause?.message || "课程产品表单校验失败。";
    }
  }

  function beginProductEdit(product: TrainingProductView) {
    editingProductId.value = product.id;
    editProductName.value = product.name || "";
    editProductTotalSessions.value = String(product.totalSessions || "");
    editProductValidityDays.value = String(product.validityDays || "");
    editProductPriceYuan.value = (
      Number(product.priceCents || 0) / 100
    ).toFixed(2);
    editProductReason.value = "";
  }

  function cancelProductEdit() {
    editingProductId.value = "";
    editProductReason.value = "";
  }

  async function updateProduct(
    product: TrainingProductView,
    enabled = product.enabled !== false,
  ) {
    if (!canConfigureTraining.value || actionKey.value) return;
    errorMessage.value = "";
    try {
      const isEditing = editingProductId.value === product.id;
      let reason = editProductReason.value;
      if (!isEditing) {
        task.start({
          title: enabled ? "启用课程产品" : "停用课程产品",
          description:
            product.name +
            (enabled
              ? " · 恢复销售与开班。"
              : " · 停止后续销售，历史订单和课包不删除。"),
          confirmText: enabled ? "确认启用" : "确认停用",
          fields: [reasonField("变更依据")],
          submit: async ({ reason }) => {
            await withPendingCreationKey(
              "training.product.status." + product.id,
              { enabled, reason },
              (idempotencyKey) =>
                endpoints.updateTrainingProduct(product.id, {
                  enabled,
                  reason,
                  idempotencyKey,
                }),
            );
            await load();
            return "课程产品状态已更新，审计已记录。";
          },
        });
        return;
      }
      reason = requiredReason(reason);
      const command = isEditing
        ? {
            name: editProductName.value.trim(),
            totalSessions: positiveInteger(
              editProductTotalSessions.value,
              "总课次",
            ),
            validityDays: positiveInteger(
              editProductValidityDays.value,
              "有效期天数",
            ),
            priceCents: yuanToCents(
              editProductPriceYuan.value,
              "课程售价",
              true,
            ),
            enabled,
            reason,
          }
        : { enabled, reason };
      if ("name" in command && (!command.name || command.name.length > 100)) {
        throw new Error("产品名称不能为空且最多 100 个字符。");
      }
      const modal = await uni.showModal({
        title: isEditing
          ? "确认保存课程设置"
          : `确认${enabled ? "启用" : "停用"}课程产品`,
        content: isEditing
          ? `${command.name}\n${command.totalSessions} 课次 · 有效 ${command.validityDays} 天 · ${money(command.priceCents)}\n原因：${reason}`
          : `${product.name}\n${enabled ? "启用后可继续销售和开班。" : "停用后不再对会员销售，历史订单和课包不会删除。"}\n原因：${reason}`,
        confirmText: isEditing ? "保存设置" : enabled ? "确认启用" : "确认停用",
      });
      if (!modal.confirm) return;
      actionKey.value = `product-update:${product.id}`;
      uni.showLoading({ title: "保存中", mask: true });
      await endpoints.updateTrainingProduct(product.id, {
        ...command,
        idempotencyKey: idempotencyKey(`training-product-${product.id}`),
      });
      actionMessage.value = `${product.name} 的课程设置已更新并写入审计记录。`;
      cancelProductEdit();
      await load();
      uni.showToast({ title: "设置已保存", icon: "success" });
    } catch (cause: any) {
      errorMessage.value = cause?.message || "课程产品设置保存失败。";
    } finally {
      uni.hideLoading();
      actionKey.value = "";
    }
  }

  async function createClass() {
    if (!canConfigureTraining.value || actionKey.value) return;
    errorMessage.value = "";
    try {
      const product = selectedClassProduct.value;
      const code = classCode.value.trim().toUpperCase();
      const name = className.value.trim();
      const reason = requiredReason(classReason.value);
      if (!product) throw new Error("请先创建并选择一个有效课程产品。");
      if (!code || code.length > 40 || !name || name.length > 100) {
        throw new Error(
          "班级编码和名称不能为空，编码最多 40 字符、名称最多 100 字符。",
        );
      }
      if (classEndTime.value <= classStartTime.value) {
        throw new Error("班级常规结束时间必须晚于开始时间。");
      }
      const command = {
        code,
        productId: product.id,
        name,
        coachId: classCoachId.value.trim() || undefined,
        assistantId: classAssistantId.value.trim() || undefined,
        schedule: {
          weekday: classWeekdayIndex.value + 1,
          startsAt: classStartTime.value,
          endsAt: classEndTime.value,
        },
        capacity: positiveInteger(classCapacity.value, "班级容量", 1, 100),
        coachCostCents: yuanToCents(classCoachCostYuan.value, "教练单课成本"),
        assistantCostCents: yuanToCents(
          classAssistantCostYuan.value,
          "助教单课成本",
        ),
        materialCostCents: yuanToCents(
          classMaterialCostYuan.value,
          "单课物料成本",
        ),
        reason,
      };
      const modal = await uni.showModal({
        title: "确认创建培训班级",
        content: `${name}\n${product.name} · ${weekdayOptions[classWeekdayIndex.value]} ${classStartTime.value}-${classEndTime.value}\n容量 ${command.capacity} 人 · 原因：${reason}`,
        confirmText: "确认创建",
      });
      if (!modal.confirm) return;
      const succeeded = await runCreation(
        "create-class",
        "培训班级已创建，可继续为其安排课次。",
        () =>
          withPendingCreationKey(
            "training.class.create",
            command,
            (creationIdempotencyKey) =>
              endpoints.createTrainingClass({
                ...command,
                creationIdempotencyKey,
              }),
          ),
      );
      if (succeeded) {
        classCode.value = "";
        className.value = "";
        classReason.value = "";
      }
    } catch (cause: any) {
      errorMessage.value = cause?.message || "培训班级表单校验失败。";
    }
  }

  function changeClassCoach(event: any) {
    classCoachId.value =
      coachOptions.value[Number(event.detail.value)]?.id || "";
  }

  function changeClassAssistant(event: any) {
    classAssistantId.value =
      coachOptions.value[Number(event.detail.value)]?.id || "";
  }
  return {
    createProduct,
    beginProductEdit,
    cancelProductEdit,
    updateProduct,
    createClass,
    changeClassCoach,
    changeClassAssistant,
  };
}
