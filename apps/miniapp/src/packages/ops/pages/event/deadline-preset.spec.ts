import { expect, it } from "vitest";
import { previousEvening } from "./deadline-preset";
it.each([
  ["2026-10-01", "2026-09-30"],
  ["2028-03-01", "2028-02-29"],
  ["2026-01-01", "2025-12-31"],
])("uses calendar arithmetic for %s", (date, expected) => {
  expect(previousEvening(date)).toEqual({ date: expected, time: "20:00" });
});
it.each(["", "2026-02-30", "not-a-date"])(
  "rejects invalid dates: %s",
  (date) => {
    expect(previousEvening(date)).toBeNull();
  },
);
