import { computed, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { TrainingEnrollmentView } from "@yanqing/shared";
import { useCoachViewModel } from "./projection";

const enrollment = (
  id: string,
  consumedSessions: number,
): TrainingEnrollmentView => ({
  id,
  enrollmentNo: id,
  contractNo: id,
  productId: "product",
  classId: "class",
  studentId: null,
  orderId: null,
  totalSessions: 12,
  consumedSessions,
  totalAmountCents: 12000,
  prepaidBalanceCents: (12 - consumedSessions) * 1000,
  confirmedRevenueCents: consumedSessions * 1000,
  refundedCents: 0,
  status: "ACTIVE",
  seatReservedUntil: null,
  startsAt: "2026-09-01T00:00:00Z",
  expiresAt: "2026-12-31T00:00:00Z",
  product: {
    id: "product",
    name: "成人课包",
    audience: "ADULT",
    totalSessions: 12,
    validityDays: 120,
    priceCents: 12000,
  },
  class: { id: "class", name: "周末班", capacity: 12, active: true },
  student: null,
  order: null,
  attendances: [],
  regulatoryWarnings: [],
});
function model() {
  type Context = Parameters<typeof useCoachViewModel>[0];
  const enrollments = ref([enrollment("a", 3), enrollment("b", 2)]);
  const context: Context = {
    session: { roles: ["ADMIN"] } as Context["session"],
    staffUsers: ref([]),
    corrections: ref([]),
    products: ref([]),
    classProductIndex: ref(0),
    sessionClassIndex: ref(0),
    lessons: ref([]),
    trialSessionIndex: ref(0),
    trialSubjectIndex: ref(0),
    leads: ref([]),
    trialLeadIndex: ref(0),
    trialStudents: ref([]),
    trialStudentIndex: ref(0),
    trialMembers: ref([]),
    trialMemberIndex: ref(0),
    courtAvailability: ref(null),
    sessionDate: ref("2026-09-10"),
    sessionStartTime: ref("09:00"),
    sessionEndTime: ref("10:00"),
    enrollments,
    trials: ref([]),
  };
  return { enrollments, view: useCoachViewModel(context) };
}
describe("training view against enrollment API contract", () => {
  it("counts consumedSessions from API responses and reacts to a confirmed correction", () => {
    const { enrollments, view } = model();
    const consumed = computed(
      () => view.metrics.value.find((row) => row[0] === "已消课")?.[1],
    );
    expect(consumed.value).toBe("5");
    enrollments.value[0].consumedSessions = 1;
    expect(consumed.value).toBe("3");
  });
});
