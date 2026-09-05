import { describe, expect, it } from "vitest";
import {
  businessParameterCatalog,
  formatBusinessParameterValue,
  parseBusinessParameterValue,
  visibleFinancePageExportScopes,
  visibleGovernanceExportScopes,
  visibleGovernanceTabs,
} from "./governance";

describe("governance presentation policy", () => {
  it("keeps finance on risk, audit and export workflows without exposing business parameters", () => {
    expect(visibleGovernanceTabs(["FINANCE"]).map((tab) => tab.key)).toEqual([
      "risks",
      "audit",
      "exports",
    ]);
    expect(visibleGovernanceTabs(["ADMIN"]).map((tab) => tab.key)).toContain(
      "parameters",
    );
  });

  it("limits finance exports while retaining the full audit package for administrators", () => {
    expect(
      visibleGovernanceExportScopes(["FINANCE"]).map(([scope]) => scope),
    ).toEqual(["orders", "finance"]);
    expect(
      visibleGovernanceExportScopes(["ADMIN"]).map(([scope]) => scope),
    ).toContain("all");
  });

  it("keeps finance-page buttons aligned with server report authorization", () => {
    expect(
      visibleFinancePageExportScopes(["FINANCE"]).map(([scope]) => scope),
    ).toEqual(["orders", "finance"]);
    expect(
      visibleFinancePageExportScopes(["ADMIN"]).map(([scope]) => scope),
    ).toEqual(["orders", "finance", "events", "inventory"]);
    expect(visibleFinancePageExportScopes(["MEMBER"])).toEqual([]);
  });

  it("formats internal parameter values as business-readable Chinese text", () => {
    expect(
      formatBusinessParameterValue(
        "finance.operating_share_rate_bps",
        1_500,
      ),
    ).toBe("15%");
    expect(
      formatBusinessParameterValue("training.contract_rate_bps", 2_000),
    ).toBe("20%");
    expect(
      formatBusinessParameterValue("operations.venue_check_in_window.v1", {
        version: 1,
        earlyMinutes: 30,
        lateMinutes: 45,
      }),
    ).toBe("提前 30 分钟 · 延后 45 分钟");
    expect(
      formatBusinessParameterValue("newcomer.experience.allowed_slot_periods", [
        "EARLY",
        "DAYTIME",
      ]),
    ).toBe("早场、日间");
  });

  it("builds structured values from constrained business controls instead of raw JSON", () => {
    const definition = businessParameterCatalog.find(
      (item) => item.kind === "WINDOW",
    )!;
    expect(
      parseBusinessParameterValue(definition, {
        scalar: "",
        earlyMinutes: "15",
        lateMinutes: "60",
        periods: [],
      }),
    ).toEqual({ version: 1, earlyMinutes: 15, lateMinutes: 60 });
  });
});
