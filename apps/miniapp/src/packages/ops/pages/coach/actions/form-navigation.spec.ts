import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { preserveTrainingSelection, useTrainingFormNavigation } from "./form-navigation";

const navigateTo = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("uni", { navigateTo }); });

function navigation() {
  const products = ref([{ id: "existing-product" }]);
  const classes = ref([{ id: "existing-class" }]);
  const sessions = ref([{ id: "existing-session" }]);
  const productIndex = ref(0), classIndex = ref(0), trialSessionIndex = ref(-1);
  return { products, classes, sessions, productIndex, classIndex, trialSessionIndex,
    ...useTrainingFormNavigation({ products, classes, sessions, productIndex, classIndex, trialSessionIndex }) };
}

describe("training prerequisite navigation", () => {
  it("keeps the selected student through repeated refreshes and clears a removed identity", () => {
    const students = ref([{ id: "alice" }, { id: "bob" }, { id: "chris" }]);
    const index = ref(1);
    const stop = preserveTrainingSelection(students, index);
    students.value = [{ id: "bob" }, { id: "chris" }, { id: "alice" }];
    expect(students.value[index.value].id).toBe("bob");
    students.value = [{ id: "alice" }, { id: "bob" }];
    expect(students.value[index.value].id).toBe("bob");
    students.value = [{ id: "alice" }];
    expect(index.value).toBe(-1);
    stop();
  });

  it("uses the newly created session ID after returning, preserving the pending choice over stale refreshes", () => {
    const flow = navigation();
    flow.open("create-session", { classId: "class a" });
    const options = navigateTo.mock.calls[0][0];
    expect(options.url).toContain("classId=class%20a");
    options.events.trainingCreated({ kind: "session", id: "new-session" });
    flow.applySelection();
    expect(flow.trialSessionIndex.value).toBe(-1);
    flow.sessions.value = [{ id: "existing-session" }, { id: "unrelated" }, { id: "new-session" }];
    flow.applySelection();
    expect(flow.sessions.value[flow.trialSessionIndex.value].id).toBe("new-session");
    flow.trialSessionIndex.value = 0;
    flow.applySelection();
    expect(flow.trialSessionIndex.value).toBe(0);
  });

  it("prefills the exact product/class supplied by a prerequisite, never another first row", () => {
    const flow = navigation();
    flow.selectOnRefresh({ kind: "product", id: "target" });
    flow.applySelection();
    expect(flow.productIndex.value).toBe(-1);
    flow.products.value.push({ id: "target" });
    flow.applySelection();
    expect(flow.productIndex.value).toBe(1);
    flow.selectOnRefresh({ kind: "class", id: "new-class" });
    flow.classes.value.unshift({ id: "new-class" });
    flow.applySelection();
    expect(flow.classes.value[flow.classIndex.value].id).toBe("new-class");
  });

  it("ignores malformed navigation events", () => {
    const flow = navigation();
    flow.open("create-class");
    const emitCreated = navigateTo.mock.calls[0][0].events.trainingCreated;
    for (const value of [null, { kind: "order", id: "x" }, { kind: "class", id: "" }]) emitCreated(value);
    flow.applySelection();
    expect(flow.classIndex.value).toBe(0);
  });
});
