import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getAuditLogs,
  getGovernanceUsers,
  getMerchants,
  getRiskEvents,
  resetCatalogState,
  saveMerchants,
} from "./state";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

const request = <T = any>(
  method: string,
  url: string,
  data: Record<string, unknown> = {},
) => mockRequest<T>(method, url, data);
const login = (role: string) => request("POST", "/auth/dev-login", { role });

describe("miniapp mock governance operations", () => {
  beforeEach(async () => {
    storage.clear();
    resetCatalogState();
    await login("ADMIN");
  });

  it("lets an admin inspect organization users but only a super admin change roles", async () => {
    const listed = await request<any>("GET", "/governance/users", {
      keyword: "小林",
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      id: "user-member",
      primaryRole: "MEMBER",
      wechatBound: true,
    });
    expect(JSON.stringify(listed)).not.toContain("openId");

    const command = {
      roles: ["MEMBER", "FRONT_DESK"],
      primaryRole: "FRONT_DESK",
      reason: "前台员工入职授权",
    };
    await expect(
      request("POST", "/governance/users/user-member/roles", command),
    ).rejects.toThrow("无权");

    await login("SUPER_ADMIN");
    const auditBefore = getAuditLogs().length;
    const changed = await request(
      "POST",
      "/governance/users/user-member/roles",
      command,
    );
    expect(changed).toMatchObject({ primaryRole: "FRONT_DESK" });
    expect(getGovernanceUsers().find((item) => item.id === "user-member"))
      .toMatchObject({ primaryRole: "FRONT_DESK" });
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);

    await request("POST", "/governance/users/user-member/roles", command);
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);
  });

  it("keeps finance in maker review and reserves terminal risk decisions for administrators", async () => {
    await login("FINANCE");
    const auditBefore = getAuditLogs().length;
    const reviewed = await request(
      "POST",
      "/governance/risk-events/risk-mock-1/review",
      { reason: "核对设备与领取证据" },
    );
    expect(reviewed).toMatchObject({ status: "REVIEWING" });
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);
    await expect(
      request("POST", "/governance/risk-events/risk-mock-1/resolve", {
        reason: "越权关闭风险",
      }),
    ).rejects.toThrow("无权");

    await login("ADMIN");
    const resolved = await request(
      "POST",
      "/governance/risk-events/risk-mock-1/resolve",
      { reason: "证据核验完成并冻结异常券" },
    );
    expect(resolved).toMatchObject({ status: "RESOLVED" });
    expect(getRiskEvents().find((item) => item.id === "risk-mock-1"))
      .toMatchObject({ status: "RESOLVED", resolvedBy: "user-admin" });
  });

  it("applies persisted role and status changes to the next mock login", async () => {
    await login("SUPER_ADMIN");
    await request("POST", "/governance/users/user-member/roles", {
      roles: ["MEMBER", "FRONT_DESK"],
      primaryRole: "FRONT_DESK",
      reason: "会员转为前台员工",
    });
    const promoted = await login("MEMBER");
    expect(promoted.user).toMatchObject({
      primaryRole: "FRONT_DESK",
      roles: expect.arrayContaining([
        expect.objectContaining({ role: "FRONT_DESK" }),
      ]),
    });

    await login("SUPER_ADMIN");
    await request("POST", "/governance/users/user-member/status", {
      status: "DISABLED",
      reason: "员工离岗停用账户",
    });
    await expect(login("MEMBER")).rejects.toThrow("已停用");
  });

  it("validates merchant role scope and precisely replays one keyed role command", async () => {
    await login("SUPER_ADMIN");
    const baseCommand = {
      roles: ["MEMBER", "MERCHANT"],
      primaryRole: "MERCHANT",
      reason: "授权联盟商户岗位",
      idempotencyKey: "governance-role-merchant-1",
    };

    await expect(
      request("POST", "/governance/users/user-member/roles", {
        ...baseCommand,
        merchantId: "merchant-missing",
      }),
    ).rejects.toThrow("有效商户不存在");

    const merchants = getMerchants();
    const coffee = merchants.find((item) => item.id === "merchant-coffee")!;
    coffee.status = "DISABLED";
    saveMerchants(merchants);
    await expect(
      request("POST", "/governance/users/user-member/roles", {
        ...baseCommand,
        merchantId: coffee.id,
      }),
    ).rejects.toThrow("有效商户不存在");

    coffee.status = "ACTIVE";
    saveMerchants(merchants);
    const command = { ...baseCommand, merchantId: coffee.id };
    const auditBefore = getAuditLogs().length;
    await expect(
      request("POST", "/governance/users/user-member/roles", command),
    ).resolves.toMatchObject({ primaryRole: "MERCHANT" });
    await expect(
      request("POST", "/governance/users/user-member/roles", command),
    ).resolves.toMatchObject({ primaryRole: "MERCHANT" });
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);

    await expect(
      request("POST", "/governance/users/user-member/roles", {
        ...command,
        reason: "同一幂等键改写授权原因",
      }),
    ).rejects.toThrow("治理操作幂等键已用于不同命令");
    expect(getAuditLogs()).toHaveLength(auditBefore + 1);
  });

  it("enforces the fixed training contract ratio and zero venue fee in parameter versions", async () => {
    const effectiveFrom = new Date(Date.now() + 365 * 86_400_000).toISOString();
    await expect(
      request("POST", "/parameters", {
        key: "training.contract_rate_bps",
        type: "INTEGER",
        value: 2500,
        description: "尝试修改合同计提比例",
        effectiveFrom,
      }),
    ).rejects.toThrow("锁定为20%");
    await expect(
      request("POST", "/parameters", {
        key: "training.venue_fee_cents",
        type: "INTEGER",
        value: 1,
        description: "尝试新增培训场地费",
        effectiveFrom,
      }),
    ).rejects.toThrow("不得另收场地费");
  });
});
