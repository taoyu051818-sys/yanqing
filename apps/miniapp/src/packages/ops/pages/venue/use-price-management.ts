import { computed, onMounted, onUnmounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import type {
  ApplyVenuePriceCommand,
  VenuePriceRule,
  VenuePriceTimeSlot,
} from "@yanqing/shared";
import { endpoints } from "../../../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../../../services/auth-session";
import { withPendingCreationKey } from "../../../../utils/pending-creation-key";
import { useUnsavedForm } from "../../composables/use-unsaved-form";
import { priceForm, priceCommand, priceStatus } from "./price-editor";

export function usePriceManagement(props: {
  editing: boolean;
  sourceId: string;
  canManage: boolean;
}) {
  const rules = ref<VenuePriceRule[]>([]),
    slots = ref<VenuePriceTimeSlot[]>([]);
  const source = ref<VenuePriceRule | null>(null),
    form = ref(priceForm(null));
  const loading = ref(false),
    busy = ref(false),
    loadError = ref(""),
    error = ref("");
  const advanced = ref(false),
    history = ref(false),
    initialized = ref(false);
  const preview = ref<Omit<ApplyVenuePriceCommand, "idempotencyKey"> | null>(
    null,
  );
  const saved = ref<VenuePriceRule | null>(null);
  const expandedId = ref("");
  const stoppingPrice = ref<VenuePriceRule | null>(null);
  const { markSaved } = useUnsavedForm(
    () => form.value,
    () => props.editing && initialized.value,
  );
  const currentRules = computed(() =>
    rules.value.filter((rule) =>
      ["使用中", "待生效"].includes(priceStatus(rule)),
    ),
  );
  const otherRules = computed(() =>
    rules.value.filter((rule) => !currentRules.value.includes(rule)),
  );
  const slotOptions = computed(() => [
    { id: "", label: "默认价（未单独定价的时段）", enabled: true },
    ...slots.value.filter((slot) => slot.enabled),
  ]);
  const slotIndex = computed(() =>
    Math.max(
      0,
      slotOptions.value.findIndex((s) => s.id === form.value.timeSlotId),
    ),
  );
  const slotLabel = computed(
    () =>
      source.value?.timeSlot?.label ||
      slotOptions.value.find((s) => s.id === form.value.timeSlotId)?.label ||
      "未单独定价的时段",
  );
  let alive = true;
  async function load() {
    if (loading.value) return;
    const owner = captureAuthSession();
    loading.value = true;
    loadError.value = "";
    try {
      const [prices, timeSlots] = await Promise.all([
        endpoints.managePriceRules(),
        endpoints.venueTimeSlots(),
      ]);
      if (!alive || !isAuthSessionCurrent(owner)) return;
      rules.value = prices;
      slots.value = timeSlots;
      if (props.editing && !initialized.value) {
        source.value = props.sourceId
          ? prices.find((rule) => rule.id === props.sourceId) || null
          : null;
        if (props.sourceId && !source.value)
          throw new Error("未找到原价格，请返回列表重新选择");
        form.value = priceForm(source.value);
        initialized.value = true;
        markSaved();
      }
    } catch (cause: any) {
      if (alive && isAuthSessionCurrent(owner))
        loadError.value = cause?.message || "价格加载失败，请重试";
    } finally {
      loading.value = false;
    }
  }
  function open(id = "") {
    uni.navigateTo({
      url: `/packages/ops/pages/venue/index?view=create-price&source=${encodeURIComponent(id)}`,
    });
  }
  function back() {
    uni.navigateBack({
      fail: () =>
        uni.redirectTo({ url: "/packages/ops/pages/venue/index?view=pricing" }),
    });
  }
  function review() {
    if (
      !props.canManage ||
      busy.value ||
      loading.value ||
      loadError.value ||
      !initialized.value
    )
      return;
    error.value = "";
    try {
      preview.value = priceCommand(form.value, source.value);
    } catch (cause: any) {
      error.value = cause.message;
      if (error.value.includes("新客")) advanced.value = true;
    }
  }
  async function confirm() {
    if (!preview.value || busy.value || !props.canManage) return;
    const command = { ...preview.value },
      owner = captureAuthSession();
    busy.value = true;
    error.value = "";
    try {
      const result = await withPendingCreationKey(
        "venue.price.apply",
        command,
        (idempotencyKey) =>
          endpoints.applyVenuePrice({ ...command, idempotencyKey }),
      );
      if (!alive || !isAuthSessionCurrent(owner)) return;
      markSaved();
      preview.value = null;
      saved.value = result;
    } catch (cause: any) {
      if (alive && isAuthSessionCurrent(owner))
        error.value = cause?.message || "修改未完成，请重试";
    } finally {
      busy.value = false;
    }
  }
  async function stopPrice(reason: string) {
    const rule = stoppingPrice.value;
    if (!rule || busy.value || !props.canManage) return;
    const owner = captureAuthSession();
    busy.value = true;
    error.value = "";
    try {
      const command = { priceRuleId: rule.id, enabled: false, reason };
      await withPendingCreationKey(
        "venue.price-rule.status." + rule.id,
        command,
        (idempotencyKey) =>
          endpoints.setPriceRuleStatus(rule.id, {
            enabled: false,
            reason,
            idempotencyKey,
          }),
      );
      if (!alive || !isAuthSessionCurrent(owner)) return;
      stoppingPrice.value = null;
      await load();
    } catch (cause: any) {
      if (alive && isAuthSessionCurrent(owner))
        error.value = cause?.message || "停用未完成，请重试";
    } finally {
      busy.value = false;
    }
  }
  function toggleDay(bit: number) {
    const next = form.value.weekdayMask ^ bit;
    if (next) form.value.weekdayMask = next;
  }
  onMounted(load);
  onShow(() => {
    if (!props.editing || !initialized.value) void load();
  });
  onUnmounted(() => {
    alive = false;
  });

  return {
    rules,
    source,
    form,
    loading,
    busy,
    loadError,
    error,
    advanced,
    history,
    initialized,
    preview,
    saved,
    currentRules,
    otherRules,
    slotOptions,
    slotIndex,
    slotLabel,
    load,
    open,
    back,
    review,
    confirm,
    toggleDay,
    expandedId,
    stoppingPrice,
    stopPrice,
  };
}
