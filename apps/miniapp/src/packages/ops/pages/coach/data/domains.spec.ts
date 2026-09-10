import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { endpoints } from "../../../../../services/api";
import { useCoachCatalogData } from "./catalog";
import { useCoachTeachingData } from "./teaching";
import { useCoachTrialData } from "./trials";
import { useCoachYouthRuleData } from "./youth-rules";
import { useCoachCourtData } from "./courts";
import type { CourtAvailability } from "../../../../../types/domain";
vi.mock("../../../../../services/api", () => ({
  endpoints: {
    trainingProducts: vi.fn(),
    governanceUsers: vi.fn(),
    trainingSessions: vi.fn(),
    adminEnrollments: vi.fn(),
    trainingConsumeCorrections: vi.fn(),
    trainingTrials: vi.fn(),
    customerLeads: vi.fn(),
    adminTrainingStudents: vi.fn(),
    members: vi.fn(),
    activeYouthTrainingRule: vi.fn(),
    youthTrainingRules: vi.fn(),
    availability: vi.fn(),
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  for (const method of [
    endpoints.trainingProducts,
    endpoints.trainingSessions,
    endpoints.adminEnrollments,
    endpoints.trainingConsumeCorrections,
    endpoints.trainingTrials,
    endpoints.adminTrainingStudents,
    endpoints.youthTrainingRules,
  ])
    vi.mocked(method).mockResolvedValue([]);
  vi.mocked(endpoints.customerLeads).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  vi.mocked(endpoints.governanceUsers).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  vi.mocked(endpoints.members).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(endpoints.activeYouthTrainingRule).mockResolvedValue(null);
});
describe("training domain refresh", () => {
  it("loads usable product data even when a teaching request fails", async () => {
    vi.mocked(endpoints.trainingSessions).mockRejectedValue(
      new Error("课表暂不可用"),
    );
    const product = {
      id: "p",
      name: "成人课",
      audience: "ADULT" as const,
      totalSessions: 12,
      validityDays: 90,
      priceCents: 12000,
      enabled: true,
      classes: [],
    };
    vi.mocked(endpoints.trainingProducts).mockResolvedValue([product]);
    const teaching = useCoachTeachingData(() => "admin");
    const catalog = useCoachCatalogData(() => "admin");
    await Promise.all([teaching.refresh(), catalog.refresh(true)]);
    expect(teaching.error.value).toBe("课表暂不可用");
    expect(catalog.error.value).toBe("");
    expect(catalog.products.value).toEqual([product]);
    expect(endpoints.adminEnrollments).toHaveBeenCalledOnce();
    expect(endpoints.trainingConsumeCorrections).toHaveBeenCalledOnce();
  });
  it("skips restricted endpoints and clears their previous results when access changes", async () => {
    let role = "admin";
    const catalog = useCoachCatalogData(() => role);
    const trials = useCoachTrialData(() => role);
    const rules = useCoachYouthRuleData(() => role);
    vi.mocked(endpoints.customerLeads).mockResolvedValue({
      items: [
        {
          id: "lead",
          displayName: "线索",
          status: "NEW",
          convertedMemberId: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    vi.mocked(endpoints.governanceUsers).mockResolvedValue({
      items: [
        {
          id: "coach",
          displayName: "教练",
          status: "ACTIVE",
          primaryRole: "COACH",
          roles: ["COACH"],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    await Promise.all([
      catalog.refresh(true),
      trials.refresh(true),
      rules.refresh(true),
    ]);
    expect(trials.leads.value).toHaveLength(1);
    expect(catalog.staffUsers.value).toHaveLength(1);
    vi.clearAllMocks();
    role = "coach";
    await Promise.all([
      catalog.refresh(false),
      trials.refresh(false),
      rules.refresh(false),
    ]);
    expect(trials.leads.value).toEqual([]);
    expect(trials.trialStudents.value).toEqual([]);
    expect(trials.trialMembers.value).toEqual([]);
    expect(catalog.staffUsers.value).toEqual([]);
    expect(rules.youthRules.value).toEqual([]);
    for (const method of [
      endpoints.customerLeads,
      endpoints.adminTrainingStudents,
      endpoints.members,
      endpoints.governanceUsers,
      endpoints.youthTrainingRules,
    ])
      expect(method).not.toHaveBeenCalled();
    expect(endpoints.trainingTrials).toHaveBeenCalledOnce();
    expect(endpoints.activeYouthTrainingRule).toHaveBeenCalledOnce();
  });
  it("uses the latest selected date for court availability and keeps only enabled selections", async () => {
    const date = ref("2026-09-10");
    const selected = ref(["enabled", "disabled"]);
    const courts = useCoachCourtData(() => "coach", date, selected);
    let resolveOld!: (value: CourtAvailability) => void;
    vi.mocked(endpoints.availability).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const old = courts.refresh();
    date.value = "2026-09-11";
    const latest = {
      date: date.value,
      courts: [
        { id: "enabled", name: "1号场", usage: "GENERAL", enabled: true },
        { id: "disabled", name: "2号场", usage: "GENERAL", enabled: false },
      ],
      bookings: [],
      closures: [],
      slots: [],
    } satisfies CourtAvailability;
    vi.mocked(endpoints.availability).mockResolvedValueOnce(latest);
    await courts.refresh();
    resolveOld({ ...latest, date: "2026-09-10", courts: [] });
    await old;
    expect(courts.courtAvailability.value?.date).toBe("2026-09-11");
    expect(selected.value).toEqual(["enabled"]);
  });
});
