import { beforeEach, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { useCoachScheduleActions } from "./schedule";
import { useTrainingSessionForm } from "../forms/session-form";
import { endpoints } from "../../../../../services/api";
vi.mock("../../../../../services/api", () => ({ endpoints: { createTrainingSession: vi.fn() } }));
vi.mock("../../../../../utils/pending-creation-key", () => ({ withPendingCreationKey: (_scope: string, _command: unknown, operation: (key: string) => Promise<unknown>) => operation("test-key") }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("uni", { showModal: vi.fn(async () => ({ confirm: true })) }); });
function setup() {
  const form = useTrainingSessionForm(), errorMessage = ref("");
  const onValidationError = vi.fn();
  form.selectedCourtIds.value = ["court"];
  form.sessionDate.value = "2099-09-27";
  const context = { ...form, errorMessage, canCreateSession: computed(() => true), actionKey: ref(""),
    selectedSessionClass: computed(() => ({ id: "class", name: "周末班" })),
    sessionStartsAt: computed(() => `${form.sessionDate.value}T19:00:00+08:00`),
    sessionEndsAt: computed(() => `${form.sessionDate.value}T21:00:00+08:00`),
    sessionCourts: computed(() => [{ id: "court", name: "1号场", usage: "TRAINING", enabled: true }]),
    blockedCourtIds: computed(() => new Set<string>()), loadCourtAvailability: vi.fn(), onValidationError,
    runCreation: async (_key: string, _message: string, operation: () => Promise<unknown>) => { await operation(); return true; },
  };
  return { form, context, errorMessage, onValidationError, ...useCoachScheduleActions(context) };
}
it("creates a scheduled session without retyping a routine reason, retaining the occupancy confirmation", async () => {
  const { createSession, form } = setup();
  expect(await createSession()).toBe(true);
  expect(uni.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "确认创建培训课次" }));
  expect(endpoints.createTrainingSession).toHaveBeenCalledWith(expect.objectContaining({ reason: "安排培训课次", courtIds: ["court"] }));
  expect(form.selectedCourtIds.value).toEqual([]);
});
it("retains the date, selected courts and note after an unsuccessful submission", async () => {
  const { createSession, form, errorMessage } = setup();
  form.sessionNote.value = "带练反手";
  vi.mocked(endpoints.createTrainingSession).mockRejectedValueOnce(new Error("场地刚被预约，请换场"));
  expect(await createSession()).toBeUndefined();
  expect(form.selectedCourtIds.value).toEqual(["court"]);
  expect(form.sessionDate.value).toBe("2099-09-27");
  expect(form.sessionNote.value).toBe("带练反手");
  expect(errorMessage.value).toContain("请换场");
});
it("does not create or confirm a session when no class is selected", async () => {
  const { context, onValidationError } = setup();
  const actions = useCoachScheduleActions({ ...context, selectedSessionClass: computed(() => null) });
  await actions.createSession();
  expect(onValidationError).toHaveBeenLastCalledWith("class");
  expect(endpoints.createTrainingSession).not.toHaveBeenCalled();
  expect(uni.showModal).not.toHaveBeenCalled();
});
