import type { Ref, ComputedRef } from "vue";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import type { useOperationTask } from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey, venueDateKey } from "../../../../../utils/format";

interface ActionContext {
  purchaseForm: Ref<
    {
      batchCode: string;
    expiresAt: string;
    supplierId: string;
      itemId: string;
      locationId: string;
      quantity: string;
    },
    | {
        batchCode: string;
    expiresAt: string;
    supplierId: string;
        itemId: string;
        locationId: string;
        quantity: string;
      }
    | {
        batchCode: string;
    expiresAt: string;
    supplierId: string;
        itemId: string;
        locationId: string;
        quantity: string;
      }
  >;
  showPurchaseForm: Ref<boolean, boolean>;
  activeSuppliers: ComputedRef<any[]>;
  purchaseItems: ComputedRef<any[]>;
  activeLocations: ComputedRef<any[]>;
  validationError: (title: string) => null;
  formPositiveInteger: (value: string, emptyMessage?: string) => number | null;
  saving: Ref<boolean, boolean>;
  run: (action: () => Promise<unknown>, message: string) => Promise<boolean>;
  task: ReturnType<typeof useOperationTask>;
  load: () => Promise<void>;
  isAdmin: ComputedRef<boolean>;
}

export function useInventoryPurchasingActions({
  purchaseForm,
  showPurchaseForm,
  activeSuppliers,
  purchaseItems,
  activeLocations,
  validationError,
  formPositiveInteger,
  saving,
  run,
  task,
  load,
  isAdmin,
}: ActionContext) {
  function openPurchaseForm() {
    purchaseForm.value = {
      batchCode: "",
      expiresAt: "",
      supplierId: "",
      itemId: "",
      locationId: "",
      quantity: "",
    };
    showPurchaseForm.value = true;
  }

  function selectPurchaseSupplier(index: number) {
    purchaseForm.value.supplierId = activeSuppliers.value[index]?.id || "";
    purchaseForm.value.itemId = "";
    purchaseForm.value.batchCode = ""; purchaseForm.value.expiresAt = "";
  }

  function selectPurchaseItem(index: number) {
    const item = purchaseItems.value[index];
    purchaseForm.value.itemId = item?.id || "";
    purchaseForm.value.batchCode = item?.batchCode || "DEFAULT";
    purchaseForm.value.expiresAt = item?.expiresAt ? venueDateKey(item.expiresAt) : "";
    syncPurchaseBatch();
  }

  function selectPurchaseLocation(index: number) {
    purchaseForm.value.locationId = activeLocations.value[index]?.id || "";
    syncPurchaseBatch();
  }

  function syncPurchaseBatch() {
    const item = purchaseItems.value.find(entry => entry.id === purchaseForm.value.itemId);
    const balance = (item?.stockBalances || []).find((entry: any) => entry.locationId === purchaseForm.value.locationId && entry.batchCode === purchaseForm.value.batchCode.trim());
    if (balance) purchaseForm.value.expiresAt = balance.expiresAt ? venueDateKey(balance.expiresAt) : "";
  }

  async function submitPurchaseOrder() {
    const supplier = activeSuppliers.value.find(
      (entry) => entry.id === purchaseForm.value.supplierId,
    );
    if (!supplier) return validationError("请选择供应商");
    const item = purchaseItems.value.find(
      (entry) => entry.id === purchaseForm.value.itemId,
    );
    if (!item)
      return validationError(
        purchaseItems.value.length
          ? "请选择采购商品"
          : "该供应商暂无可采购商品",
      );
    const location = activeLocations.value.find(
      (entry) => entry.id === purchaseForm.value.locationId,
    );
    if (!location) return validationError("请选择收货库位");
    const quantity = formPositiveInteger(
      purchaseForm.value.quantity,
      "请输入采购数量",
    );
    if (!quantity) return;
    if (!purchaseForm.value.batchCode.trim()) return validationError("请填写本批采购批次");
    const expiry = purchaseForm.value.expiresAt;
    if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry)) || new Date(expiry).toISOString().slice(0, 10) !== expiry)) return validationError("请填写有效效期日期，格式 YYYY-MM-DD");
    const batchCode = purchaseForm.value.batchCode.trim();
    const existingBalance = (item.stockBalances || []).find((balance: any) => balance.locationId === location.id && balance.batchCode === batchCode);
    if (existingBalance && expiry !== (existingBalance.expiresAt ? venueDateKey(existingBalance.expiresAt) : '')) return validationError("该库位的已有批次效期不能变更，请核对实物或使用新批次编码");
    const expiresAt = existingBalance && expiry === (existingBalance.expiresAt ? venueDateKey(existingBalance.expiresAt) : '')
      ? existingBalance.expiresAt || undefined
      : expiry ? `${expiry}T23:59:59+08:00` : undefined;
    saving.value = true;
    const succeeded = await run(
      () =>
        endpoints.createPurchaseOrder({
          supplierId: supplier.id,
          lines: [
            {
              itemId: item.id,
              locationId: location.id,
              orderedQuantity: quantity,
              unitCostCents: item.purchasePriceCents,
              batchCode,
              ...(expiresAt ? { expiresAt } : {}),
            },
          ],
          remark: "小程序经营工作台制单",
        }),
      "采购单已建立",
    );
    saving.value = false;
    if (succeeded) showPurchaseForm.value = false;
  }

  function purchaseAction(order: any) {
    if (["DRAFT", "SUBMITTED"].includes(order.status)) {
      const submit = order.status === "DRAFT";
      task.start({
        title: submit ? "提交采购审批" : "批准采购单",
        description:
          (order.purchaseNo || order.orderNo || "当前采购单") +
          " · 请核对明细、供应商和数量。审批不会直接增加库存。",
        confirmText: submit ? "确认提交" : "确认批准",
        fields: [],
        submit: async () => {
          if (submit) await endpoints.submitPurchaseOrder(order.id);
          else await endpoints.approvePurchaseOrder(order.id);
          await load();
          return submit
            ? "采购已提交审批。"
            : "采购已审批，下一步按实收数量入库。";
        },
      });
      return;
    }
    const lines = (order.lines || []).filter(
      (line: any) => line.receivedQuantity < line.orderedQuantity,
    );
    if (!lines.length) return;
    task.start({
      title: "采购收货",
      description:
        "选择本次实际到货商品并填写数量；分批收货按实际入库，不默认收齐。",
      confirmText: "确认本批收货入账",
      fields: [
        {
          key: "lineId",
          label: "到货商品",
          kind: "choices",
          initial: lines.length === 1 ? lines[0].id : "",
          options: lines.map((line: any) => ({
            value: line.id,
            label: line.item?.name || "采购商品",
            description:
              "尚未收货 " + (line.orderedQuantity - line.receivedQuantity),
          })),
        },
        { key: "quantity", label: "实收数量", kind: "number" },
      ],
      submit: async ({ lineId, quantity }) => {
        const line = lines.find((item: any) => item.id === lineId);
        if (Number(quantity) > line.orderedQuantity - line.receivedQuantity)
          throw new Error("实收不能超过剩余采购数量");
        const command = { lines: [{ lineId, quantity: Number(quantity) }] };
        await withPendingCreationKey(
          "inventory.receipt." + order.id,
          command,
          (idempotencyKey) =>
            endpoints.receivePurchaseOrder(order.id, {
              ...command,
              idempotencyKey,
            }),
        );
        await load();
        return "本批收货已过账，采购进度与库存已同步。";
      },
    });
  }

  function purchaseActionLabel(order: any) {
    if (order.status === "DRAFT") return "提交";
    if (order.status === "SUBMITTED" && isAdmin.value) return "审批";
    if (["APPROVED", "PARTIAL_RECEIVED"].includes(order.status)) return "收货";
    return "";
  }
  return {
    syncPurchaseBatch,
    openPurchaseForm,
    selectPurchaseSupplier,
    selectPurchaseItem,
    selectPurchaseLocation,
    submitPurchaseOrder,
    purchaseAction,
    purchaseActionLabel,
  };
}
