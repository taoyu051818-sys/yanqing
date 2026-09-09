import type { Ref, ComputedRef } from "vue";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey } from "../../../../../utils/format";
import type { MovementType } from "../page-types.js";

interface ActionContext {
  movementType: Ref<MovementType, MovementType>;
  movementForm: Ref<
    {
      itemId: string;
      sourceLocationId: string;
      targetLocationId: string;
      quantity: string;
      reason: string;
    },
    | {
        itemId: string;
        sourceLocationId: string;
        targetLocationId: string;
        quantity: string;
        reason: string;
      }
    | {
        itemId: string;
        sourceLocationId: string;
        targetLocationId: string;
        quantity: string;
        reason: string;
      }
  >;
  showMovementForm: Ref<boolean, boolean>;
  activeItems: ComputedRef<any[]>;
  activeLocations: ComputedRef<any[]>;
  movementTargetLocations: ComputedRef<any[]>;
  validationError: (title: string) => null;
  formPositiveInteger: (value: string, emptyMessage?: string) => number | null;
  saving: Ref<boolean, boolean>;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
  isAdmin: ComputedRef<boolean>;
}

export function useInventoryMovementsActions({
  movementType,
  movementForm,
  showMovementForm,
  activeItems,
  activeLocations,
  movementTargetLocations,
  validationError,
  formPositiveInteger,
  saving,
  run,
  isAdmin,
}: ActionContext) {
  function openMovementForm(type: MovementType) {
    movementType.value = type;
    movementForm.value = {
      itemId: "",
      sourceLocationId: "",
      targetLocationId: "",
      quantity: "",
      reason: "",
    };
    showMovementForm.value = true;
  }

  function selectMovementItem(index: number) {
    movementForm.value.itemId = activeItems.value[index]?.id || "";
  }

  function selectMovementSource(index: number) {
    movementForm.value.sourceLocationId =
      activeLocations.value[index]?.id || "";
    movementForm.value.targetLocationId = "";
  }

  function selectMovementTarget(index: number) {
    movementForm.value.targetLocationId =
      movementTargetLocations.value[index]?.id || "";
  }

  async function submitMovement() {
    const item = activeItems.value.find(
      (entry) => entry.id === movementForm.value.itemId,
    );
    if (!item) return validationError("请选择商品");
    const source = activeLocations.value.find(
      (entry) => entry.id === movementForm.value.sourceLocationId,
    );
    if (!source) return validationError("请选择来源库位");
    const target = movementTargetLocations.value.find(
      (entry) => entry.id === movementForm.value.targetLocationId,
    );
    if (movementType.value === "TRANSFER" && !target)
      return validationError("请选择目标库位");
    const quantity = formPositiveInteger(
      movementForm.value.quantity,
      `请输入${movementType.value === "TRANSFER" ? "调拨" : "报损"}数量`,
    );
    if (!quantity) return;
    if (quantity > Number(item.stock || 0))
      return validationError("操作数量不能超过当前库存");
    const reason = movementForm.value.reason.trim();
    if (!reason)
      return validationError(
        `请填写${movementType.value === "TRANSFER" ? "调拨" : "报损"}原因`,
      );
    saving.value = true;
    const succeeded = await run(
      () =>
        endpoints.createInventoryOperation({
          type: movementType.value,
          itemId: item.id,
          quantity,
          sourceLocationId: source.id,
          ...(movementType.value === "TRANSFER"
            ? { targetLocationId: target?.id }
            : {}),
          batchCode: item.batchCode || "DEFAULT",
          reason,
        }),
      `${movementType.value === "TRANSFER" ? "调拨" : "报损"}单已建立`,
    );
    saving.value = false;
    if (succeeded) showMovementForm.value = false;
  }

  async function movementAction(document: any) {
    if (document.status === "DRAFT")
      return run(
        () => endpoints.submitInventoryOperation(document.id),
        "已提交审批",
      );
    if (document.status === "SUBMITTED")
      return run(
        () => endpoints.approveInventoryOperation(document.id),
        "单据已审批",
      );
    if (document.status === "APPROVED")
      return run(
        () =>
          endpoints.postInventoryOperation(
            document.id,
            idempotencyKey(`operation-${document.id}`),
          ),
        "库存单据已过账",
      );
  }

  function movementActionLabel(document: any) {
    if (document.status === "DRAFT") return "提交";
    if (document.status === "SUBMITTED" && isAdmin.value) return "审批";
    if (document.status === "APPROVED") return "过账";
    return "";
  }
  return {
    openMovementForm,
    selectMovementItem,
    selectMovementSource,
    selectMovementTarget,
    submitMovement,
    movementAction,
    movementActionLabel,
  };
}
