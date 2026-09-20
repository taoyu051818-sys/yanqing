import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import { getAuditLogs, getTrainingProducts, saveAuditLogs } from "../state";

export type MockTrainingRoute =
  { handled: false } | { handled: true; value: any };

export const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const integer = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : NaN;
};

export const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const roles = (): AppRole[] =>
  mockUser().roles.map((role: any) =>
    typeof role === "string" ? role : role.role,
  );

export const hasRole = (...allowed: AppRole[]) =>
  allowed.some((role) => roles().includes(role));

export const requireRole = (...allowed: AppRole[]) => {
  if (!hasRole(...allowed))
    throw new Error(`当前角色无权执行该操作，需要：${allowed.join("、")}`);
};

export const requireText = (
  value: unknown,
  label: string,
  min: number,
  max: number,
) => {
  const normalized = text(value);
  if (normalized.length < min || normalized.length > max)
    throw new Error(`${label}长度必须为${min}-${max}个字符`);
  return normalized;
};

export const optionalId = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === "") return null;
  const normalized = text(value);
  if (!normalized) throw new Error(`${label}不能为空白字符`);
  return normalized;
};

export { normalize, commandHash } from "../policies/command-hash";

export const audit = (input: {
  action: string;
  objectType: string;
  objectId: string;
  reason: string;
  requestId: string;
  oldValue?: any;
  newValue?: any;
}) => {
  saveAuditLogs([
    {
      id: newId("audit"),
      actorId: mockUser().id,
      actor: { id: mockUser().id, displayName: mockUser().displayName },
      actorRole: mockUser().primaryRole,
      result: "SUCCESS",
      createdAt: new Date().toISOString(),
      ...input,
    },
    ...getAuditLogs(),
  ]);
};

export const classContext = (classId: string | null) => {
  if (!classId) return null;
  for (const product of getTrainingProducts()) {
    const trainingClass = (product.classes || []).find(
      (item: any) => item.id === classId,
    );
    if (trainingClass)
      return {
        ...trainingClass,
        productId: trainingClass.productId || product.id,
        product,
      };
  }
  return null;
};
