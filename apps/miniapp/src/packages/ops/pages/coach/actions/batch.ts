import { endpoints } from "../../../../../services/api";
import {
  captureAuthSession,
  isAuthSessionCurrent,
} from "../../../../../services/auth-session";
import {
  completePendingCreation,
  getPendingCreationKey,
} from "../../../../../utils/pending-creation-key";
import type {
  TrainingBatchAction,
  TrainingBatchResult,
} from "../../../../../types/training-batch";

/** Keep an independent durable key for every posting, including ambiguous retries. */
export async function executeLessonBatch(
  sessionId: string,
  action: TrainingBatchAction,
  ids: string[],
) {
  const owner = captureAuthSession();
  const results: TrainingBatchResult[] = [];
  const commands = [...new Set(ids)].map((enrollmentId) => {
    const command = { sessionId, action, enrollmentId };
    const slot = `training.batch.${action}.${sessionId}.${enrollmentId}`;
    return {
      command,
      slot,
      enrollmentId,
      idempotencyKey: getPendingCreationKey(slot, command),
    };
  });
  for (let offset = 0; offset < commands.length; offset += 50) {
    if (!isAuthSessionCurrent(owner))
      throw new Error("登录身份已变化，请重新打开课次");
    const chunk = commands.slice(offset, offset + 50);
    try {
      const response = await endpoints.trainingBatch(sessionId, action, {
        items: chunk.map(({ enrollmentId, idempotencyKey }) => ({
          enrollmentId,
          idempotencyKey,
        })),
      });
      if (!isAuthSessionCurrent(owner))
        throw new Error("登录身份已变化，请重新打开课次");
      for (const item of chunk) {
        const result = response.results?.find(
          (entry) => entry.enrollmentId === item.enrollmentId,
        );
        if (result?.status === "SUCCEEDED") {
          completePendingCreation(item.slot, item.command, item.idempotencyKey);
          results.push(result);
        } else
          results.push({
            enrollmentId: item.enrollmentId,
            status: "FAILED",
            message: result?.message || "未收到处理结果，请刷新核对后重试",
          });
      }
    } catch (error: any) {
      if (!isAuthSessionCurrent(owner)) throw error;
      results.push(
        ...chunk.map((item) => ({
          enrollmentId: item.enrollmentId,
          status: "FAILED" as const,
          message: error?.message || "连接中断，请重试；已完成记录不会重复处理",
        })),
      );
      // A connection failure should not dispatch later chunks blindly.
      results.push(
        ...commands
          .slice(offset + 50)
          .map((item) => ({
            enrollmentId: item.enrollmentId,
            status: "FAILED" as const,
            message: "尚未提交，请重试",
          })),
      );
      break;
    }
  }
  return results;
}
