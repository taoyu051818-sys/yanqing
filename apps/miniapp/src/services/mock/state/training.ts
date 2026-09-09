import {
  enrollments as seedEnrollments,
  trainingProducts as seedTrainingProducts,
  trainingSessions as seedTrainingSessions,
} from "../catalog";
import { type JsonRecord, clone, KEYS, read, write } from "./storage.js";

export const initialTrainingSettlements = (): JsonRecord[] => {
  const now = new Date();
  const start = new Date(now.getTime() - 86_400_000);
  const end = new Date(now);
  return [
    {
      id: "training-settlement-mock-1",
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      effectiveRevenueCents: 168_000,
      contractRateBps: 2_000,
      venueContributionCents: 33_600,
      venueFeeCents: 0,
      trainingPayableVenueCents: 0,
      coachCostCents: 36_000,
      assistantCostCents: 8_000,
      materialCostCents: 5_000,
      acquisitionCostCents: 0,
      marketingCostCents: 0,
      occupiedCourtHours: 6,
      cashContributionMarginCents: 119_000,
      status: "DRAFT",
      confirmedById: null,
      confirmedAt: null,
      createdById: "user-finance",
      createdBy: { id: "user-finance", displayName: "金羽财务" },
      workflowHistory: [
        {
          action: "TRAINING_SETTLEMENT_CREATED",
          actorId: "user-finance",
          actorName: "金羽财务",
          oldValue: null,
          newValue: { status: "DRAFT" },
          reason: null,
          at: now.toISOString(),
        },
      ],
      processedIdempotencyKeys: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ];
};

export function getEnrollments(): JsonRecord[] {
  const enrollments = read<JsonRecord[]>(
    KEYS.enrollments,
    seedEnrollments as JsonRecord[],
  );
  const seeded = (seedEnrollments as JsonRecord[])[0];
  const currentAttendance = seeded?.attendances?.find(
    (item: JsonRecord) => item.id === "attendance-current",
  );
  const target = enrollments.find((item) => item.id === seeded?.id);
  if (
    currentAttendance &&
    target &&
    !(target.attendances || []).some(
      (item: JsonRecord) => item.id === currentAttendance.id,
    )
  ) {
    target.attendances = [
      ...(target.attendances || []),
      clone(currentAttendance),
    ];
    write(KEYS.enrollments, enrollments);
  }
  return enrollments;
}

export function saveEnrollments(value: JsonRecord[]) {
  return write(KEYS.enrollments, value);
}

export function getStudents(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.students, [
    {
      id: "student-youth-1",
      guardianId: "user-member",
      displayName: "小羽学员",
      guardianConsentStatus: true,
      authorizationNote: "监护人已在测试环境确认授权",
      guardian: { id: "user-member", displayName: "延庆会员小林" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);
}

export function saveStudents(value: JsonRecord[]) {
  return write(KEYS.students, value);
}

export function getTrainingSessions(): JsonRecord[] {
  const sessions = read<JsonRecord[]>(
    KEYS.trainingSessions,
    seedTrainingSessions as JsonRecord[],
  );
  const currentFixture = (seedTrainingSessions as JsonRecord[]).find(
    (item) => item.id === "session-current",
  );
  if (
    currentFixture &&
    !sessions.some((item) => item.id === currentFixture.id)
  ) {
    sessions.push(clone(currentFixture));
    write(KEYS.trainingSessions, sessions);
  } else if (currentFixture) {
    const rollingFixture = sessions.find(
      (item) => item.id === currentFixture.id && item.status === "IN_PROGRESS",
    );
    if (rollingFixture) {
      rollingFixture.startsAt = currentFixture.startsAt;
      rollingFixture.endsAt = currentFixture.endsAt;
      write(KEYS.trainingSessions, sessions);
    }
  }
  return sessions;
}

export function saveTrainingSessions(value: JsonRecord[]) {
  return write(KEYS.trainingSessions, value);
}

export function getTrainingProducts(): JsonRecord[] {
  const products = read<JsonRecord[]>(
    KEYS.trainingProducts,
    seedTrainingProducts as JsonRecord[],
  );
  return products.map((product) => ({
    enabled: true,
    ...product,
    classes: (product.classes || []).map((trainingClass: JsonRecord) => ({
      active: true,
      ...(trainingClass.id === "class-adult" ? { coachId: "user-coach" } : {}),
      ...trainingClass,
    })),
  }));
}

export function saveTrainingProducts(value: JsonRecord[]) {
  return write(KEYS.trainingProducts, value);
}

export function getTrainingCreationCommands(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.trainingCreationCommands, []);
}

export function saveTrainingCreationCommands(value: JsonRecord[]) {
  return write(KEYS.trainingCreationCommands, value);
}

export function getTrainingTrials(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.trainingTrials, []);
}

export function saveTrainingTrials(value: JsonRecord[]) {
  return write(KEYS.trainingTrials, value);
}

export function getYouthTrainingRules(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.youthTrainingRules, []);
}

export function saveYouthTrainingRules(value: JsonRecord[]) {
  return write(KEYS.youthTrainingRules, value);
}

export function getTrainingConsumeCorrections(): JsonRecord[] {
  return read<JsonRecord[]>(KEYS.trainingConsumeCorrections, []);
}

export function saveTrainingConsumeCorrections(value: JsonRecord[]) {
  return write(KEYS.trainingConsumeCorrections, value);
}

export function getTrainingSettlements(): JsonRecord[] {
  return read<JsonRecord[]>(
    KEYS.trainingSettlements,
    initialTrainingSettlements(),
  );
}

export function saveTrainingSettlements(value: JsonRecord[]) {
  return write(KEYS.trainingSettlements, value);
}
