import { mockUser } from "../../core";
import { recordMockConsignmentSale } from "../../consignment-settlement";
import { getOrders, saveOrders } from "../../venue";
import {
  getCoupons,
  getCouponTemplates,
  getEnrollments,
  getEventDetail,
  getGames,
  getGoods,
  getInventoryTransactions,
  getMemberAccounts,
  getMemberAccountTransactions,
  getInventoryLocations,
  getInventoryBalances,
  getTrainingProducts,
  getGovernanceUsers,
  getVenueBookings,
  saveCoupons,
  saveCouponTemplates,
  saveEnrollments,
  saveEventDetail,
  saveGames,
  saveGoods,
  saveInventoryTransactions,
  saveMemberAccounts,
  saveMemberAccountTransactions,
  saveInventoryBalances,
  saveGovernanceUsers,
  saveVenueBookings,
} from "../../state";
import {
  ok,
  hasMockRole,
  text,
  isExpired,
  requireIdempotencyKey,
  newId,
} from "../../policies/common.js";
import { createMockReferralReward } from "../../policies/referrals.js";
import { applyMockInventoryDelta } from "../../policies/inventory.js";
import { requireMockOpenFrontDeskShift } from "../../policies/front-desk.js";
import {
  promoteMockEventWaitlist,
  requireEvent,
} from "../../policies/events.js";
import { couponMerchantId } from "../../policies/alliance.js";
import {
  mockPaymentCommandResponse,
  mockPaymentOptions,
} from "../../policies/orders.js";
import type { MockRouteResult, MockRouteOptions } from "../route-contract.js";

export async function handleOptionsGet(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const optionsMatch = url.match(/^\/orders\/([^/]+)\/payment-options$/);
  if (optionsMatch && method === "GET") {
    const order = getOrders().find((item) => item.id === optionsMatch[1]);
    if (!order || (order.memberId && order.memberId !== mockUser().id))
      throw new Error("订单不存在或不属于当前账号");
    return { handled: true, value: ok(mockPaymentOptions(order)) };
  }
  return { handled: false };
}

export async function handlePayPost(
  method: string,
  url: string,
  data: any,
  options: MockRouteOptions,
): Promise<MockRouteResult> {
  const payMatch = url.match(/^\/orders\/([^/]+)\/pay$/);
  if (payMatch && method === "POST") {
    const requestedChannel = text(data.channel);
    if (requestedChannel === "COUPON")
      throw new Error("优惠券只能在建单时抵扣，不能作为支付渠道");
    const orders = getOrders();
    const order = orders.find((item) => item.id === payMatch[1]);
    if (!order) throw new Error("订单不存在");
    if (order.businessType === "EVENT" && order.status === "PENDING") {
      const eventId = order.eventId || order.parameterSnapshot?.eventId;
      const detail = eventId ? requireEvent(eventId) : null;
      const team = detail?.teams?.find(
        (item: any) =>
          item.id ===
            (order.eventTeamId || order.parameterSnapshot?.eventTeamId) ||
          item.orderId === order.id,
      );
      if (!detail || !team) throw new Error("赛事订单缺少报名队伍");
      if (
        team.status !== "REGISTERED" ||
        !team.paymentDueAt ||
        new Date(team.paymentDueAt) <= new Date() ||
        !["OPEN", "FULL"].includes(detail.status)
      ) {
        if (team.status === "REGISTERED" && !team.paymentDueAt) {
          team.paymentDueAt = new Date(0).toISOString();
        } else if (team.status !== "REGISTERED") {
          order.status = "CANCELLED";
          order.cancelledAt = new Date().toISOString();
        }
        promoteMockEventWaitlist(detail, orders);
        saveOrders(orders);
        saveEventDetail(detail);
        throw new Error("赛事报名支付保留期已过期或赛事已取消，席位已释放");
      }
    }
    const channel = requestedChannel;
    if (
      ![
        "WECHAT",
        "OFFLINE_CASH",
        "CASH_PRINCIPAL",
        "GIFT_BALANCE",
        "BADMINTON_COIN",
      ].includes(channel)
    )
      throw new Error("支付渠道无效");
    const selfPayment = !order.memberId || order.memberId === mockUser().id;
    if (selfPayment && channel === "OFFLINE_CASH")
      throw new Error("会员本人不能使用线下现金渠道");
    if (!selfPayment) {
      if (channel !== "OFFLINE_CASH") {
        if (
          ["CASH_PRINCIPAL", "GIFT_BALANCE", "BADMINTON_COIN"].includes(channel)
        )
          throw new Error("账户余额只能由会员本人支付，员工不得代扣");
        throw new Error("员工代客收款仅支持线下现金渠道");
      }
      if (!hasMockRole("FRONT_DESK", "ADMIN", "SUPER_ADMIN"))
        throw new Error("仅前台或管理员可代收线下现金");
    }
    const paymentKey = requireIdempotencyKey(data.idempotencyKey, "支付幂等键");
    const existingPayment = orders.find(
      (item) => item.paymentIdempotencyKey === paymentKey,
    );
    if (
      existingPayment &&
      (existingPayment.id !== order.id ||
        existingPayment.paymentChannel !== channel)
    )
      throw new Error("支付幂等键已用于其他订单或支付渠道");
    if (existingPayment && existingPayment.paymentOperatorId !== mockUser().id)
      throw new Error("支付请求只能由原操作人重试");
    if (existingPayment && existingPayment.id === order.id)
      return { handled: true, value: ok(mockPaymentCommandResponse(order)) };
    if (order.status !== "PENDING")
      throw new Error(`订单当前状态为 ${order.status}，不能支付`);
    const option = mockPaymentOptions(order).options.find(
      (item) => item.channel === channel,
    );
    if (option && !option.enabled) throw new Error(option.reason);
    if (
      option &&
      data.expectedDebitAmount !== undefined &&
      data.expectedDebitAmount !== option.debitAmount
    )
      throw new Error("抵扣报价已变化，请重新核对");
    const paymentShift =
      channel === "OFFLINE_CASH" ? requireMockOpenFrontDeskShift() : null;
    let trainingEnrollmentToActivate: any;
    if (order.businessType === "TRAINING") {
      const enrollments = getEnrollments();
      trainingEnrollmentToActivate = enrollments.find(
        (item) =>
          item.orderId === order.id || item.id === order.trainingEnrollmentId,
      );
      if (!trainingEnrollmentToActivate)
        throw new Error("培训订单缺少报名记录");
      if (trainingEnrollmentToActivate.status !== "PENDING_PAYMENT")
        throw new Error("培训报名状态不可支付");
      if (trainingEnrollmentToActivate.classId) {
        const selectedClass = getTrainingProducts()
          .flatMap((item) => item.classes || [])
          .find(
            (item: any) => item.id === trainingEnrollmentToActivate.classId,
          );
        if (!selectedClass) throw new Error("培训班不存在或已停用");
        if (
          !trainingEnrollmentToActivate.seatReservedUntil ||
          isExpired(trainingEnrollmentToActivate.seatReservedUntil)
        ) {
          throw new Error("培训班名额保留已过期，请重新报名");
        }
        const occupiedSeats = enrollments.filter(
          (item) =>
            item.id !== trainingEnrollmentToActivate.id &&
            item.classId === trainingEnrollmentToActivate.classId &&
            ["ACTIVE", "PARTIALLY_REFUNDED"].includes(item.status),
        ).length;
        if (occupiedSeats >= Number(selectedClass.capacity || 0))
          throw new Error("培训班名额已满，支付未完成");
      }
    }
    if (order.businessType === "GOODS") {
      const goods = getGoods();
      const balances = getInventoryBalances();
      const locations = getInventoryLocations();
      const transactions = getInventoryTransactions();
      const movements: any[] = [];
      for (const orderItem of order.items || []) {
        const item = goods.find((entry) => entry.id === orderItem.itemId);
        if (!item || item.enabled === false)
          throw new Error(
            `商品 ${orderItem.name || orderItem.itemId} 不存在或已下架`,
          );
        const location = locations.find(
          (entry) => entry.id === item.defaultLocationId,
        );
        if (!location || location.enabled === false)
          throw new Error(`${item.name} 默认库位不存在或已停用`);
        orderItem.id = orderItem.id || `${order.id}:${item.id}`;
        const ledgerKey = `GOODS:${paymentKey}:${orderItem.id}`;
        const previous = transactions.find(
          (entry) => entry.idempotencyKey === ledgerKey,
        );
        if (previous) {
          if (
            previous.itemId !== item.id ||
            Number(previous.quantity) !== -Number(orderItem.quantity || 0)
          )
            throw new Error("商品支付库存幂等键已用于其他出库指令");
          continue;
        }
        const movement = applyMockInventoryDelta(
          item,
          balances,
          -Number(orderItem.quantity || 0),
        );
        movements.push({
          id: newId("inventory-txn"),
          itemId: item.id,
          type: "SALE_OUT",
          quantity: -Number(orderItem.quantity || 0),
          stockBefore: movement.stockBefore,
          stockAfter: movement.stockAfter,
          unitCostCents: item.purchasePriceCents,
          orderItemId: orderItem.id,
          operatorId: mockUser().id,
          reason: `商品订单 ${order.orderNo} 支付出库`,
          idempotencyKey: ledgerKey,
          metadata: {
            orderId: order.id,
            paymentIdempotencyKey: paymentKey,
            locationId: movement.locationId,
            batchCode: movement.batchCode,
          },
          createdAt: new Date().toISOString(),
        });
      }
      saveGoods(goods);
      saveInventoryBalances(balances);
      if (movements.length)
        saveInventoryTransactions([...movements, ...transactions]);
    }
    if (
      ["CASH_PRINCIPAL", "GIFT_BALANCE", "BADMINTON_COIN"].includes(channel)
    ) {
      const accountBook = getMemberAccounts();
      const memberId = order.memberId || mockUser().id;
      const accounts =
        accountBook[memberId] ||
        mockUser().accounts?.map((item) => ({ ...item })) ||
        [];
      const account = accounts.find((item) => item.type === channel)!;
      const amount = option!.debitAmount,
        balanceBefore = account.balance;
      account.balance -= amount;
      account.version = Number(account.version || 0) + 1;
      accountBook[memberId] = accounts;
      saveMemberAccounts(accountBook);
      saveMemberAccountTransactions([
        {
          id: newId("account-txn"),
          accountId: account.id,
          kind: "DEBIT",
          amount: -amount,
          balanceBefore,
          balanceAfter: account.balance,
          reasonCode: "ORDER_PAYMENT",
          orderId: order.id,
          operatorId: mockUser().id,
          idempotencyKey: "ACCOUNT:" + paymentKey,
          createdAt: new Date().toISOString(),
          metadata: {
            paymentChannel: channel,
            cashValueCents: order.payableCents,
          },
        },
        ...getMemberAccountTransactions(),
      ]);
    }
    if (order.businessType === "VENUE" && order.parameterSnapshot?.couponId) {
      const coupons = getCoupons(),
        templates = getCouponTemplates();
      const coupon = coupons.find(
        (row) => row.id === order.parameterSnapshot.couponId,
      )!;
      const template = templates.find((row) => row.id === coupon.templateId);
      Object.assign(coupon, {
        status: "REDEEMED",
        redeemedAt: new Date().toISOString(),
        redeemedById: mockUser().id,
        redeemedMerchantId: couponMerchantId(coupon),
        attributionOrderId: order.id,
        attributedAmountCents: order.payableCents,
      });
      if (template)
        template.redeemedCount = Number(template.redeemedCount || 0) + 1;
      saveCoupons(coupons);
      saveCouponTemplates(templates);
    }
    order.status = "PAID";
    order.paidCents = order.payableCents;
    order.paidAt = new Date().toISOString();
    order.paymentId = order.paymentId || `payment-${Date.now()}`;
    order.paymentStatus = "SUCCEEDED";
    order.paymentAmountCents = Number(order.payableCents || 0);
    order.paymentCreatedAt = order.paymentCreatedAt || order.paidAt;
    order.paymentIdempotencyKey = paymentKey;
    order.paymentChannel = channel;
    order.paymentOperatorId = mockUser().id;
    order.paymentFrontDeskShiftId = paymentShift?.id || null;
    order.paymentAdminEmergencyBypass =
      channel === "OFFLINE_CASH" && !paymentShift;
    if (channel === "WECHAT" && !order.wechatPay) {
      order.wechatPay = {
        timeStamp: String(Math.floor(Date.now() / 1_000)),
        nonceStr: `mock-${Date.now().toString(36)}`,
        package: `prepay_id=mock-${order.paymentId}`,
        signType: "RSA",
        paySign: "mock-signature",
      };
    }
    // Payment finalization advances the business aggregate as well as the
    // order.  Without this bridge a freshly paid game/event registration
    // would remain REGISTERED forever and could not be checked in.
    const snapshot = order.parameterSnapshot || {};
    if (order.businessType === "MEMBERSHIP") {
      if (!order.membership) throw new Error("会员订单缺少订阅记录");
      order.membership.status = "ACTIVE";
      order.membership.memberId = order.memberId;
      order.membership.activatedAt = order.paidAt;
      order.status = "COMPLETED";
      order.completedAt = order.paidAt;
      order.fulfillmentOutcome = "ACTIVATED";
      const users = getGovernanceUsers();
      const member = users.find((item) => item.id === order.memberId);
      if (!member) throw new Error("会员档案不存在，不能激活订阅");
      member.memberProfile = {
        ...(member.memberProfile || {}),
        level: snapshot.level || "EXPERIENCE",
        membershipExpiresAt: order.membership.endsAt || null,
      };
      saveGovernanceUsers(users);
    }
    if (order.businessType === "RECHARGE") {
      const accountBook = getMemberAccounts();
      const fallbackAccounts =
        order.memberId === mockUser().id
          ? (mockUser().accounts || []).map((account: any) => ({
              ...account,
              id: `account-${order.memberId}-${String(account.type).toLowerCase()}`,
              userId: order.memberId,
              version: Number(account.version || 0),
            }))
          : [];
      const memberAccounts = accountBook[order.memberId] || fallbackAccounts;
      const transactions = getMemberAccountTransactions();
      for (const [type, amount] of [
        ["CASH_PRINCIPAL", Math.max(0, Number(snapshot.principalCents || 0))],
        ["GIFT_BALANCE", Math.max(0, Number(snapshot.giftCents || 0))],
      ] as const) {
        if (!amount) continue;
        const idempotencyKey = `RECHARGE:${order.paymentId}:${type}`;
        if (
          transactions.some(
            (transaction) => transaction.idempotencyKey === idempotencyKey,
          )
        )
          continue;
        let account = memberAccounts.find((item) => item.type === type);
        if (!account) {
          account = {
            id: `account-${order.memberId}-${type.toLowerCase()}`,
            userId: order.memberId,
            type,
            balance: 0,
            frozenBalance: 0,
            version: 0,
          };
          memberAccounts.push(account);
        }
        const balanceBefore = Number(account.balance || 0);
        account.balance = balanceBefore + amount;
        account.version = Number(account.version || 0) + 1;
        transactions.unshift({
          id: newId("account-txn"),
          accountId: account.id,
          kind: "CREDIT",
          amount,
          balanceBefore,
          balanceAfter: account.balance,
          reasonCode: "MEMBER_RECHARGE",
          reason: order.title,
          orderId: order.id,
          operatorId: mockUser().id,
          idempotencyKey,
          createdAt: order.paidAt,
        });
      }
      accountBook[order.memberId] = memberAccounts;
      saveMemberAccounts(accountBook);
      saveMemberAccountTransactions(transactions);
      order.status = "COMPLETED";
      order.completedAt = order.paidAt;
      order.fulfillmentOutcome = "ACTIVATED";
    }
    if (order.businessType === "VENUE") {
      const bookings = getVenueBookings();
      const changed = bookings.map((booking) =>
        booking.orderId === order.id && booking.status === "HELD"
          ? { ...booking, status: "CONFIRMED", holdExpiresAt: null }
          : booking,
      );
      saveVenueBookings(changed);
      order.bookings = (order.bookings || []).map((booking: any) => ({
        ...booking,
        status: booking.status === "HELD" ? "CONFIRMED" : booking.status,
        holdExpiresAt: null,
      }));
    }
    if (order.businessType === "GAME") {
      const gameId =
        order.gameId || snapshot.gameId || order.items?.[0]?.itemId;
      if (gameId) {
        const games = getGames();
        const game = games.find((item) => item.id === gameId);
        const registration = game?.registrations?.find(
          (item: any) =>
            item.orderId === order.id ||
            (item.userId === order.memberId && item.status === "REGISTERED"),
        );
        if (registration) registration.status = "PAID";
        if (game) saveGames(games);
      }
    }
    if (order.businessType === "EVENT") {
      const eventId =
        order.eventId || snapshot.eventId || order.items?.[0]?.itemId;
      const teamId = order.eventTeamId || order.eventTeam?.id;
      if (eventId) {
        const detail = getEventDetail(eventId);
        const team = (detail.teams || []).find((item: any) =>
          teamId
            ? item.id === teamId
            : item.orderId === order.id ||
              (item.captainId === order.memberId &&
                item.status === "REGISTERED"),
        );
        if (team) {
          team.status = "PAID";
          team.paymentDueAt = null;
        }
        saveEventDetail(detail);
      }
    }
    if (order.businessType === "TRAINING") {
      const enrollments = getEnrollments();
      const enrollment = enrollments.find(
        (item) => item.id === trainingEnrollmentToActivate?.id,
      );
      if (enrollment) {
        enrollment.status = "ACTIVE";
        enrollment.prepaidBalanceCents = Number(
          enrollment.totalAmountCents || enrollment.prepaidBalanceCents || 0,
        );
        enrollment.seatReservedUntil = null;
        enrollment.paidAt = order.paidAt;
      }
      saveEnrollments(enrollments);
    }
    if (order.businessType === "GOODS") {
      order.fulfillmentOutcome = "FULFILLED";
      recordMockConsignmentSale(order);
    }
    createMockReferralReward(order, orders);
    saveOrders(orders);
    return { handled: true, value: ok(mockPaymentCommandResponse(order)) };
  }
  return { handled: false };
}
