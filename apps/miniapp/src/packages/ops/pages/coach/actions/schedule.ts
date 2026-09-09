import type { Ref, ComputedRef } from "vue";
import { endpoints } from "../../../../../services/api";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";

interface ActionContext {
  sessionDate: Ref<string, string>;
  selectedCourtIds: Ref<string[], string[]>;
  loadCourtAvailability: () => Promise<void>;
  blockedCourtIds: ComputedRef<Set<string>>;
  canCreateSession: ComputedRef<boolean>;
  actionKey: Ref<string, string>;
  errorMessage: Ref<string, string>;
  selectedSessionClass: ComputedRef<any>;
  sessionStartsAt: ComputedRef<string>;
  sessionEndsAt: ComputedRef<string>;
  requiredReason: (value: string) => string;
  sessionReason: Ref<string, string>;
  sessionNote: Ref<string, string>;
  sessionCourts: ComputedRef<
    { id: string; name: string; usage: string; enabled: boolean }[]
  >;
  sessionStartTime: Ref<string, string>;
  sessionEndTime: Ref<string, string>;
  runCreation: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
  ) => Promise<boolean>;
}

export function useCoachScheduleActions({
  sessionDate,
  selectedCourtIds,
  loadCourtAvailability,
  blockedCourtIds,
  canCreateSession,
  actionKey,
  errorMessage,
  selectedSessionClass,
  sessionStartsAt,
  sessionEndsAt,
  requiredReason,
  sessionReason,
  sessionNote,
  sessionCourts,
  sessionStartTime,
  sessionEndTime,
  runCreation,
}: ActionContext) {
  async function changeSessionDate(event: any) {
    sessionDate.value = event.detail.value;
    selectedCourtIds.value = [];
    await loadCourtAvailability();
  }

  function changeSessionCourts(event: any) {
    selectedCourtIds.value = Array.isArray(event.detail.value)
      ? event.detail.value
      : [];
  }

  function isCourtBlocked(courtId: string) {
    return blockedCourtIds.value.has(courtId);
  }

  async function createSession() {
    if (!canCreateSession.value || actionKey.value) return;
    errorMessage.value = "";
    try {
      const trainingClass = selectedSessionClass.value;
      const startsAt = sessionStartsAt.value;
      const endsAt = sessionEndsAt.value;
      const startsTime = new Date(startsAt).getTime();
      const endsTime = new Date(endsAt).getTime();
      const reason = requiredReason(sessionReason.value);
      const note = sessionNote.value.trim();
      const courtIds = [...new Set(selectedCourtIds.value)].sort();
      if (!trainingClass) throw new Error("当前角色没有可排课的有效班级。");
      if (
        !Number.isFinite(startsTime) ||
        !Number.isFinite(endsTime) ||
        endsTime <= startsTime
      ) {
        throw new Error("课次结束时间必须晚于开始时间。");
      }
      if (startsTime <= Date.now())
        throw new Error("课次开始时间必须晚于当前时间。");
      if (!courtIds.length) throw new Error("请至少选择一个可用场地。");
      const blocked = courtIds.filter((courtId) => isCourtBlocked(courtId));
      if (blocked.length)
        throw new Error("所选场地在该时段已预约或封场，请重新选择。");
      if (note.length > 300) throw new Error("课次备注不能超过 300 个字符。");
      const command = {
        classId: trainingClass.id,
        startsAt,
        endsAt,
        courtIds,
        note: note || undefined,
        reason,
      };
      const courtNames = courtIds
        .map(
          (id) =>
            sessionCourts.value.find((court) => court.id === id)?.name || id,
        )
        .join("、");
      const modal = await uni.showModal({
        title: "确认创建培训课次",
        content: `${trainingClass.name}\n${sessionDate.value} ${sessionStartTime.value}-${sessionEndTime.value}\n场地：${courtNames}\n原因：${reason}`,
        confirmText: "确认排课",
      });
      if (!modal.confirm) return;
      const succeeded = await runCreation(
        "create-session",
        "培训课次与场地占用已原子创建。",
        () =>
          withPendingCreationKey(
            "training.session.create",
            command,
            (creationIdempotencyKey) =>
              endpoints.createTrainingSession({
                ...command,
                creationIdempotencyKey,
              }),
          ),
      );
      if (succeeded) {
        selectedCourtIds.value = [];
        sessionNote.value = "";
        sessionReason.value = "";
      }
    } catch (cause: any) {
      errorMessage.value = cause?.message || "培训课次表单校验失败。";
    }
  }
  return {
    changeSessionDate,
    changeSessionCourts,
    isCourtBlocked,
    createSession,
  };
}
