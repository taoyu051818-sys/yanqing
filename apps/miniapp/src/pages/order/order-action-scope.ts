import { ref } from "vue";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";

/** A page owns one active mutation. Old callbacks cannot release a newer action. */
export function useOrderActionScope() {
  const actionKey = ref("");
  let generation = 0;
  let alive = true;
  function capture() {
    const version = generation;
    const owner = captureAuthSession();
    return () => alive && version === generation && isAuthSessionCurrent(owner);
  }
  function begin(key: string) {
    if (!alive || actionKey.value) return null;
    const version = ++generation;
    const isCurrent = capture();
    actionKey.value = key;
    return {
      isCurrent,
      finish() {
        if (generation === version) actionKey.value = "";
      },
    };
  }
  function reset() {
    generation++;
    actionKey.value = "";
  }
  function dispose() {
    alive = false;
    reset();
  }
  return { actionKey, capture, begin, reset, dispose };
}
export type OrderActionScope = ReturnType<typeof useOrderActionScope>;
