import { hasMockRole, requireMockRole } from "../../policies/common";
import { handleAttendancePost } from "./attendance";
import { handleConsumePost, handleConfirmConsumePost } from "./consumption";
import type { MockRouteOptions, MockRouteResult } from "../route-contract";

export async function handleTrainingBatchPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const match = url.match(
    /^\/training\/sessions\/([^/]+)\/batch\/(attendance|proposal|confirmation)$/,
  );
  if (!match || method !== "POST") return { handled: false };
  const [, id, action] = match;
  if (action === "confirmation") requireMockRole("ADMIN", "SUPER_ADMIN");
  else if (action === "proposal") {
    requireMockRole("COACH");
    if (hasMockRole("ADMIN", "SUPER_ADMIN"))
      throw new Error("管理员请使用确认消课");
  } else requireMockRole("COACH", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
  if (
    !Array.isArray(data.items) ||
    !data.items.length ||
    data.items.length > 50 ||
    new Set(data.items.map((item: any) => item.enrollmentId)).size !==
      data.items.length
  )
    throw new Error("请选择 1–50 位不同学员");
  const results = [];
  for (const item of data.items) {
    try {
      if (action === "attendance")
        await handleAttendancePost(
          method,
          `/training/sessions/${id}/attendance`,
          { enrollmentId: item.enrollmentId, status: "ATTENDED" },
          options,
        );
      else if (action === "proposal")
        await handleConsumePost(
          method,
          `/training/sessions/${id}/consume`,
          { enrollmentId: item.enrollmentId },
          options,
        );
      else
        await handleConfirmConsumePost(
          method,
          `/training/sessions/${id}/consume/confirm`,
          item,
          options,
        );
      results.push({ enrollmentId: item.enrollmentId, status: "SUCCEEDED" });
    } catch (error: any) {
      results.push({
        enrollmentId: item.enrollmentId,
        status: "FAILED",
        message: error.message,
      });
    }
  }
  return { handled: true, value: { results } };
}
