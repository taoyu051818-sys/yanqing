import { ref, watch, type Ref } from "vue";

type Identified = { id: string };
export type TrainingCreationKind = "product" | "class" | "session";
export interface TrainingCreationResult { kind: TrainingCreationKind; id: string }

/** Keep a person's identity stable when refreshes reorder or remove records. */
export function preserveTrainingSelection<T extends Identified>(items: Ref<T[]>, index: Ref<number>) {
  return watch(() => items.value.map(item => item.id), (ids, previous) => {
    const id = previous[index.value];
    if (id) index.value = ids.indexOf(id);
  }, { flush: "sync" });
}

function isCreationResult(value: unknown): value is TrainingCreationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<TrainingCreationResult>;
  return ["product", "class", "session"].includes(result.kind || "") &&
    typeof result.id === "string" && result.id.length > 0;
}

/** A prerequisite opens above its form, so the original draft remains page-owned. */
export function useTrainingFormNavigation({
  products, classes, sessions, productIndex, classIndex, trialSessionIndex,
}: {
  products: Ref<Identified[]>;
  classes: Ref<Identified[]>;
  sessions: Ref<Identified[]>;
  productIndex: Ref<number>;
  classIndex: Ref<number>;
  trialSessionIndex: Ref<number>;
}) {
  const pending = ref<TrainingCreationResult | null>(null);
  function applySelection() {
    const result = pending.value;
    if (!result) return;
    const [items, index] = result.kind === "product"
      ? [products.value, productIndex] as const
      : result.kind === "class"
        ? [classes.value, classIndex] as const
        : [sessions.value, trialSessionIndex] as const;
    const found = items.findIndex(item => item.id === result.id);
    // A failed/stale refresh must not silently substitute a different record.
    if (found < 0) { index.value = -1; return; }
    index.value = found;
    pending.value = null;
  }
  function open(view: string, context: Record<string, string> = {}) {
    const query = Object.entries({ view, ...context })
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    uni.navigateTo({
      url: `/packages/ops/pages/coach/index?${query}`,
      events: {
        trainingCreated(value: unknown) {
          if (isCreationResult(value)) pending.value = value;
        },
      },
    });
  }
  function selectOnRefresh(result: TrainingCreationResult) { pending.value = result; }
  return { open, applySelection, selectOnRefresh };
}
