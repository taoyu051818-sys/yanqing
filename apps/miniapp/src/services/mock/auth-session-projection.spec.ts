import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockRequest } from "./router";
import {
  getGovernanceUsers,
  resetCatalogState,
  saveGovernanceUsers,
} from "./state";

const storage = new Map<string, unknown>();

vi.stubGlobal("uni", {
  getStorageSync: (key: string) => storage.get(key) ?? "",
  setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  removeStorageSync: (key: string) => storage.delete(key),
});

describe("miniapp mock auth session projection", () => {
  beforeEach(() => {
    storage.clear();
    resetCatalogState();
  });

  it("returns the safe /auth/me contract without persisted identity fields", async () => {
    const users = getGovernanceUsers();
    const member = users.find((item) => item.id === "user-member")!;
    Object.assign(member, {
      avatarUrl: "https://example.test/avatar.png",
      openId: "private-open-id",
      unionId: "private-union-id",
      referrerId: "user-host",
      deletedAt: null,
      createdAt: "2026-08-30T00:00:00.000Z",
      memberProfile: {
        level: "GOLD",
        tags: ["regular"],
        isNewCustomer: false,
        phone: "13800000005",
        consentVersion: "private-consent-version",
      },
    });
    saveGovernanceUsers(users);

    await mockRequest("POST", "/auth/dev-login", { role: "MEMBER" });
    const me = await mockRequest<Record<string, unknown>>("GET", "/auth/me");

    expect(me).toMatchObject({
      id: "user-member",
      displayName: "延庆会员小林",
      avatarUrl: "https://example.test/avatar.png",
      primaryRole: "MEMBER",
      hasReferrer: true,
      memberProfile: {
        level: "GOLD",
        tags: ["regular"],
        isNewCustomer: false,
      },
    });
    for (const field of [
      "openId",
      "unionId",
      "referrerId",
      "phone",
      "status",
      "deletedAt",
      "createdAt",
      "wechatBound",
    ]) {
      expect(me).not.toHaveProperty(field);
    }
    expect(me.memberProfile).not.toHaveProperty("phone");
    expect(me.memberProfile).not.toHaveProperty("consentVersion");
    expect(me.roles).toEqual([{ role: "MEMBER" }]);
  });
});
