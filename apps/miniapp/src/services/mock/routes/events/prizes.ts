import { mockUser } from "../../core";
import {
  getGoods,
  getInventoryTransactions,
  saveEventDetail,
  saveGoods,
  saveInventoryTransactions,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  integer,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import { requireEvent, publicEventPrizeAward } from "../../policies/events.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleEventPrizesGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const eventPrizesMatch = url.match(/^\/events\/([^/]+)\/prizes$/);
  if (eventPrizesMatch && method === "GET") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    return {
      handled: true,
      value: ok(
        (requireEvent(eventPrizesMatch[1]).prizeAwards || []).map(
          publicEventPrizeAward,
        ),
      ),
    };
  }
  return { handled: false };
}

export async function handleEventPrizesPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const eventPrizesMatch = url.match(/^\/events\/([^/]+)\/prizes$/);
  if (eventPrizesMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(eventPrizesMatch[1]);
    if (detail.status !== "COMPLETED")
      throw new Error("赛事尚未完赛，不能发放奖品");
    const idempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "奖品发放幂等键",
    );
    const awardName = text(data.awardName);
    const teamId = text(data.teamId);
    const inventoryItemId = text(data.inventoryItemId);
    const quantity = integer(data.quantity);
    const note = text(data.note) || null;
    if (awardName.length < 2) throw new Error("奖项名称至少需要2个字");
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999)
      throw new Error("奖品数量必须为1-999的整数");
    const awards = detail.prizeAwards || [];
    const existing = awards.find(
      (award: any) => award.idempotencyKey === idempotencyKey,
    );
    const requestedRecipients = Array.isArray(data.recipientNames)
      ? data.recipientNames.map((name: unknown) => text(name)).filter(Boolean)
      : [];
    if (existing) {
      const sameRecipients =
        !requestedRecipients.length ||
        JSON.stringify(existing.recipientNames) ===
          JSON.stringify(requestedRecipients);
      if (
        existing.teamId !== teamId ||
        existing.awardName !== awardName ||
        existing.inventoryItemId !== inventoryItemId ||
        Number(existing.quantity) !== quantity ||
        existing.note !== note ||
        !sameRecipients
      ) {
        throw new Error("幂等键已用于其他赛事奖品指令，请更换幂等键");
      }
      return { handled: true, value: ok(publicEventPrizeAward(existing)) };
    }
    const team = (detail.teams || []).find((entry: any) => entry.id === teamId);
    if (!team) throw new Error("获奖队伍不存在");
    if (
      team.status !== "COMPLETED" ||
      !Number.isInteger(team.finalRank) ||
      team.finalRank < 1
    )
      throw new Error("获奖队伍尚未生成有效最终名次");
    const availableNames = [text(team.playerAName), text(team.playerBName)];
    const recipientNames = requestedRecipients.length
      ? requestedRecipients
      : availableNames;
    if (
      new Set(recipientNames.map((name: string) => name.toLocaleLowerCase()))
        .size !== recipientNames.length
    )
      throw new Error("奖品领取人不能重复");
    if (
      recipientNames.some(
        (name: string) =>
          !availableNames.some(
            (candidate: string) =>
              candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ),
      )
    )
      throw new Error("奖品领取人必须属于获奖队伍");
    if (
      awards.some(
        (award: any) =>
          award.teamId === teamId &&
          award.awardName === awardName &&
          award.inventoryItemId === inventoryItemId,
      )
    )
      throw new Error("该队伍的同一奖项和SKU已经发放");
    const goods = getGoods();
    const item = goods.find((entry) => entry.id === inventoryItemId);
    if (!item || item.enabled === false)
      throw new Error("奖品库存商品不存在或已停用");
    if (Number(item.stock || 0) < quantity) throw new Error("奖品库存不足");
    const stockBefore = Number(item.stock || 0);
    const stockAfter = stockBefore - quantity;
    const stockTransaction = {
      id: newId("stock-tx"),
      itemId: item.id,
      type: "EVENT_USAGE",
      quantity: -quantity,
      stockBefore,
      stockAfter,
      unitCostCents: item.purchasePriceCents,
      operatorId: mockUser().id,
      reason: `${detail.name} · ${awardName} · ${team.name}`,
      idempotencyKey: `EVENT_PRIZE:${idempotencyKey}`,
      metadata: {
        referenceType: "EventPrizeAward",
        eventId: detail.id,
        teamId,
        finalRank: team.finalRank,
        awardName,
        recipientNames,
        prizeIssueIdempotencyKey: idempotencyKey,
      },
      createdAt: new Date().toISOString(),
    };
    const award = {
      id: newId("event-prize"),
      eventId: detail.id,
      teamId,
      awardName,
      finalRank: team.finalRank,
      recipientNames,
      inventoryItemId: item.id,
      quantity,
      status: "ISSUED",
      operatorId: mockUser().id,
      inventoryTransactionId: stockTransaction.id,
      idempotencyKey,
      note,
      prizePoolSnapshot: detail.prizePool || null,
      issuedAt: new Date().toISOString(),
      team: { id: team.id, name: team.name, finalRank: team.finalRank },
      inventoryItem: { id: item.id, sku: item.sku, name: item.name },
      operator: { id: mockUser().id, displayName: mockUser().displayName },
      signedBy: null,
    };
    item.stock = stockAfter;
    detail.prizeAwards = [...awards, award];
    saveGoods(goods);
    saveInventoryTransactions([
      stockTransaction,
      ...getInventoryTransactions(),
    ]);
    saveEventDetail(detail);
    return { handled: true, value: ok(publicEventPrizeAward(award)) };
  }
  return { handled: false };
}

export async function handleReceiveEventPrizePost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const receiveEventPrizeMatch = url.match(
    /^\/events\/([^/]+)\/prizes\/([^/]+)\/receive$/,
  );
  if (receiveEventPrizeMatch && method === "POST") {
    requireMockRole("EVENT_MANAGER", "FRONT_DESK", "ADMIN", "SUPER_ADMIN");
    const detail = requireEvent(receiveEventPrizeMatch[1]);
    const award = (detail.prizeAwards || []).find(
      (entry: any) => entry.id === receiveEventPrizeMatch[2],
    );
    if (!award) throw new Error("赛事奖品发放记录不存在");
    const receivedByName = text(data.receivedByName);
    const receiptIdempotencyKey = requireIdempotencyKey(
      data.idempotencyKey,
      "奖品签收幂等键",
    );
    const receiptNote = text(data.note) || null;
    if (!receivedByName) throw new Error("签收人不能为空");
    if (award.status === "RECEIVED") {
      if (
        award.receivedByName !== receivedByName ||
        award.receiptIdempotencyKey !== receiptIdempotencyKey ||
        award.receiptNote !== receiptNote
      )
        throw new Error("奖品已经签收，签收信息与本次请求不一致");
      return { handled: true, value: ok(publicEventPrizeAward(award)) };
    }
    award.status = "RECEIVED";
    award.receivedByName = receivedByName;
    award.signedById = mockUser().id;
    award.signedBy = { id: mockUser().id, displayName: mockUser().displayName };
    award.receiptNote = receiptNote;
    award.receiptIdempotencyKey = receiptIdempotencyKey;
    award.receivedAt = new Date().toISOString();
    saveEventDetail(detail);
    return { handled: true, value: ok(publicEventPrizeAward(award)) };
  }
  return { handled: false };
}
