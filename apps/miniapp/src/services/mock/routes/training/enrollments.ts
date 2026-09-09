import { mockUser } from "../../core";
import { getOrders, saveOrders } from "../../venue";
import {
  decorateMockTrainingEnrollment,
  validateMockYouthProduct,
} from "../../training-operations";
import {
  getEnrollments,
  getStudents,
  getTrainingProducts,
  saveEnrollments,
} from "../../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  requireMockRole,
  text,
  newId,
} from "../../policies/common.js";
import {
  newOrderNo,
  beginMockOrderCreation,
  finishMockOrderCreation,
} from "../../policies/orders.js";
import { mockOperatingShareSnapshot } from "../../policies/master-data.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleTrainingEnrollmentsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/enrollments") {
    const userId = mockUser().id;
    return {
      handled: true,
      value: ok(
        getEnrollments()
          .filter(
            (enrollment) =>
              enrollment.buyerId === userId || !enrollment.buyerId,
          )
          .map((enrollment) => decorateMockTrainingEnrollment(enrollment)),
      ),
    };
  }
  return { handled: false };
}

export async function handleTrainingAdminEnrollmentsAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/admin/enrollments") {
    requireMockRole("COACH", "FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const roles = mockRoles();
    const ownClassOnly =
      roles.includes("COACH") &&
      !hasMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
    const ownedClassIds = ownClassOnly
      ? getTrainingProducts()
          .flatMap((product) => product.classes || [])
          .filter(
            (trainingClass: any) =>
              trainingClass.active !== false &&
              (trainingClass.coachId === mockUser().id ||
                trainingClass.assistantId === mockUser().id),
          )
          .map((trainingClass: any) => trainingClass.id)
      : [];
    return {
      handled: true,
      value: ok(
        ownClassOnly
          ? getEnrollments()
              .filter((enrollment) =>
                ownedClassIds.includes(enrollment.classId),
              )
              .map((enrollment) =>
                decorateMockTrainingEnrollment(enrollment, true),
              )
          : getEnrollments().map((enrollment) =>
              decorateMockTrainingEnrollment(enrollment, true),
            ),
      ),
    };
  }
  return { handled: false };
}

export async function handleTrainingPurchaseAny(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/purchase") {
    const creation = beginMockOrderCreation(data.creationIdempotencyKey, {
      kind: "TRAINING_PURCHASE",
      productId: text(data.productId),
      classId: text(data.classId) || null,
      studentId: text(data.studentId) || null,
      sourceChannel: text(data.sourceChannel) || "MINI_PROGRAM",
    });
    if (creation.tracked && creation.replayed)
      return { handled: true, value: ok(creation.response) };
    const product = getTrainingProducts().find(
      (item) => item.id === data.productId,
    );
    if (!product) throw new Error("培训产品不存在或已下架");
    const youthRegulatoryValidation =
      product.audience === "YOUTH"
        ? validateMockYouthProduct({
            totalSessions: Number(product.totalSessions),
            validityDays: Number(product.validityDays),
            priceCents: Number(product.priceCents),
          })
        : null;
    if (product.audience === "YOUTH" && !data.studentId)
      throw new Error("青少年课程必须选择学员");
    if (data.studentId) {
      const student = getStudents().find(
        (item) =>
          item.id === data.studentId &&
          item.guardianId === mockUser().id &&
          item.guardianConsentStatus === true,
      );
      if (!student) throw new Error("学员不存在或监护人授权未完成");
    }
    const selectedClass = data.classId
      ? product.classes?.find((item: any) => item.id === data.classId)
      : undefined;
    if (data.classId && !selectedClass)
      throw new Error("班级不属于所选培训产品");
    const seatReservedUntil = selectedClass
      ? new Date(Date.now() + 15 * 60_000).toISOString()
      : null;
    if (selectedClass) {
      const now = Date.now();
      const seatHolders = getEnrollments().filter(
        (item) =>
          item.classId === selectedClass.id &&
          (["ACTIVE", "PARTIALLY_REFUNDED"].includes(item.status) ||
            (item.status === "PENDING_PAYMENT" &&
              new Date(item.seatReservedUntil || 0).getTime() > now)),
      );
      const duplicate = seatHolders.some((item) =>
        data.studentId
          ? item.studentId === data.studentId
          : item.buyerId === mockUser().id && !item.studentId,
      );
      if (duplicate) throw new Error("该学员已报名本班或仍在名额保留期内");
      if (seatHolders.length >= Number(selectedClass.capacity || 0))
        throw new Error("班级名额已满");
    }
    const orderId = newId("order");
    const enrollment = {
      id: newId("enroll"),
      orderId,
      enrollmentNo: `EN${Date.now()}`,
      classId: data.classId || product.classes?.[0]?.id || null,
      status: "PENDING_PAYMENT",
      totalSessions: product.totalSessions,
      usedSessions: 0,
      consumedSessions: 0,
      totalAmountCents: product.priceCents,
      prepaidBalanceCents: 0,
      seatReservedUntil,
      expiresAt: new Date(
        Date.now() + product.validityDays * 86_400_000,
      ).toISOString(),
      product,
      buyerId: mockUser().id,
      studentId: data.studentId || null,
      buyer: { displayName: mockUser().displayName },
      attendances: [],
      youthRegulatorySnapshot: youthRegulatoryValidation,
    };
    saveEnrollments([enrollment, ...getEnrollments()]);
    const order = {
      id: orderId,
      orderNo: newOrderNo("TR"),
      title: product.name,
      status: "PENDING",
      businessType: "TRAINING",
      trainingEnrollmentId: enrollment.id,
      payableCents: product.priceCents,
      paidCents: 0,
      refundedCents: 0,
      createdAt: new Date().toISOString(),
      memberId: mockUser().id,
      member: { displayName: mockUser().displayName },
      parameterSnapshot: {
        productId: product.id,
        classId: selectedClass?.id,
        totalSessions: product.totalSessions,
        seatReservedUntil,
        youthRegulatoryValidation,
        operatingShare: mockOperatingShareSnapshot("TRAINING"),
      },
    };
    saveOrders([order, ...getOrders()]);
    return { handled: true, value: finishMockOrderCreation(creation, order) };
  }
  return { handled: false };
}
