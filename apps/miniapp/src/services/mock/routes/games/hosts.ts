import { mockUser } from "../../core";
import { getHostApplications, saveHostApplications } from "../../state";
import { ok, requireMockRole, text, newId } from "../../policies/common.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleGamesHostsApplyPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/games/hosts/apply" && method === "POST") {
    requireMockRole("MEMBER");
    const applications = getHostApplications();
    const existing = applications.find((item) => item.userId === mockUser().id);
    if (existing?.status === "APPROVED") throw new Error("已经是球局主理人");
    if (existing?.status === "APPLIED") {
      // 首次读取可能来自动态种子；落盘后重放必须返回同一份申请。
      saveHostApplications(applications);
      return { handled: true, value: ok(existing) };
    }
    const profile = existing || {
      id: newId("host-profile"),
      userId: mockUser().id,
      user: { id: mockUser().id, displayName: mockUser().displayName },
    };
    Object.assign(profile, {
      status: "APPLIED",
      appliedAt: new Date().toISOString(),
      suspendedReason: null,
    });
    if (!existing) applications.push(profile);
    saveHostApplications(applications);
    return { handled: true, value: ok(profile) };
  }
  return { handled: false };
}

export async function handleGamesHostApplicationsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/games/host-applications" && method === "GET") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        getHostApplications().filter((item) => item.status === "APPLIED"),
      ),
    };
  }
  return { handled: false };
}

export async function handleReviewHostPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const reviewHostMatch = url.match(
    /^\/games\/hosts\/([^/]+)\/(approve|reject)$/,
  );
  if (reviewHostMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const [, userId, action] = reviewHostMatch;
    const applications = getHostApplications();
    const profile = applications.find((item) => item.userId === userId);
    if (!profile) throw new Error("主理人申请不存在");
    if (profile.status !== "APPLIED") throw new Error("只有待审批申请可以处理");
    if (action === "reject" && text(data.reason).length < 2)
      throw new Error("驳回原因不能为空");
    profile.status = action === "approve" ? "APPROVED" : "REJECTED";
    profile.approvedAt = action === "approve" ? new Date().toISOString() : null;
    profile.suspendedReason = action === "reject" ? text(data.reason) : null;
    saveHostApplications(applications);
    return { handled: true, value: ok(profile) };
  }
  return { handled: false };
}

export async function handleGamesRewardsGrantMaturedPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (url === "/games/rewards/grant-matured" && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    return { handled: true, value: ok({ processed: 0, results: [] }) };
  }
  return { handled: false };
}
