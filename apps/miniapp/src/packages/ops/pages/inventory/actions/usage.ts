import type { Ref, ComputedRef } from "vue";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey } from "../../../../../utils/format";
import type { UsageType } from "../page-types.js";

interface ActionContext {
  usageForm: Ref<
    { type: UsageType; itemId: string; referenceId: string; quantity: string },
    | { type: UsageType; itemId: string; referenceId: string; quantity: string }
    | { type: UsageType; itemId: string; referenceId: string; quantity: string }
  >;
  showUsageForm: Ref<boolean, boolean>;
  eligibleUsageReferences: ComputedRef<any[]>;
  activeItems: ComputedRef<any[]>;
  validationError: (title: string) => null;
  formPositiveInteger: (value: string, emptyMessage?: string) => number | null;
  saving: Ref<boolean, boolean>;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
}

export function useInventoryUsageActions({
  usageForm,
  showUsageForm,
  eligibleUsageReferences,
  activeItems,
  validationError,
  formPositiveInteger,
  saving,
  run,
}: ActionContext) {
  function usageReferenceLabel(type: UsageType, entry: any) {
    if (type === "TRAINING_USAGE") {
      const name = entry.class?.name || entry.name || "培训课次";
      return `${name} · ${new Date(entry.startsAt).toLocaleDateString()}`;
    }
    return `${entry.name || entry.code || "赛事"} · ${entry.status}`;
  }

  function openUsageForm(item: any, type: UsageType) {
    usageForm.value = {
      type,
      itemId: item.id,
      referenceId: "",
      quantity: "",
    };
    showUsageForm.value = true;
  }

  function selectUsageReference(index: number) {
    usageForm.value.referenceId =
      eligibleUsageReferences.value[index]?.id || "";
  }

  async function submitUsage() {
    const item = activeItems.value.find(
      (entry) => entry.id === usageForm.value.itemId,
    );
    if (!item) return validationError("请选择要领用的商品");
    const selected = eligibleUsageReferences.value.find(
      (entry: any) => entry.id === usageForm.value.referenceId,
    );
    if (!selected)
      return validationError(
        usageForm.value.type === "TRAINING_USAGE"
          ? "请选择关联课次"
          : "请选择关联赛事",
      );
    const quantity = formPositiveInteger(
      usageForm.value.quantity,
      "请输入领用数量",
    );
    if (!quantity) return;
    if (quantity > Number(item.stock || 0)) {
      return uni.showToast({ title: "库存不足", icon: "none" });
    }
    const referenceLabel = usageReferenceLabel(usageForm.value.type, selected);
    saving.value = true;
    const succeeded = await run(
      () =>
        endpoints.inventoryTransaction(item.id, {
          type: usageForm.value.type,
          quantity: -quantity,
          referenceType:
            usageForm.value.type === "TRAINING_USAGE"
              ? "TrainingSession"
              : "Event",
          referenceId: selected.id,
          reason: `${referenceLabel}物料领用`,
          idempotencyKey: idempotencyKey(
            `${usageForm.value.type.toLowerCase()}-${item.id}-${selected.id}`,
          ),
        }),
      "领用已过账",
    );
    saving.value = false;
    if (succeeded) showUsageForm.value = false;
  }
  return {
    usageReferenceLabel,
    openUsageForm,
    selectUsageReference,
    submitUsage,
  };
}
