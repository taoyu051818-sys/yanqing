import type { Ref, ComputedRef } from "vue";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import type { useOperationTask } from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey } from "../../../../../utils/format";

interface ActionContext {
  stocktakeForm: Ref<
    { locationId: string; reason: string },
    | { locationId: string; reason: string }
    | { locationId: string; reason: string }
  >;
  showStocktakeForm: Ref<boolean, boolean>;
  activeLocations: ComputedRef<any[]>;
  validationError: (title: string) => null;
  saving: Ref<boolean, boolean>;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
  task: ReturnType<typeof useOperationTask>;
  load: () => Promise<void>;
}

export function useInventoryStocktakingActions({
  stocktakeForm,
  showStocktakeForm,
  activeLocations,
  validationError,
  saving,
  run,
  task,
  load,
}: ActionContext) {
  function openStocktakeForm() {
    stocktakeForm.value = { locationId: "", reason: "" };
    showStocktakeForm.value = true;
  }

  function selectStocktakeLocation(index: number) {
    stocktakeForm.value.locationId = activeLocations.value[index]?.id || "";
  }

  async function submitStocktake() {
    const location = activeLocations.value.find(
      (entry) => entry.id === stocktakeForm.value.locationId,
    );
    if (!location) return validationError("请选择盘点库位");
    const reason = stocktakeForm.value.reason.trim();
    if (!reason) return validationError("请填写盘点原因");
    saving.value = true;
    const succeeded = await run(
      () =>
        endpoints.createStocktake({
          locationId: location.id,
          reason,
        }),
      "盘点单已建立",
    );
    saving.value = false;
    if (succeeded) showStocktakeForm.value = false;
  }

  function stocktakeAction(document: any) {
    if (document.status === "COUNTING") {
      const lines = document.lines.filter(
        (line: any) => line.countedQuantity === null,
      );
      if (lines.length) {
        task.start({
          title: "登记实盘数量",
          description:
            "选择本次已清点商品，账面数量仅供核对。录入不会立即改变库存，差异须复核后过账。",
          confirmText: "确认保存实盘数",
          fields: [
            {
              key: "lineId",
              label: "已清点商品",
              kind: "choices",
              initial: lines.length === 1 ? lines[0].id : "",
              options: lines.map((line: any) => ({
                value: line.id,
                label: line.item?.name || "商品",
                description: "账面 " + line.bookQuantity,
              })),
            },
            {
              key: "counted",
              label: "实际数量（可填0）",
              kind: "number",
              min: 0,
            },
          ],
          submit: async ({ lineId, counted }) => {
            await endpoints.countStocktakeLine(
              document.id,
              lineId,
              Number(counted),
            );
            await load();
            return "实盘数已保存，请继续清点剩余商品。";
          },
        });
        return;
      }
    }
    const label =
      document.status === "DRAFT"
        ? "开始盘点"
        : document.status === "COUNTING"
          ? "提交盘点复核"
          : "复核并过账差异";
    task.start({
      title: label,
      description:
        "当前盘点单 · 过账将按已复核差异更新库存，并保留不可覆盖的流水。",
      confirmText: "确认" + label,
      fields: [],
      submit: async () => {
        if (document.status === "DRAFT")
          await endpoints.startStocktake(document.id);
        else if (document.status === "COUNTING")
          await endpoints.submitStocktake(document.id);
        else
          await withPendingCreationKey(
            "inventory.stocktake." + document.id,
            { documentId: document.id },
            (idempotencyKey) =>
              endpoints.postStocktake(document.id, idempotencyKey),
          );
        await load();
        return "盘点单已" + label + "。";
      },
    });
  }
  return {
    openStocktakeForm,
    selectStocktakeLocation,
    submitStocktake,
    stocktakeAction,
  };
}
