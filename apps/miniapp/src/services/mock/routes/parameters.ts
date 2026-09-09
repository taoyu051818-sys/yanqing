import { mockUser } from "../core";
import {
  getSystemParameters,
  getAuditLogs,
  saveSystemParameters,
  saveAuditLogs,
} from "../state";
import {
  ok,
  mockRoles,
  hasMockRole,
  requireMockRole,
  text,
  newId,
} from "../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "./route-contract.js";

export async function handleParametersGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/parameters" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const prefix = text(data.prefix);
    return {
      handled: true,
      value: ok(
        getSystemParameters().filter(
          (item) => !prefix || String(item.key).startsWith(prefix),
        ),
      ),
    };
  }
  return { handled: false };
}

export async function handleParametersPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/parameters" && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const key = text(data.key);
    const description = text(data.description);
    const effectiveFrom = new Date(String(data.effectiveFrom || ""));
    if (!key || key.length > 120)
      throw new Error("参数键不能为空且不能超过120字符");
    if (description.length < 2 || description.length > 300)
      throw new Error("参数说明长度必须为2-300字符");
    if (!Number.isFinite(effectiveFrom.getTime()))
      throw new Error("生效时间无效");
    if (key === "training.contract_rate_bps" && Number(data.value) !== 2000)
      throw new Error("培训计入场馆合同收入比例锁定为20%");
    if (key === "training.venue_fee_cents" && Number(data.value) !== 0)
      throw new Error("培训不得另收场地费");
    if (
      key === "finance.operating_share_rate_bps" &&
      (text(data.type) !== "INTEGER" ||
        !Number.isSafeInteger(data.value) ||
        Number(data.value) < 0 ||
        Number(data.value) > 10_000)
    )
      throw new Error("经营分成比例必须为0-10000的整数基点");
    const parameters = getSystemParameters();
    const current = parameters
      .filter((item) => item.key === key)
      .sort((a, b) =>
        String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)),
      )[0];
    const locked = Boolean(data.locked) || key.startsWith("training.");
    if (
      current &&
      effectiveFrom.getTime() === new Date(current.effectiveFrom).getTime()
    ) {
      const sameCommand =
        JSON.stringify(current.value) === JSON.stringify(data.value) &&
        current.type === (text(data.type) || "STRING") &&
        current.description === description &&
        current.locked === locked;
      if (sameCommand) return { handled: true, value: ok(current) };
      throw new Error("同一参数与生效时间已被其他命令占用");
    }
    if (
      current &&
      effectiveFrom.getTime() <= new Date(current.effectiveFrom).getTime()
    )
      throw new Error("新版本生效时间必须晚于上一版本");
    if (current?.locked && !hasMockRole("SUPER_ADMIN"))
      throw new Error("锁定参数仅超级管理员可变更");
    if (current && !current.effectiveTo)
      current.effectiveTo = effectiveFrom.toISOString();
    const now = new Date().toISOString();
    const created = {
      id: newId("parameter"),
      key,
      value: data.value,
      type: text(data.type) || "STRING",
      description,
      locked,
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: null,
      createdById: mockUser().id,
      createdAt: now,
    };
    saveSystemParameters([created, ...parameters]);
    saveAuditLogs([
      {
        id: newId("audit"),
        actorId: mockUser().id,
        actor: { id: mockUser().id, displayName: mockUser().displayName },
        actorRole: mockRoles()[0],
        action: "PARAMETER_VERSION_CREATED",
        objectType: "SystemParameter",
        objectId: created.id,
        oldValue: current ? { id: current.id, value: current.value } : null,
        newValue: {
          key,
          value: data.value,
          effectiveFrom: created.effectiveFrom,
        },
        reason: text(data.reason) || description,
        result: "SUCCESS",
        createdAt: now,
      },
      ...getAuditLogs(),
    ]);
    return { handled: true, value: ok(created) };
  }
  return { handled: false };
}
