import { type JsonRecord, KEYS, read, write } from "./storage.js";

export function getReconciliationPeriods(): Record<string, JsonRecord> {
  return read<Record<string, JsonRecord>>(KEYS.reconciliationPeriods, {});
}

export function saveReconciliationPeriods(value: Record<string, JsonRecord>) {
  return write(KEYS.reconciliationPeriods, value);
}

export function getOrderCreations(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.orderCreations, []);
}

export function saveOrderCreations(value: JsonRecord[]) {
  return write(KEYS.orderCreations, value);
}

export function getFrontDeskShifts(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.frontDeskShifts, []);
}

export function saveFrontDeskShifts(value: JsonRecord[]) {
  return write(KEYS.frontDeskShifts, value);
}
