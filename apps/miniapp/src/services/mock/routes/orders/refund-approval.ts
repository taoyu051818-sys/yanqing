import { mockUser } from "../../core";
import { recordMockConsignmentRefund } from "../../consignment-settlement";
import { getOrders, saveOrders } from "../../venue";
import {
  getEnrollments,
  getGames,
  getGoods,
  getInventoryTransactions,
  getMemberAccounts,
  getMemberAccountTransactions,
  getInventoryBalances,
  getGovernanceUsers,
  getReferralRewards,
  saveEnrollments,
  saveEventDetail,
  saveGames,
  saveGoods,
  saveInventoryTransactions,
  saveMemberAccounts,
  saveMemberAccountTransactions,
  saveInventoryBalances,
  saveGovernanceUsers,
  saveReferralRewards,
} from "../../state";
import { ok, requireMockRole, newId } from "../../policies/common.js";
import { applyMockInventoryDelta } from "../../policies/inventory.js";
import { promoteMockGameWaitlist } from "../../policies/games.js";
import {
  promoteMockEventWaitlist,
  requireEvent,
} from "../../policies/events.js";
import { mockRefundCommandResponse } from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleApproveRefundPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const approveRefundMatch = url.match(/^\/orders\/refunds\/([^/]+)\/approve$/);
  if (approveRefundMatch && method === "POST") {
    requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
    const orders = getOrders();
    const order = orders.find((item) =>
      item.refunds?.some((refund: any) => refund.id === approveRefundMatch[1]),
    );
    const refund = order?.refunds?.find(
      (item: any) => item.id === approveRefundMatch[1],
    );
    if (!order || !refund) throw new Error("退款申请不存在");
    if (refund.requestedById === mockUser().id)
      throw new Error("退款申请人与审批人不能是同一账号");
    if (refund.status === "SUCCEEDED")
      return { handled: true, value: ok(mockRefundCommandResponse(refund)) };
    if (refund.status !== "REQUESTED") throw new Error("当前退款状态不能批准");
    let trainingEnrollment: any;
    if (order.businessType === "TRAINING") {
      trainingEnrollment = getEnrollments().find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!trainingEnrollment) throw new Error("培训订单缺少报名与预收账本");
      if (
        Number(refund.amountCents || 0) >
        Number(trainingEnrollment.prepaidBalanceCents || 0)
      ) {
        throw new Error(
          "当前未消课预收余额不足；请先驳回本申请或完成消课冲正后重提",
        );
      }
    }
    if (order.businessType === "GOODS") {
      const refundable =
        Number(order.paidCents || 0) - Number(order.refundedCents || 0);
      if (Number(refund.amountCents || 0) !== refundable)
        throw new Error("商品订单需整单退货，退款金额与原订单不一致");
      const goods = getGoods();
      const balances = getInventoryBalances();
      const transactions = getInventoryTransactions();
      const movements: any[] = [];
      for (const orderItem of order.items || []) {
        const item = goods.find((entry) => entry.id === orderItem.itemId);
        if (!item) throw new Error(`退货 SKU ${orderItem.itemId} 不存在`);
        orderItem.id = orderItem.id || `${order.id}:${item.id}`;
        const ledgerKey = `GOODS-REFUND:${refund.id}:${orderItem.id}`;
        const previous = transactions.find(
          (entry) => entry.idempotencyKey === ledgerKey,
        );
        if (previous) {
          if (
            previous.itemId !== item.id ||
            Number(previous.quantity) !== Number(orderItem.quantity || 0)
          )
            throw new Error("商品退货库存幂等键已用于其他入库指令");
          movements.push(previous);
          continue;
        }
        const movement = applyMockInventoryDelta(
          item,
          balances,
          Number(orderItem.quantity || 0),
        );
        movements.push({
          id: newId("inventory-txn"),
          itemId: item.id,
          type: "ADJUSTMENT",
          quantity: Number(orderItem.quantity || 0),
          stockBefore: movement.stockBefore,
          stockAfter: movement.stockAfter,
          unitCostCents: item.purchasePriceCents,
          orderItemId: orderItem.id,
          operatorId: mockUser().id,
          reason: `退款 ${refund.refundNo} 退货入库`,
          idempotencyKey: ledgerKey,
          metadata: {
            orderId: order.id,
            refundId: refund.id,
            returnDisposition: "RESALABLE_RETURN",
            locationId: movement.locationId,
            batchCode: movement.batchCode,
          },
          createdAt: new Date().toISOString(),
        });
      }
      const newMovements = movements.filter(
        (entry) =>
          !transactions.some(
            (current) => current.idempotencyKey === entry.idempotencyKey,
          ),
      );
      saveGoods(goods);
      saveInventoryBalances(balances);
      if (newMovements.length)
        saveInventoryTransactions([...newMovements, ...transactions]);
      refund.inventoryReturnTransactionIds = movements.map((entry) => entry.id);
      refund.returnDisposition = "RESALABLE_RETURN";
    }
    if (order.businessType === "RECHARGE") {
      const paymentAmount = Number(
        order.paymentAmountCents || order.paidCents || 0,
      );
      if (paymentAmount <= 0) throw new Error("充值订单缺少原支付金额");
      const accountBook = getMemberAccounts();
      const memberAccounts = accountBook[order.memberId] || [];
      const transactions = getMemberAccountTransactions();
      const debits = [
        [
          "CASH_PRINCIPAL",
          Math.round(
            (Math.max(0, Number(order.parameterSnapshot?.principalCents || 0)) *
              Number(refund.amountCents || 0)) /
              paymentAmount,
          ),
        ],
        [
          "GIFT_BALANCE",
          Math.round(
            (Math.max(0, Number(order.parameterSnapshot?.giftCents || 0)) *
              Number(refund.amountCents || 0)) /
              paymentAmount,
          ),
        ],
      ] as const;
      for (const [type, amount] of debits) {
        if (!amount) continue;
        const idempotencyKey = `RECHARGE-REFUND:${refund.id}:${type}`;
        if (
          transactions.some(
            (transaction) => transaction.idempotencyKey === idempotencyKey,
          )
        )
          continue;
        const account = memberAccounts.find((item) => item.type === type);
        const available =
          Number(account?.balance || 0) - Number(account?.frozenBalance || 0);
        if (!account || available < amount)
          throw new Error(`${type} 余额不足，充值款已消费，需人工审核处理`);
      }
      for (const [type, amount] of debits) {
        if (!amount) continue;
        const idempotencyKey = `RECHARGE-REFUND:${refund.id}:${type}`;
        if (
          transactions.some(
            (transaction) => transaction.idempotencyKey === idempotencyKey,
          )
        )
          continue;
        const account = memberAccounts.find((item) => item.type === type)!;
        const balanceBefore = Number(account.balance || 0);
        account.balance = balanceBefore - amount;
        account.version = Number(account.version || 0) + 1;
        transactions.unshift({
          id: newId("account-txn"),
          accountId: account.id,
          kind: "REVERSAL",
          amount: -amount,
          balanceBefore,
          balanceAfter: account.balance,
          reasonCode: "RECHARGE_REFUND",
          reason: refund.reason,
          orderId: order.id,
          operatorId: mockUser().id,
          idempotencyKey,
          createdAt: new Date().toISOString(),
        });
      }
      accountBook[order.memberId] = memberAccounts;
      saveMemberAccounts(accountBook);
      saveMemberAccountTransactions(transactions);
    }
    // Restore the original asset, using the captured debit rather than today's coin rate.
    const paymentDebit = getMemberAccountTransactions().find(
      (item) =>
        item.orderId === order.id && item.reasonCode === "ORDER_PAYMENT",
    );
    if (paymentDebit) {
      const transactions = getMemberAccountTransactions();
      const ledgerKey = "ORDER-REFUND:" + refund.id;
      if (!transactions.some((item) => item.idempotencyKey === ledgerKey)) {
        const book = getMemberAccounts(),
          account = (book[order.memberId] || []).find(
            (item) => item.id === paymentDebit.accountId,
          );
        if (!account) throw new Error("原支付账户不存在，退款需人工核查");
        const originalUnits = Math.abs(Number(paymentDebit.amount)),
          paid = Number(order.paidCents);
        const previousRefund = Number(order.refundedCents || 0),
          nextRefund = previousRefund + Number(refund.amountCents);
        const amount =
          Math.floor((originalUnits * nextRefund) / paid) -
          Math.floor((originalUnits * previousRefund) / paid);
        const balanceBefore = Number(account.balance);
        account.balance += amount;
        account.version = Number(account.version || 0) + 1;
        transactions.unshift({
          id: newId("account-txn"),
          accountId: account.id,
          kind: "REVERSAL",
          amount,
          balanceBefore,
          balanceAfter: account.balance,
          orderId: order.id,
          reasonCode: "ORDER_REFUND",
          reason: refund.reason,
          idempotencyKey: ledgerKey,
          operatorId: mockUser().id,
          createdAt: new Date().toISOString(),
        });
        saveMemberAccounts(book);
        saveMemberAccountTransactions(transactions);
      }
    }
    refund.status = "SUCCEEDED";
    refund.approvedAt = new Date().toISOString();
    refund.completedAt = refund.approvedAt;
    order.refundedCents =
      Number(order.refundedCents || 0) + Number(refund.amountCents || 0);
    order.status =
      order.refundedCents >= Number(order.paidCents || 0)
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";
    if (order.status === "REFUNDED") order.paymentStatus = "REFUNDED";
    if (trainingEnrollment) {
      trainingEnrollment.refundedCents =
        Number(trainingEnrollment.refundedCents || 0) +
        Number(refund.amountCents || 0);
      trainingEnrollment.prepaidBalanceCents = Math.max(
        0,
        Number(trainingEnrollment.prepaidBalanceCents || 0) -
          Number(refund.amountCents || 0),
      );
      trainingEnrollment.status =
        order.status === "REFUNDED" ? "REFUNDED" : "PARTIALLY_REFUNDED";
      saveEnrollments(
        getEnrollments().map((item) =>
          item.id === trainingEnrollment.id ? trainingEnrollment : item,
        ),
      );
    }
    let ordersAfterRefund = orders;
    if (order.status === "REFUNDED" && order.businessType === "MEMBERSHIP") {
      if (order.membership) {
        order.membership.status = "CANCELLED";
        order.membership.cancelledAt = refund.completedAt;
      }
      const latest = orders
        .filter(
          (item) =>
            item.id !== order.id &&
            item.memberId === order.memberId &&
            item.businessType === "MEMBERSHIP" &&
            item.membership?.status === "ACTIVE",
        )
        .sort(
          (left, right) =>
            new Date(right.membership?.endsAt || 0).getTime() -
            new Date(left.membership?.endsAt || 0).getTime(),
        )[0];
      const users = getGovernanceUsers();
      const member = users.find((item) => item.id === order.memberId);
      if (member) {
        member.memberProfile = {
          ...(member.memberProfile || {}),
          level: latest?.parameterSnapshot?.level || "EXPERIENCE",
          membershipExpiresAt: latest?.membership?.endsAt || null,
        };
        saveGovernanceUsers(users);
      }
    }
    if (order.status === "REFUNDED" && order.businessType === "GAME") {
      const games = getGames();
      const game = games.find(
        (item) => item.id === (order.gameId || order.parameterSnapshot?.gameId),
      );
      const registration = game?.registrations?.find(
        (item: any) => item.orderId === order.id,
      );
      if (registration) registration.status = "REFUNDED";
      if (game) {
        const promoted = promoteMockGameWaitlist(game);
        saveGames(games);
        if (promoted) ordersAfterRefund = [promoted.order, ...orders];
      }
    }
    if (order.status === "REFUNDED" && order.businessType === "EVENT") {
      const eventId = order.eventId || order.parameterSnapshot?.eventId;
      if (eventId) {
        const detail = requireEvent(eventId);
        const team = (detail.teams || []).find(
          (item: any) =>
            item.id ===
              (order.eventTeamId || order.parameterSnapshot?.eventTeamId) ||
            item.orderId === order.id,
        );
        if (team) {
          team.status = "REFUNDED";
          team.paymentDueAt = null;
          team.cancellationPending = false;
          if (team.cancelRequestedAt)
            team.cancellationResolvedAt =
              team.cancellationResolvedAt || new Date().toISOString();
        }
        promoteMockEventWaitlist(detail, ordersAfterRefund);
        saveEventDetail(detail);
      }
    }
    if (order.status === "REFUNDED" && order.businessType === "GOODS") {
      recordMockConsignmentRefund(order, refund);
    }
    const referralRewards = getReferralRewards();
    let referralRewardChanged = false;
    referralRewards.forEach((reward) => {
      if (
        reward.triggerOrderId === order.id &&
        ["PENDING_OBSERVATION", "AVAILABLE"].includes(reward.status)
      ) {
        reward.status = "REVERSED";
        reward.reversedAt = refund.completedAt;
        referralRewardChanged = true;
      }
    });
    if (referralRewardChanged) saveReferralRewards(referralRewards);
    saveOrders(ordersAfterRefund);
    return { handled: true, value: ok(mockRefundCommandResponse(refund)) };
  }
  return { handled: false };
}
