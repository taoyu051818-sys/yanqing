import { mockUser } from "../core";
import { getOrders } from "../venue";
import {
  getAuditLogs,
  getStudents,
  getSystemParameters,
  getTrainingProducts,
  getTrainingSessions,
  saveTrainingProducts,
} from "../state";
import {
  integer,
  hasRole,
  requireRole,
  requireText,
  commandHash,
  audit,
  classContext,
} from "./command-policy.js";
import { person } from "./trial-policy.js";
import {
  activeMockYouthTrainingRule,
  validateMockYouthProduct,
} from "./youth-rules.js";

export const mockTrainingProductSummary = (product: any) =>
  product
    ? {
        id: product.id,
        name: product.name,
        audience: product.audience,
        totalSessions: product.totalSessions,
        validityDays: product.validityDays,
        priceCents: product.priceCents,
      }
    : null;

export const mockTrainingProductView = (
  product: any,
  options: { showAssignments?: boolean; coachOnly?: boolean } = {},
) => ({
  ...mockTrainingProductSummary(product),
  enabled: product.enabled !== false,
  classes: (product.classes || [])
    .filter(
      (trainingClass: any) =>
        trainingClass.active !== false &&
        (!options.coachOnly ||
          trainingClass.coachId === mockUser().id ||
          trainingClass.assistantId === mockUser().id),
    )
    .map((trainingClass: any) => ({
      id: trainingClass.id,
      name: trainingClass.name,
      capacity: trainingClass.capacity,
      active: trainingClass.active !== false,
      ...(options.showAssignments
        ? {
            coachId: trainingClass.coachId || null,
            assistantId: trainingClass.assistantId || null,
          }
        : {}),
    })),
});

export const decorateMockTrainingEnrollment = (
  enrollment: any,
  operational = false,
) => {
  const warnings: string[] = [];
  if (enrollment.product?.audience === "YOUTH") {
    const remainingDays = Math.ceil(
      (new Date(enrollment.expiresAt).getTime() - Date.now()) / 86_400_000,
    );
    const rule = activeMockYouthTrainingRule();
    if (remainingDays <= 0) warnings.push("青少年课包已到期");
    else if (rule && remainingDays <= Number(rule.warningThresholdDays))
      warnings.push(
        `青少年课包将在 ${remainingDays} 天内到期（当前规则预警阈值 ${rule.warningThresholdDays} 天）`,
      );
  }
  const order = getOrders().find((item) => item.id === enrollment.orderId);
  const product =
    enrollment.product ||
    getTrainingProducts().find((item) => item.id === enrollment.productId);
  const trainingClass = classContext(enrollment.classId);
  const student = getStudents().find(
    (item) => item.id === enrollment.studentId,
  );
  return {
    id: enrollment.id,
    enrollmentNo: enrollment.enrollmentNo,
    contractNo: enrollment.contractNo,
    productId: enrollment.productId || product?.id,
    classId: enrollment.classId || trainingClass?.id || null,
    studentId: enrollment.studentId || null,
    ...(operational ? { buyerId: enrollment.buyerId || null } : {}),
    orderId: enrollment.orderId || null,
    totalSessions: enrollment.totalSessions,
    consumedSessions: Number(
      enrollment.consumedSessions ?? enrollment.usedSessions ?? 0,
    ),
    totalAmountCents: enrollment.totalAmountCents ?? product?.priceCents ?? 0,
    prepaidBalanceCents: enrollment.prepaidBalanceCents ?? 0,
    confirmedRevenueCents: enrollment.confirmedRevenueCents ?? 0,
    refundedCents: enrollment.refundedCents ?? 0,
    status: enrollment.status,
    seatReservedUntil: enrollment.seatReservedUntil || null,
    startsAt: enrollment.startsAt || null,
    expiresAt: enrollment.expiresAt,
    product: mockTrainingProductSummary(product),
    class: trainingClass
      ? {
          id: trainingClass.id,
          name: trainingClass.name,
          capacity: trainingClass.capacity,
          active: trainingClass.active !== false,
        }
      : null,
    student: student
      ? { id: student.id, displayName: student.displayName }
      : enrollment.student
        ? {
            id: enrollment.student.id,
            displayName: enrollment.student.displayName,
          }
        : null,
    ...(operational
      ? {
          buyer: enrollment.buyer
            ? {
                id: enrollment.buyer.id || enrollment.buyerId,
                displayName: enrollment.buyer.displayName,
              }
            : person(enrollment.buyerId),
        }
      : {}),
    order: order ? { status: order.status } : null,
    attendances: (enrollment.attendances || []).map((attendance: any) => {
      const session = getTrainingSessions().find(
        (item) => item.id === attendance.sessionId,
      );
      return {
        id: attendance.id,
        sessionId: attendance.sessionId,
        enrollmentId: attendance.enrollmentId || enrollment.id,
        status: attendance.status,
        consumedSessions: attendance.consumedSessions || 0,
        confirmedRevenueCents: attendance.confirmedRevenueCents || 0,
        growthPointsAwarded: attendance.growthPointsAwarded || 0,
        feedback: attendance.feedback || null,
        checkedInAt: attendance.checkedInAt || null,
        consumedAt: attendance.consumedAt || null,
        ...(operational
          ? {
              operatorId: attendance.operatorId || null,
              revenueRecognitions: (attendance.revenueRecognitions || []).map(
                (recognition: any) => ({
                  id: recognition.id,
                  type: recognition.type,
                  sequence: recognition.sequence,
                  effectiveRevenueCents: recognition.effectiveRevenueCents,
                  reversedBy: recognition.reversedBy
                    ? {
                        id: recognition.reversedBy.id,
                        type: recognition.reversedBy.type,
                        sequence: recognition.reversedBy.sequence,
                      }
                    : null,
                  createdAt: recognition.createdAt,
                }),
              ),
            }
          : {}),
        session: session
          ? {
              id: session.id,
              classId: session.classId,
              startsAt: session.startsAt,
              endsAt: session.endsAt,
              status: session.status,
            }
          : null,
      };
    }),
    regulatoryWarnings: warnings,
  };
};

export const mockTrainingSessionView = (session: any) => {
  const trainingClass = classContext(session.classId) || session.class;
  const observedAt = new Date();
  const windowConfiguration = (
    key: string,
    defaults: { earlyMinutes: number; lateMinutes: number },
  ) => {
    const parameter = getSystemParameters()
      .filter(
        (item: any) =>
          item.key === key &&
          new Date(item.effectiveFrom) <= observedAt &&
          (!item.effectiveTo || new Date(item.effectiveTo) > observedAt),
      )
      .sort((left: any, right: any) =>
        String(right.effectiveFrom).localeCompare(String(left.effectiveFrom)),
      )[0];
    const value = parameter?.value;
    const valid =
      value?.version === 1 &&
      Number.isInteger(value.earlyMinutes) &&
      value.earlyMinutes >= 0 &&
      value.earlyMinutes <= 240 &&
      Number.isInteger(value.lateMinutes) &&
      value.lateMinutes >= 0 &&
      value.lateMinutes <= 240;
    return valid ? value : defaults;
  };
  const windowProjection = (
    startsAt: unknown,
    endsAt: unknown,
    configuration: { earlyMinutes: number; lateMinutes: number },
  ) => {
    const opensAt = new Date(
      new Date(String(startsAt)).getTime() -
        configuration.earlyMinutes * 60_000,
    );
    const closesAt = new Date(
      new Date(String(endsAt)).getTime() + configuration.lateMinutes * 60_000,
    );
    const state =
      observedAt < opensAt
        ? "NOT_OPEN"
        : observedAt <= closesAt
          ? "OPEN"
          : "CLOSED";
    return {
      opensAt: opensAt.toISOString(),
      closesAt: closesAt.toISOString(),
      state,
      mayHistoricallyOverride:
        state === "CLOSED" && hasRole("ADMIN", "SUPER_ADMIN"),
    };
  };
  const attendanceConfiguration = windowConfiguration(
    "training.attendance_window.v1",
    { earlyMinutes: 30, lateMinutes: 120 },
  );
  const completionConfiguration = windowConfiguration(
    "training.completion_window.v1",
    { earlyMinutes: 0, lateMinutes: 240 },
  );
  return {
    id: session.id,
    classId: session.classId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    status: session.status,
    courtCount: session.courtCount ?? (session.courtIds || []).length,
    occupiedCourtHours: session.occupiedCourtHours,
    note: session.note || null,
    attendanceWindow: windowProjection(
      session.startsAt,
      session.endsAt,
      attendanceConfiguration,
    ),
    completionWindow: windowProjection(
      session.endsAt,
      session.endsAt,
      completionConfiguration,
    ),
    class: trainingClass
      ? {
          id: trainingClass.id || session.classId,
          name: trainingClass.name,
          capacity: trainingClass.capacity,
          active: trainingClass.active !== false,
          product: mockTrainingProductSummary(trainingClass.product),
        }
      : null,
    attendances: (session.attendances || []).map((attendance: any) => ({
      id: attendance.id,
      sessionId: attendance.sessionId || session.id,
      enrollmentId: attendance.enrollmentId,
      status: attendance.status,
      consumedSessions: attendance.consumedSessions || 0,
      confirmedRevenueCents: attendance.confirmedRevenueCents || 0,
      growthPointsAwarded: attendance.growthPointsAwarded || 0,
      feedback: attendance.feedback || null,
      checkedInAt: attendance.checkedInAt || null,
      consumedAt: attendance.consumedAt || null,
    })),
  };
};

export const updateTrainingProduct = (productId: string, data: any) => {
  requireRole("ADMIN", "SUPER_ADMIN");
  const reason = requireText(data.reason, "变更原因", 2, 300);
  const idempotencyKey = requireText(data.idempotencyKey, "幂等键", 8, 100);
  const products = getTrainingProducts();
  const product = products.find((item) => item.id === productId);
  if (!product) throw new Error("培训产品不存在");
  const next = {
    name:
      data.name === undefined
        ? product.name
        : requireText(data.name, "产品名称", 1, 100),
    totalSessions:
      data.totalSessions === undefined
        ? Number(product.totalSessions)
        : integer(data.totalSessions),
    validityDays:
      data.validityDays === undefined
        ? Number(product.validityDays)
        : integer(data.validityDays),
    priceCents:
      data.priceCents === undefined
        ? Number(product.priceCents)
        : integer(data.priceCents),
    refundRule:
      data.refundRule === undefined
        ? product.refundRule || {}
        : data.refundRule,
    enabled:
      data.enabled === undefined
        ? product.enabled !== false
        : data.enabled === true,
  };
  if (
    next.totalSessions < 1 ||
    next.validityDays < 1 ||
    next.priceCents < 1 ||
    !next.refundRule ||
    typeof next.refundRule !== "object" ||
    Array.isArray(next.refundRule)
  )
    throw new Error("培训产品课次、有效期、售价和退费规则必须完整");
  const hash = commandHash({
    kind: "TRAINING_PRODUCT_UPDATE",
    productId,
    ...next,
    reason,
  });
  const replay = getAuditLogs().find(
    (entry) =>
      entry.action === "TRAINING_PRODUCT_UPDATED" &&
      entry.requestId === idempotencyKey,
  );
  if (replay) {
    if (
      replay.objectId !== productId ||
      replay.actorId !== mockUser().id ||
      replay.newValue?.commandHash !== hash
    )
      throw new Error("产品变更幂等键已用于其他命令");
    return product;
  }
  const regulatoryValidation =
    product.audience === "YOUTH" && next.enabled
      ? validateMockYouthProduct(next)
      : null;
  const before = { ...product };
  Object.assign(product, next, {
    unitRevenueCents: Math.round(next.priceCents / next.totalSessions),
    updatedAt: new Date().toISOString(),
  });
  saveTrainingProducts(products);
  audit({
    action: "TRAINING_PRODUCT_UPDATED",
    objectType: "TrainingProduct",
    objectId: product.id,
    reason,
    requestId: idempotencyKey,
    oldValue: before,
    newValue: { ...next, regulatoryValidation, commandHash: hash },
  });
  return { ...product, regulatoryValidation };
};
