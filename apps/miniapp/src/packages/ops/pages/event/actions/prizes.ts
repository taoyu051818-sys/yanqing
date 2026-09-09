import type { EventTeam, InventoryItem } from "../page-types";
import type { Ref, ComputedRef } from "vue";
import type { useOperationTask } from "../../../components/operation-task";
import { endpoints } from "../../../../../services/api";
import { withPendingCreationKey } from "../../../../../utils/pending-creation-key";
import type {
  EventStatus,
  MatchStatus,
  EventDetail,
  EventPrizeAward,
} from "../page-types.js";

interface ActionContext {
  selectedPrizeTeamId: Ref<string, string>;
  completedTeams: ComputedRef<EventTeam[]>;
  selectedPrizeItemId: Ref<string, string>;
  availablePrizeItems: ComputedRef<InventoryItem[]>;
  eventDetail: Ref<EventDetail | null, EventDetail | EventDetail | null>;
  selectedPrizeTeam: ComputedRef<EventTeam | undefined>;
  selectedPrizeItem: ComputedRef<InventoryItem | undefined>;
  prizeAwardName: Ref<string, string>;
  prizeQuantity: Ref<number, number>;
  mayOperatePrizes: ComputedRef<boolean>;
  runAction: (
    key: string,
    successMessage: string,
    operation: () => Promise<unknown>,
    preferredRound?: number,
  ) => Promise<void>;
  totalRounds: ComputedRef<number>;
  task: ReturnType<typeof useOperationTask>;
  load: (
    preferredId?: string,
    preferredRound?: number,
    hydrate?: boolean,
  ) => Promise<void>;
}

export function useEventPrizesActions({
  selectedPrizeTeamId,
  completedTeams,
  selectedPrizeItemId,
  availablePrizeItems,
  eventDetail,
  selectedPrizeTeam,
  selectedPrizeItem,
  prizeAwardName,
  prizeQuantity,
  mayOperatePrizes,
  runAction,
  totalRounds,
  task,
  load,
}: ActionContext) {
  function choosePrizeTeam(event: any) {
    selectedPrizeTeamId.value =
      completedTeams.value[Number(event.detail.value)]?.id || "";
  }

  function choosePrizeItem(event: any) {
    selectedPrizeItemId.value =
      availablePrizeItems.value[Number(event.detail.value)]?.id || "";
  }

  async function issuePrize() {
    const event = eventDetail.value;
    const team = selectedPrizeTeam.value;
    const item = selectedPrizeItem.value;
    const awardName = prizeAwardName.value.trim();
    const quantity = Number(prizeQuantity.value);
    if (!event || event.status !== "COMPLETED" || !mayOperatePrizes.value)
      return;
    if (
      !team ||
      !item ||
      awardName.length < 2 ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      uni.showToast({
        title: "请选择队伍和库存，并填写有效奖项及数量",
        icon: "none",
      });
      return;
    }
    if (quantity > item.stock) {
      uni.showToast({ title: `库存仅剩 ${item.stock} 件`, icon: "none" });
      return;
    }
    const modal = await uni.showModal({
      title: "确认发放奖品",
      content: `第${team.finalRank}名 ${team.name}\n${awardName} · ${item.name} × ${quantity}\n确认后立即扣减库存。`,
    });
    if (!modal.confirm) return;
    await runAction(
      `prize:${team.id}:${item.id}`,
      "奖品已出库",
      () =>
        endpoints.issueEventPrize(event.id, {
          teamId: team.id,
          awardName,
          inventoryItemId: item.id,
          quantity,
          idempotencyKey: `event-prize-${event.id}-${Date.now()}`,
          note: "赛事工作台现场发放",
        }),
      totalRounds.value,
    );
  }

  function receivePrize(award: EventPrizeAward) {
    const event = eventDetail.value;
    if (!event || award.status !== "ISSUED" || !mayOperatePrizes.value) return;
    task.start({
      title: "奖品签收",
      description:
        award.awardName +
        " · " +
        (award.inventoryItem?.name || "库存奖品") +
        " × " +
        award.quantity +
        "。请选择实际到场签收人。",
      confirmText: "确认本人签收",
      fields: [
        {
          key: "receivedByName",
          label: "签收人",
          kind: "choices",
          options: award.recipientNames.map((value) => ({
            value,
            label: value,
          })),
        },
      ],
      submit: async ({ receivedByName }) => {
        const command = { receivedByName, note: "赛事工作台现场签收" };
        await withPendingCreationKey(
          "event.receipt." + award.id,
          command,
          (idempotencyKey) =>
            endpoints.receiveEventPrize(event.id, award.id, {
              ...command,
              idempotencyKey,
            }),
        );
        await load(event.id, totalRounds.value, false);
        return "奖品已签收，库存出库与签收记录可追溯。";
      },
    });
  }
  return { choosePrizeTeam, choosePrizeItem, issuePrize, receivePrize };
}
