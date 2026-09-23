import { computed, ref, type Ref } from "vue";
import { endpoints } from "../../services/api";
import type { CourtAvailability } from "../../types/domain";
import { today } from "../../utils/format";

/** Availability and selection are one task; stale date responses cannot replace the active grid. */
export function useBookingAvailability({
  assisted,
  isSubmitting,
  onSelectionChange,
}: {
  assisted: Readonly<Ref<boolean>>;
  isSubmitting: () => boolean;
  onSelectionChange: () => void;
}) {
  const date = ref(today());
  const showAllDay = ref(false);
  const visibleSlots = computed(() =>
    !data.value
      ? []
      : showAllDay.value || date.value !== today()
        ? data.value.slots
        : data.value.slots.filter(
            (slot) =>
              (assisted.value ? slotTimes(slot).end : slotTimes(slot).start) >
              Date.now(),
          ),
  );
  const data = ref<CourtAvailability | null>(null);
  const loading = ref(false);
  const selected = ref<{ courtId: string; slotId: string } | null>(null);
  const error = ref("");

  const selectedSlot = computed(() =>
    data.value?.slots.find((slot) => slot.id === selected.value?.slotId),
  );
  const selectedCourt = computed(() =>
    data.value?.courts.find((court) => court.id === selected.value?.courtId),
  );

  function slotRange(slot: CourtAvailability["slots"][number]) {
    const format = (minutes: number) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return `${format(slot.startMinutes)}-${format(slot.endMinutes)}`;
  }

  function slotTimes(slot: CourtAvailability["slots"][number]) {
    const atMinutes = (minutes: number) => {
      return (
        new Date(`${date.value}T00:00:00+08:00`).getTime() + minutes * 60_000
      );
    };
    const start = atMinutes(slot.startMinutes);
    const rawEnd = atMinutes(slot.endMinutes);
    return { start, end: rawEnd <= start ? rawEnd + 86_400_000 : rawEnd };
  }

  function isBooked(courtId: string, slot: CourtAvailability["slots"][number]) {
    const { start, end } = slotTimes(slot);
    return Boolean(
      data.value?.bookings.some(
        (booking) =>
          booking.courtId === courtId &&
          new Date(booking.startsAt).getTime() < end &&
          new Date(booking.endsAt).getTime() > start,
      ),
    );
  }

  function isClosed(courtId: string, slot: CourtAvailability["slots"][number]) {
    const { start, end } = slotTimes(slot);
    return Boolean(
      data.value?.closures.some(
        (closure) =>
          closure.courtId === courtId &&
          closure.status === "ACTIVE" &&
          new Date(closure.startsAt).getTime() < end &&
          new Date(closure.endsAt).getTime() > start,
      ),
    );
  }

  function unavailableReason(
    courtId: string,
    slot: CourtAvailability["slots"][number],
  ) {
    const court = data.value?.courts.find((item) => item.id === courtId);
    if (!slot.price) return "未定价";
    if (!court?.enabled || !slot.enabled) return "不可售";
    if (court.usage === "MAINTENANCE") return "维护中";
    if (court.usage === "TRAINING") return "培训专用";
    if (slotTimes(slot).start <= Date.now()) return "已过时段";
    if (isClosed(courtId, slot)) return "已封场";
    if (isBooked(courtId, slot)) return "已占用";
    return "";
  }

  function blockedReason(
    courtId: string,
    slot: CourtAvailability["slots"][number],
  ) {
    if (!slot.price) return "未定价";
    return assisted.value ? "" : unavailableReason(courtId, slot);
  }
  const needsOverride = computed(() =>
    Boolean(
      assisted.value &&
      selected.value &&
      selectedSlot.value &&
      unavailableReason(selected.value.courtId, selectedSlot.value),
    ),
  );

  let availabilitySequence = 0;
  async function load(resetSelection = false) {
    const run = ++availabilitySequence;
    const requestedDate = date.value;
    loading.value = true;
    error.value = "";
    if (resetSelection) selected.value = null;
    try {
      const availability = await (assisted.value
        ? endpoints.assistedAvailability(requestedDate)
        : endpoints.availability(requestedDate));
      if (run !== availabilitySequence || requestedDate !== date.value) return;
      data.value = availability;
      if (
        selected.value &&
        (!selectedSlot.value ||
          blockedReason(selected.value.courtId, selectedSlot.value))
      ) {
        selected.value = null;
        uni.showToast({ title: "原时段已不可订，请重新选择", icon: "none" });
      }
    } catch (cause: any) {
      if (run === availabilitySequence) error.value = cause.message;
    } finally {
      if (run === availabilitySequence) loading.value = false;
    }
  }

  function choose(courtId: string, slot: CourtAvailability["slots"][number]) {
    if (loading.value || isSubmitting() || blockedReason(courtId, slot)) return;
    selected.value =
      selected.value?.courtId === courtId && selected.value.slotId === slot.id
        ? null
        : { courtId, slotId: slot.id };
    onSelectionChange();
  }

  return {
    date,
    showAllDay,
    visibleSlots,
    data,
    loading,
    selected,
    error,
    selectedSlot,
    selectedCourt,
    slotRange,
    slotTimes,
    isBooked,
    isClosed,
    unavailableReason,
    blockedReason,
    needsOverride,
    load,
    choose,
  };
}
