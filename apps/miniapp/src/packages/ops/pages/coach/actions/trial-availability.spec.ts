import { describe, expect, it } from "vitest";
import type { TrainingProductView, TrainingSessionView } from "@yanqing/shared";
import { trialSessionOptions, trialSetupGap } from "./trial-availability";

const product = (overrides: Partial<TrainingProductView> = {}): TrainingProductView => ({
  id: "mixed", name: "基础班", audience: "ALL", totalSessions: 12,
  validityDays: 120, priceCents: 128000, enabled: true, classes: [], ...overrides,
});

describe("trial prerequisites", () => {
  it("explains the first missing prerequisite and passes its context to the next screen", () => {
    expect(trialSetupGap([], true, false)).toMatchObject({ view: "create-product", context: { audience: "YOUTH" }, permission: "configure" });
    expect(trialSetupGap([product()], false, false)).toMatchObject({ view: "create-class", context: { productId: "mixed" } });
    const withClass = product({ classes: [{ id: "class", name: "周末班", active: true, capacity: 12 }] });
    expect(trialSetupGap([withClass], true, false)).toMatchObject({ view: "create-session", context: { classId: "class" }, permission: "schedule" });
    expect(trialSetupGap([withClass], true, true)).toBeNull();
  });
  it("does not send a child to adult, disabled, or inactive-class configuration", () => {
    expect(trialSetupGap([product({ audience: "ADULT" })], true, false)?.view).toBe("create-product");
    expect(trialSetupGap([product({ enabled: false })], false, false)?.view).toBe("create-product");
    expect(trialSetupGap([product({ classes: [{ id: "old", name: "旧班", active: false, capacity: 1 }] })], false, false)?.view).toBe("create-class");
  });
  it("provides a human-readable native picker label, including the class and time", () => {
    const options = trialSessionOptions([{ id: "s1", startsAt: "2026-09-27T01:00:00Z", endsAt: "2026-09-27T03:00:00Z", class: { name: "周末班" } } as TrainingSessionView]);
    expect(options[0].label).toContain("周末班");
    expect(options[0].label).toContain("09:00");
    expect(options[0].label).toContain("11:00");
    expect(options[0].label).not.toContain("[object Object]");
  });
});
