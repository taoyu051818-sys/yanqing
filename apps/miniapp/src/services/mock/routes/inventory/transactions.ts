import { mockUser } from "../../core";
import {
  getGoods,
  getInventoryTransactions,
  getInventoryLocations,
  getInventoryBalances,
  saveGoods,
  saveInventoryTransactions,
  saveInventoryBalances,
} from "../../state";
import {
  ok,
  requireMockRole,
  text,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import {
  applyMockInventoryDelta,
  mockInventoryTransactionResponse,
} from "../../policies/inventory.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleInventoryPost2(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const inventoryMatch = url.match(/^\/inventory\/([^/]+)\/transactions$/);
  if (inventoryMatch && method === "POST") {
    requireMockRole("ADMIN", "SUPER_ADMIN");
    const list = getGoods();
    const item = list.find(
      (entry) => entry.id === inventoryMatch[1] && entry.enabled !== false,
    );
    if (!item) throw new Error("库存商品不存在");
    const type = text(data.type);
    const validTypes = [
      "PURCHASE_IN",
      "CONSIGNMENT_IN",
      "SALE_OUT",
      "TRAINING_USAGE",
      "EVENT_USAGE",
      "ADJUSTMENT",
      "RETURN_OUT",
      "STOCKTAKE",
    ];
    if (!validTypes.includes(type)) throw new Error("库存变动类型无效");
    const idempotency = requireIdempotencyKey(
      data.idempotencyKey,
      "库存幂等键",
    );
    const transactions = getInventoryTransactions();
    const previous = transactions.find(
      (entry) => entry.idempotencyKey === idempotency,
    );
    if (previous) {
      if (
        previous.itemId !== item.id ||
        previous.type !== type ||
        Number(previous.quantity) !== Number(data.quantity)
      )
        throw new Error("库存幂等键已用于其他库存动作");
      return {
        handled: true,
        value: ok(mockInventoryTransactionResponse(previous)),
      };
    }
    if (
      [
        "PURCHASE_IN",
        "CONSIGNMENT_IN",
        "ADJUSTMENT",
        "RETURN_OUT",
        "STOCKTAKE",
      ].includes(type)
    )
      throw new Error("该库存动作必须通过采购、盘点、调拨或报损单据执行");
    const quantity = Number(data.quantity);
    if (!Number.isInteger(quantity) || quantity === 0)
      throw new Error("库存数量必须为非零整数");
    if (["PURCHASE_IN", "CONSIGNMENT_IN"].includes(type) && quantity < 0)
      throw new Error("入库数量必须为正数");
    if (
      ["SALE_OUT", "TRAINING_USAGE", "EVENT_USAGE", "RETURN_OUT"].includes(
        type,
      ) &&
      quantity > 0
    )
      throw new Error("出库数量必须为负数");
    const reason = text(data.reason);
    if (reason.length < 2) throw new Error("库存变动原因不能为空");
    if (
      ["TRAINING_USAGE", "EVENT_USAGE"].includes(type) &&
      (!text(data.referenceId) || !text(data.referenceType))
    )
      throw new Error("培训或赛事领用必须关联业务单据");
    if (
      data.unitCostCents !== undefined &&
      (!Number.isInteger(Number(data.unitCostCents)) ||
        Number(data.unitCostCents) < 0)
    )
      throw new Error("单位成本必须为非负整数");
    const balances = getInventoryBalances();
    const location = getInventoryLocations().find(
      (entry) => entry.id === item.defaultLocationId,
    );
    if (!location || location.enabled === false)
      throw new Error("默认库位已停用，不能发生新库存动作");
    const movement = applyMockInventoryDelta(item, balances, quantity);
    const transaction = {
      id: newId("stock-tx"),
      itemId: item.id,
      type,
      quantity,
      stockBefore: movement.stockBefore,
      stockAfter: movement.stockAfter,
      unitCostCents: data.unitCostCents,
      reason,
      idempotencyKey: idempotency,
      metadata: {
        ...(data.metadata || {}),
        ...(data.referenceId ? { referenceId: data.referenceId } : {}),
        ...(data.referenceType ? { referenceType: data.referenceType } : {}),
        locationId: movement.locationId,
        batchCode: movement.batchCode,
        operatorId: mockUser().id,
      },
      createdAt: new Date().toISOString(),
    };
    saveGoods(list);
    saveInventoryBalances(balances);
    saveInventoryTransactions([transaction, ...transactions]);
    return {
      handled: true,
      value: ok(mockInventoryTransactionResponse(transaction)),
    };
  }
  return { handled: false };
}
