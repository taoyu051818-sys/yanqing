import type { Ref, ComputedRef } from "vue";
import {
  useOperationTask,
  reasonField,
} from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import type { EventStatus, MatchStatus, EventDetail } from "../page-types.js";

interface ActionContext {
  eventDetail: Ref<EventDetail | null, EventDetail | EventDetail | null>;
  showPublish: ComputedRef<boolean>;
  task: ReturnType<typeof useOperationTask>;
  load: (
    preferredId?: string,
    preferredRound?: number,
    hydrate?: boolean,
  ) => Promise<void>;
  showCancel: ComputedRef<boolean>;
  mayManageEvent: ComputedRef<boolean>;
  loading: Ref<boolean, boolean>;
  actionKey: Ref<string, string>;
  errorMessage: Ref<string, string>;
  eventCode: Ref<string, string>;
  eventName: Ref<string, string>;
  eventDate: Ref<string, string>;
  eventTime: Ref<string, string>;
  registrationEndDate: Ref<string, string>;
  registrationEndTime: Ref<string, string>;
  eventFeeYuan: Ref<string, string>;
  capacityOptions: number[];
  eventCapacityIndex: Ref<number, number>;
  eventSponsor: Ref<string, string>;
  causeMessage: (cause: unknown, fallback: string) => string;
}

export function useEventCatalogActions({
  eventDetail,
  showPublish,
  task,
  load,
  showCancel,
  mayManageEvent,
  loading,
  actionKey,
  errorMessage,
  eventCode,
  eventName,
  eventDate,
  eventTime,
  registrationEndDate,
  registrationEndTime,
  eventFeeYuan,
  capacityOptions,
  eventCapacityIndex,
  eventSponsor,
  causeMessage,
}: ActionContext) {
  function publishEvent() {
    const event = eventDetail.value;
    if (!event || !showPublish.value) return;
    task.start({
      title: "发布赛事",
      description:
        event.name + " · 发布后进入报名期，请先核对时间、费用、名额和规则。",
      confirmText: "确认发布赛事",
      fields: [{ key: "reason", label: "发布说明", required: false, max: 300 }],
      submit: async ({ reason }) => {
        await endpoints.publishEvent(event.id, reason ? { reason } : {});
        await load(event.id);
        return "赛事已发布，用户可报名。";
      },
    });
  }

  function cancelEvent() {
    const event = eventDetail.value;
    if (!event || !showCancel.value) return;
    task.start({
      title: "取消整场赛事",
      description:
        event.name +
        " · 待付订单与候补取消，已付报名生成退款申请，仍须另一名财务或管理员审批。",
      confirmText: "确认取消整场赛事",
      fields: [
        reasonField("取消原因", [
          "成赛人数不足",
          "场馆临时维护",
          "组织安排有变",
        ]),
      ],
      submit: async ({ reason }) => {
        await withPendingCreationKey(
          "event.cancel",
          { eventId: event.id, reason },
          (idempotencyKey) =>
            endpoints.cancelEvent(event.id, { reason, idempotencyKey }),
        );
        await load(event.id);
        return "赛事已取消，退款申请已转财务复核，尚不代表已到账。";
      },
    });
  }

  async function createEvent() {
    if (!mayManageEvent.value || loading.value || actionKey.value) return;
    errorMessage.value = "";
    const code = eventCode.value.trim();
    const name = eventName.value.trim();
    const startsAt = `${eventDate.value}T${eventTime.value}:00+08:00`;
    const registrationEndsAt = `${registrationEndDate.value}T${registrationEndTime.value}:00+08:00`;
    const fee = Number(eventFeeYuan.value);
    const capacityPeople = capacityOptions[eventCapacityIndex.value];
    if (!code || code.length > 40 || !name || name.length > 120) {
      errorMessage.value = "赛事编码和名称不能为空，且不能超过规定长度。";
      return;
    }
    if (
      new Date(startsAt) <= new Date() ||
      new Date(registrationEndsAt) <= new Date()
    ) {
      errorMessage.value = "开赛与报名截止时间都必须晚于当前时间。";
      return;
    }
    if (new Date(registrationEndsAt) >= new Date(startsAt)) {
      errorMessage.value = "报名截止时间必须早于开赛时间。";
      return;
    }
    if (
      !Number.isFinite(fee) ||
      fee < 0 ||
      Math.abs(Math.round(fee * 100) - fee * 100) > 1e-6
    ) {
      errorMessage.value = "报名费必须是非负金额，最多两位小数。";
      return;
    }
    const confirmed = await uni.showModal({
      title: "确认创建赛事草稿",
      content: `${name}\n${eventDate.value} ${eventTime.value} 开赛\n${capacityPeople} 人封顶 · 24 人成赛 · 固定五轮\n创建后仍需复核并发布。`,
      confirmText: "创建草稿",
    });
    if (!confirmed.confirm) return;
    actionKey.value = "create-event";
    uni.showLoading({ title: "创建中", mask: true });
    try {
      const created: any = await endpoints.createEvent({
        code,
        name,
        startsAt,
        registrationEndsAt,
        capacityPeople,
        minimumPeople: 24,
        totalRounds: 5,
        feeCents: Math.round(fee * 100),
        sponsor: eventSponsor.value.trim() || undefined,
        rules: [
          "固定搭档双打，男双、女双、混双同场",
          "每场一局21分，20平后不加分",
          "五轮瑞士积分制，尽量避免重复对手",
        ],
      });
      eventName.value = "";
      eventCode.value = `EV-${Date.now().toString().slice(-8)}`;
      await load(created.id, undefined, false);
      uni.showToast({ title: "赛事草稿已创建", icon: "success" });
    } catch (cause) {
      errorMessage.value = causeMessage(cause, "赛事创建失败");
    } finally {
      uni.hideLoading();
      actionKey.value = "";
    }
  }
  return { publishEvent, cancelEvent, createEvent };
}
