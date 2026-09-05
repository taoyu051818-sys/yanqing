import { describe, expect, it } from "vitest";

import type { WorkItem } from "../services/api";
import { isUrgentWorkItem, workGroupKey } from "./work-items";

const item = (value: Partial<WorkItem>): WorkItem => ({
  id: "work-1",
  ...value,
});

describe("work item presentation", () => {
  it("uses the server-owned group before compatibility inference", () => {
    expect(
      workGroupKey(
        item({ group: "FULFILLMENT", kind: "TRAINING_SETTLEMENT" }),
      ),
    ).toBe("fulfillment");
  });

  it("keeps older work item kinds routable during a rolling API deployment", () => {
    expect(workGroupKey(item({ kind: "TRAINING_TRIAL_ASSESSMENT" }))).toBe(
      "training",
    );
    expect(workGroupKey(item({ kind: "CONSIGNMENT_SETTLEMENT" }))).toBe(
      "reconciliation",
    );
    expect(workGroupKey(item({ kind: "ORDER_FULFILLMENT" }))).toBe(
      "fulfillment",
    );
  });

  it("does not silently assign an unknown task to the wrong operator", () => {
    expect(workGroupKey(item({ kind: "UNKNOWN_KIND", title: "待处理" }))).toBe(
      null,
    );
  });

  it("classifies priority 90 and above as urgent", () => {
    expect(isUrgentWorkItem(item({ priority: 90 }))).toBe(true);
    expect(isUrgentWorkItem(item({ priority: 89 }))).toBe(false);
  });
});
