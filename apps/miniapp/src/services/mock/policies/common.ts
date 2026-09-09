import type { AppRole } from "../../../types/domain";
import { mockUser } from "../core";
import { getOrders, saveOrders } from "../venue";
import {
  getEnrollments,
  getGames,
  getSystemParameters,
  saveEnrollments,
  saveEventDetail,
  saveGames,
} from "../state";
import { saveMockMasterAudit } from "./master-data.js";
import { promoteMockGameWaitlist } from "./games.js";
import { promoteMockEventWaitlist, requireEvent } from "./events.js";

export const ok = (value: any) => JSON.parse(JSON.stringify(value));

export const mockRoles = (): AppRole[] =>
  mockUser().roles.map((role) => (typeof role === "string" ? role : role.role));

export const hasMockRole = (...allowed: AppRole[]) =>
  allowed.some((role) => mockRoles().includes(role));

export const requireMockRole = (...allowed: AppRole[]) => {
  if (!hasMockRole(...allowed))
    throw new Error(`当前角色无权执行该操作，需要：${allowed.join("、")}`);
};

export const isMockMemberSelfService = () =>
  hasMockRole("MEMBER") &&
  !hasMockRole("FRONT_DESK", "EVENT_MANAGER", "ADMIN", "SUPER_ADMIN");

export const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const integer = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value)
    ? value
    : Number.isInteger(Number(value))
      ? Number(value)
      : NaN;

export const isExpired = (value: unknown) => {
  if (!value) return false;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) && time <= Date.now();
};

export const activeMockParameter = (key: string, at = new Date()) =>
  getSystemParameters()
    .filter(
      (item) =>
        item.key === key &&
        new Date(item.effectiveFrom).getTime() <= at.getTime() &&
        (!item.effectiveTo ||
          new Date(item.effectiveTo).getTime() > at.getTime()),
    )
    .sort(
      (left, right) =>
        new Date(right.effectiveFrom).getTime() -
        new Date(left.effectiveFrom).getTime(),
    )[0];

export const activeMockIntegerParameter = (
  key: string,
  fallback: number,
  at = new Date(),
) => {
  const value = activeMockParameter(key, at)?.value;
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : fallback;
};

export const requireIdempotencyKey = (value: unknown, label = "幂等键") => {
  const key = text(value);
  if (key.length < 8 || key.length > 100)
    throw new Error(`${label}长度必须为8-100个字符`);
  return key;
};

export const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const normalizeCreationCommand = (
  value: unknown,
  inArray = false,
): unknown => {
  if (value === undefined) return inArray ? null : undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value))
    return value.map((item) => normalizeCreationCommand(item, true));
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = normalizeCreationCommand(
        (value as Record<string, unknown>)[key],
      );
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  }
  return String(value);
};

export const creationCommandHash = (command: unknown) => {
  const canonical = JSON.stringify(normalizeCreationCommand(command));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
};

export function mockPendingDeadline(order: any) {
  const domain =
    order.bookings?.[0]?.holdExpiresAt ||
    order.eventTeam?.paymentDueAt ||
    order.trainingEnrollment?.seatReservedUntil;
  if (domain) return domain;
  return ["GAME", "TRAINING", "MEMBERSHIP", "RECHARGE", "GOODS"].includes(
    order.businessType,
  ) && order.createdAt
    ? new Date(new Date(order.createdAt).getTime() + 15 * 60_000).toISOString()
    : null;
}

export function expireMockPurchases() {
  const orders = getOrders(),
    games = getGames(),
    enrollments = getEnrollments();
  let changed = false;
  const pendingEvents = [
    ...new Set(
      orders
        .filter(
          (order) =>
            order.status === "PENDING" && order.businessType === "EVENT",
        )
        .map((order) => order.eventId || order.parameterSnapshot?.eventId)
        .filter(Boolean),
    ),
  ];
  for (const eventId of pendingEvents) {
    const detail = requireEvent(eventId);
    if (
      !(detail.teams || []).some(
        (team: any) =>
          team.status === "REGISTERED" &&
          team.paymentDueAt &&
          new Date(team.paymentDueAt).getTime() <= Date.now() &&
          orders.some(
            (order) => order.id === team.orderId && order.status === "PENDING",
          ),
      )
    )
      continue;
    const result = promoteMockEventWaitlist(detail, orders);
    if (result.expiredCount || result.promotions.length) {
      saveEventDetail(detail);
      changed = true;
    }
  }
  for (const order of [...orders]) {
    if (
      order.status !== "PENDING" ||
      !["GAME", "TRAINING", "MEMBERSHIP", "RECHARGE", "GOODS"].includes(
        order.businessType,
      )
    )
      continue;
    const deadline = mockPendingDeadline(order);
    if (!deadline || new Date(deadline).getTime() > Date.now()) continue;
    if (order.businessType === "GAME") {
      const game = games.find((item) =>
        item.registrations?.some((row: any) => row.orderId === order.id),
      );
      const registration = game?.registrations?.find(
        (row: any) => row.orderId === order.id,
      );
      if (registration?.status !== "REGISTERED") continue;
      registration.status = "CANCELLED";
      const promoted = promoteMockGameWaitlist(game);
      if (promoted) orders.unshift(promoted.order);
    }
    if (order.businessType === "TRAINING") {
      const enrollment = enrollments.find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (enrollment) {
        enrollment.status = "CANCELLED";
        enrollment.seatReservedUntil = null;
      }
    }
    if (order.businessType === "MEMBERSHIP" && order.membership)
      order.membership.status = "CANCELLED";
    order.status = "CANCELLED";
    order.cancelledAt = new Date().toISOString();
    changed = true;
    saveMockMasterAudit({
      action: order.businessType + "_ORDER_AUTO_CANCELLED",
      objectType: "Order",
      objectId: order.id,
      requestId: "AUTO:PURCHASE_ORDER:" + order.id,
      commandHash: "expired",
      oldValue: { status: "PENDING" },
      newValue: { status: "CANCELLED" },
      reason: "订单支付保留期届满",
    });
  }
  if (changed) {
    saveOrders(orders);
    saveGames(games);
    saveEnrollments(enrollments);
  }
}
