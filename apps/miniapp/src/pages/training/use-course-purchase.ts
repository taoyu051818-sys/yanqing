import { computed, ref, type Ref } from "vue";
import type { TrainingProductView, TrainingStudentView } from "@yanqing/shared";
import { useSessionStore } from "../../stores/session";
import { endpoints } from "../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../services/auth-session";
import { openMemberPage } from "../../utils/member-navigation";
import { withPendingCreationKey } from "../../utils/pending-creation-key";

/** Owns class/student selection, validation and order creation. */
export function useCoursePurchase({
  students,
  login,
  onNeedsStudent,
}: {
  students: Ref<TrainingStudentView[]>;
  login: () => unknown;
  onNeedsStudent: () => void;
}) {
  const session = useSessionStore();
  const purchasingId = ref("");
  const selectedProductId = ref("");
  const selectedClassId = ref("");
  const selectedStudentId = ref("");
  const purchaseFor = ref<"SELF" | "STUDENT">("SELF");
  const purchasingForStudent = (product: { audience: string }) =>
    product.audience === "YOUTH" ||
    (product.audience === "ALL" && purchaseFor.value === "STUDENT");
  const purchaseError = ref("");
  const eligibleStudents = computed(() =>
    students.value.filter((item) => item.guardianConsentStatus),
  );
  function preparePurchase(product: TrainingProductView) {
    if (!session.isAuthenticated) return login();
    if (purchasingId.value) return;
    selectedProductId.value = product.id;
    purchaseFor.value = product.audience === "YOUTH" ? "STUDENT" : "SELF";
    selectedClassId.value =
      product.classes?.length === 1 ? product.classes[0].id : "";
    selectedStudentId.value =
      eligibleStudents.value.length === 1 ? eligibleStudents.value[0].id : "";
    purchaseError.value = "";
    if (product.audience === "YOUTH" && !eligibleStudents.value.length) {
      onNeedsStudent();
    }
  }
  async function purchase(product: TrainingProductView) {
    if (!session.isAuthenticated) return login();
    if (purchasingId.value) return;
    purchaseError.value = "";
    if (
      product.classes?.length &&
      !product.classes.some((item) => item.id === selectedClassId.value)
    ) {
      purchaseError.value = "请先选择上课班级";
      return;
    }
    if (
      purchasingForStudent(product) &&
      !eligibleStudents.value.some(
        (item) => item.id === selectedStudentId.value,
      )
    ) {
      purchaseError.value =
        "请选择已由监护人授权的学员；没有档案时可在上方新建";
      return;
    }
    purchasingId.value = product.id;
    const owner = captureAuthSession();
    try {
      const command = {
        productId: product.id,
        classId: selectedClassId.value || undefined,
        studentId: purchasingForStudent(product)
          ? selectedStudentId.value
          : undefined,
        sourceChannel: "MINI_PROGRAM",
      };
      const order = await withPendingCreationKey(
        "training.purchase",
        command,
        (creationIdempotencyKey) =>
          endpoints.purchaseTraining({ ...command, creationIdempotencyKey }),
      );
      if (!isAuthSessionCurrent(owner)) return;
      await openMemberPage(
        "/pages/order/index?id=" + encodeURIComponent(order.id),
      );
    } catch (cause: any) {
      if (!isAuthSessionCurrent(owner)) return;
      purchaseError.value = cause.message || "报名失败，请重试";
    } finally {
      purchasingId.value = "";
    }
  }
  function resetPurchase() {
    selectedProductId.value = "";
    selectedClassId.value = "";
    selectedStudentId.value = "";
    purchaseFor.value = "SELF";
    purchaseError.value = "";
  }

  return {
    purchasingId,
    selectedProductId,
    selectedClassId,
    selectedStudentId,
    purchaseFor,
    purchasingForStudent,
    purchaseError,
    eligibleStudents,
    preparePurchase,
    purchase,
    resetPurchase,
  };
}
