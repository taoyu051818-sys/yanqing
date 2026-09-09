import {
  mockTrainingProductView,
  validateMockYouthProduct,
} from "../../training-operations";
import { getTrainingProducts, saveTrainingProducts } from "../../state";
import {
  ok,
  hasMockRole,
  requireMockRole,
  text,
  integer,
  newId,
} from "../../policies/common.js";
import {
  requireTrainingCreationReason,
  beginMockTrainingCreation,
  finishMockTrainingCreation,
} from "../../policies/training.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleTrainingProductsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/products" && method === "GET")
    return {
      handled: true,
      value: ok(
        getTrainingProducts()
          .filter(
            (product) =>
              hasMockRole("ADMIN", "SUPER_ADMIN") || product.enabled !== false,
          )
          .map((product) =>
            mockTrainingProductView(product, {
              showAssignments: hasMockRole(
                "FRONT_DESK",
                "COACH",
                "ADMIN",
                "SUPER_ADMIN",
              ),
              coachOnly:
                hasMockRole("COACH") && !hasMockRole("ADMIN", "SUPER_ADMIN"),
            }),
          ),
      ),
    };
  return { handled: false };
}

export async function handleTrainingProductsPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/products" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code).toUpperCase();
    const name = text(data.name);
    const audience = text(data.audience);
    const totalSessions = integer(data.totalSessions);
    const validityDays = integer(data.validityDays);
    const priceCents = integer(data.priceCents);
    const refundRule = data.refundRule;
    const reason = requireTrainingCreationReason(data.reason);
    if (!code || code.length > 40 || !name || name.length > 100)
      throw new Error("课程产品编码和名称不能为空且不能超过规定长度");
    if (!["ADULT", "YOUTH"].includes(audience))
      throw new Error("课程产品适用人群无效");
    if (totalSessions < 1) throw new Error("课程总课次必须为正整数");
    if (validityDays < 1) throw new Error("课程有效期必须为正整数天");
    if (priceCents < 1) throw new Error("课程售价必须大于0");
    if (
      !refundRule ||
      typeof refundRule !== "object" ||
      Array.isArray(refundRule)
    )
      throw new Error("退费规则必须为对象");
    const command = {
      code,
      name,
      audience,
      totalSessions,
      validityDays,
      priceCents,
      refundRule,
      reason,
    };
    const attempt = beginMockTrainingCreation(
      data.creationIdempotencyKey,
      "TRAINING_PRODUCT_CREATED",
      "TrainingProduct",
      command,
    );
    if (attempt.replayed)
      return {
        handled: true,
        value: finishMockTrainingCreation(attempt, attempt.response, reason),
      };
    const regulatoryValidation =
      audience === "YOUTH"
        ? validateMockYouthProduct({ totalSessions, validityDays, priceCents })
        : null;
    const products = getTrainingProducts();
    if (products.some((product) => text(product.code).toUpperCase() === code))
      throw new Error("课程产品编码已存在");
    const product = {
      id: newId("training-product"),
      code,
      name,
      audience,
      totalSessions,
      validityDays,
      priceCents,
      unitRevenueCents: Math.round(priceCents / totalSessions),
      refundRule,
      enabled: true,
      classes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      regulatoryValidation,
    };
    saveTrainingProducts([product, ...products]);
    return {
      handled: true,
      value: finishMockTrainingCreation(attempt, product, reason),
    };
  }
  return { handled: false };
}

export async function handleTrainingClassesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/training/classes" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const code = text(data.code).toUpperCase();
    const productId = text(data.productId);
    const name = text(data.name);
    const coachId = text(data.coachId) || null;
    const assistantId = text(data.assistantId) || null;
    const schedule = data.schedule as Record<string, unknown> | undefined;
    const capacity = integer(data.capacity);
    const coachCostCents = integer(data.coachCostCents ?? 0);
    const assistantCostCents = integer(data.assistantCostCents ?? 0);
    const materialCostCents = integer(data.materialCostCents ?? 0);
    const reason = requireTrainingCreationReason(data.reason);
    if (!code || code.length > 40 || !name || name.length > 100)
      throw new Error("培训班级编码和名称不能为空且不能超过规定长度");
    if (!productId) throw new Error("必须选择课程产品");
    if (!schedule || typeof schedule !== "object" || Array.isArray(schedule))
      throw new Error("班级课表配置不能为空");
    const weekday = integer(schedule.weekday);
    const scheduleStartsAt = text(schedule.startsAt);
    const scheduleEndsAt = text(schedule.endsAt);
    if (
      weekday < 1 ||
      weekday > 7 ||
      !/^\d{2}:\d{2}$/.test(scheduleStartsAt) ||
      !/^\d{2}:\d{2}$/.test(scheduleEndsAt) ||
      scheduleEndsAt <= scheduleStartsAt
    )
      throw new Error("班级课表时间设置无效");
    if (capacity < 1 || capacity > 100) throw new Error("班级容量必须为1-100");
    if (
      [coachCostCents, assistantCostCents, materialCostCents].some(
        (value) => value < 0,
      )
    )
      throw new Error("班级成本必须为非负整数分");
    const normalizedSchedule = {
      ...schedule,
      weekday,
      startsAt: scheduleStartsAt,
      endsAt: scheduleEndsAt,
    };
    const command = {
      code,
      productId,
      name,
      coachId,
      assistantId,
      schedule: normalizedSchedule,
      capacity,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
      reason,
    };
    const attempt = beginMockTrainingCreation(
      data.creationIdempotencyKey,
      "TRAINING_CLASS_CREATED",
      "TrainingClass",
      command,
    );
    if (attempt.replayed)
      return {
        handled: true,
        value: finishMockTrainingCreation(attempt, attempt.response, reason),
      };
    const products = getTrainingProducts();
    const product = products.find(
      (item) => item.id === productId && item.enabled !== false,
    );
    if (!product) throw new Error("培训产品不存在或已停用");
    if (
      products
        .flatMap((item) => item.classes || [])
        .some((item: any) => text(item.code).toUpperCase() === code)
    )
      throw new Error("培训班级编码已存在");
    const trainingClass = {
      id: newId("training-class"),
      code,
      productId,
      name,
      coachId,
      assistantId,
      schedule: normalizedSchedule,
      capacity,
      coachCostCents,
      assistantCostCents,
      materialCostCents,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    product.classes = [trainingClass, ...(product.classes || [])];
    saveTrainingProducts(products);
    return {
      handled: true,
      value: finishMockTrainingCreation(attempt, trainingClass, reason),
    };
  }
  return { handled: false };
}
