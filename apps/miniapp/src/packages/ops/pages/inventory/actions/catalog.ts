import type { Ref, ComputedRef } from "vue";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { idempotencyKey, venueDateKey } from "../../../../../utils/format";
import type { MasterType } from "../page-types.js";

interface ActionContext {
  masterType: Ref<MasterType, MasterType>;
  showMasterForm: Ref<boolean, boolean>;
  detailId: Ref<string, string>;
  masterDetail: Ref<any, any>;
  isAdmin: ComputedRef<boolean>;
  editingMaster: Ref<any, any>;
  masterForm: Ref<any, any>;
  saving: Ref<boolean, boolean>;
  load: () => Promise<void>;
  task: ReturnType<typeof useOperationTask>;
}

export function useInventoryCatalogActions({
  masterType,
  showMasterForm,
  detailId,
  masterDetail,
  isAdmin,
  editingMaster,
  masterForm,
  saving,
  load,
  task,
}: ActionContext) {
  function selectMasterType(value: MasterType) {
    masterType.value = value;
    showMasterForm.value = false;
    detailId.value = "";
    masterDetail.value = null;
  }

  function openMasterForm(record?: any) {
    if (!isAdmin.value) return;
    editingMaster.value = record || null;
    const base = {
      reason: "",
      commandKey: idempotencyKey(
        `master-${masterType.value.toLowerCase()}-${record ? "update" : "create"}`,
      ),
    };
    if (masterType.value === "SUPPLIER") {
      masterForm.value = {
        ...base,
        code: record?.code || "",
        name: record?.name || "",
        type: record?.type || "OWNED",
        contactName: record?.contactName || "",
        contactPhone: record?.contactPhone || "",
        settlementCycle: record?.settlementRule?.settlementCycle || "MONTHLY",
        paymentTermsDays: String(
          record?.settlementRule?.paymentTermsDays ?? 30,
        ),
        commissionRatePercent: String(
          Number(record?.settlementRule?.commissionRateBps ?? 2500) / 100,
        ),
      };
    } else if (masterType.value === "LOCATION") {
      masterForm.value = {
        ...base,
        code: record?.code || "",
        name: record?.name || "",
      };
    } else {
      masterForm.value = {
        ...base,
        sku: record?.sku || "",
        name: record?.name || "",
        category: record?.category || "",
        mode: record?.mode || "PURCHASE",
        supplierId: record?.supplierId || "",
        defaultLocationId: record?.defaultLocationId || "",
        purchasePriceYuan: String(
          Number(record?.purchasePriceCents || 0) / 100,
        ),
        salePriceYuan: String(Number(record?.salePriceCents || 0) / 100),
        safeStock: String(record?.safeStock ?? 0),
        batchCode: record?.batchCode || "DEFAULT",
        expiresAt: record?.expiresAt
          ? venueDateKey(record.expiresAt)
          : "",
      };
    }
    showMasterForm.value = true;
  }

  function inventoryItemPayload(form: any) {
    if (!form.supplierId) throw new Error("请选择供应商");
    if (!form.defaultLocationId) throw new Error("请选择默认库位");
    const purchasePriceCents = Math.round(Number(form.purchasePriceYuan) * 100);
    const salePriceCents = Math.round(Number(form.salePriceYuan) * 100);
    const safeStock = Number(form.safeStock);
    if (
      !Number.isInteger(purchasePriceCents) ||
      purchasePriceCents < 0 ||
      !Number.isInteger(salePriceCents) ||
      salePriceCents < 0 ||
      !Number.isInteger(safeStock) ||
      safeStock < 0
    ) {
      throw new Error("进价、售价和安全库存必须为非负数");
    }
    const payload: Record<string, unknown> = {
      sku: form.sku,
      name: form.name,
      category: form.category,
      mode: form.mode,
      supplierId: form.supplierId,
      defaultLocationId: form.defaultLocationId,
      purchasePriceCents,
      salePriceCents,
      safeStock,
      batchCode: form.batchCode || "DEFAULT",
      expiresAt: form.expiresAt
        ? `${form.expiresAt}T23:59:59+08:00`
        : editingMaster.value
          ? null
          : undefined,
    };
    const original = editingMaster.value;
    if (original) {
      for (const key of Object.keys(payload)) {
        if (key === 'expiresAt' ? String(form.expiresAt || '') === (original.expiresAt ? venueDateKey(original.expiresAt) : '') : payload[key] === original[key]) delete payload[key];
      }
    }
    return payload;
  }

  function supplierPayload(form: any) {
    const settlementRule =
      form.type === "CONSIGNMENT"
        ? {
            settlementCycle: form.settlementCycle,
            commissionRateBps: Math.round(
              Number(form.commissionRatePercent) * 100,
            ),
          }
        : {
            settlementCycle: form.settlementCycle,
            paymentTermsDays: Number(form.paymentTermsDays),
          };
    return {
      code: form.code,
      name: form.name,
      type: form.type,
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      settlementRule,
    };
  }

  async function submitMasterForm() {
    const form = masterForm.value;
    if (!String(form.reason || "").trim())
      return uni.showToast({ title: "请填写变更原因", icon: "none" });
    const confirm = await uni.showModal({
      title: editingMaster.value ? "确认保存资料" : "确认新增资料",
      content: `${form.reason}\n关键变更将写入审计日志。`,
    });
    if (!confirm.confirm) return;
    saving.value = true;
    try {
      const command = {
        reason: String(form.reason).trim(),
        idempotencyKey: form.commandKey,
      };
      if (masterType.value === "ITEM") {
        const payload = { ...inventoryItemPayload(form), ...command };
        if (editingMaster.value) {
          await endpoints.updateInventoryItem(editingMaster.value.id, {
            ...payload,
            expectedUpdatedAt: editingMaster.value.updatedAt,
          });
        } else await endpoints.createInventoryItem(payload);
      } else if (masterType.value === "SUPPLIER") {
        const payload = { ...supplierPayload(form), ...command };
        if (editingMaster.value) {
          await endpoints.updateInventorySupplier(editingMaster.value.id, {
            ...payload,
            expectedUpdatedAt: editingMaster.value.updatedAt,
          });
        } else await endpoints.createInventorySupplier(payload);
      } else {
        const payload = { code: form.code, name: form.name, ...command };
        if (editingMaster.value) {
          await endpoints.updateInventoryLocation(editingMaster.value.id, {
            ...payload,
            expectedUpdatedAt: editingMaster.value.updatedAt,
          });
        } else await endpoints.createInventoryLocation(payload);
      }
      showMasterForm.value = false;
      uni.showToast({ title: "资料已保存", icon: "success" });
      await load();
    } catch (cause: any) {
      uni.showModal({
        title: "资料未保存",
        content: cause.message || "请核对字段和当前版本",
        showCancel: false,
      });
    } finally {
      saving.value = false;
    }
  }

  async function loadMasterDetail(record: any) {
    if (detailId.value === record.id) {
      detailId.value = "";
      masterDetail.value = null;
      return;
    }
    saving.value = true;
    try {
      masterDetail.value =
        masterType.value === "ITEM"
          ? await endpoints.inventoryItemDetail(record.id)
          : masterType.value === "SUPPLIER"
            ? await endpoints.inventorySupplierDetail(record.id)
            : await endpoints.inventoryLocationDetail(record.id);
      detailId.value = record.id;
    } catch (cause: any) {
      uni.showToast({ title: cause.message || "详情加载失败", icon: "none" });
    } finally {
      saving.value = false;
    }
  }

  function toggleMasterStatus(record: any) {
    const enabling = record.enabled === false,
      type = masterType.value;
    task.start({
      title: enabling ? "启用基础资料" : "停用基础资料",
      description:
        record.name +
        (enabling
          ? " · 启用后可用于新业务。"
          : " · 服务器检查库存和未完成作业，历史不删除。"),
      confirmText: enabling ? "确认启用" : "确认停用",
      fields: [reasonField("变更依据")],
      submit: async ({ reason }) => {
        const command = {
          enabled: enabling,
          expectedUpdatedAt: record.updatedAt,
          reason,
        };
        await withPendingCreationKey(
          "inventory.master." + type + "." + record.id,
          command,
          (idempotencyKey) => {
            const payload = { ...command, idempotencyKey };
            return type === "ITEM"
              ? endpoints.setInventoryItemStatus(record.id, payload)
              : type === "SUPPLIER"
                ? endpoints.setInventorySupplierStatus(record.id, payload)
                : endpoints.setInventoryLocationStatus(record.id, payload);
          },
        );
        await load();
        return "基础资料状态已更新，关联历史保留。";
      },
    });
  }
  return {
    selectMasterType,
    openMasterForm,
    inventoryItemPayload,
    supplierPayload,
    submitMasterForm,
    loadMasterDetail,
    toggleMasterStatus,
  };
}
