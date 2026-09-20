import { mockUser } from "../../core";
import { getOrders } from "../../venue";
import { getMemberAccounts, getMemberAccountTransactions } from "../../state";
import { ok, requireMockRole } from "../../policies/common";
import { mockOrderResponse } from "../../policies/orders";
import type { MockRouteOptions, MockRouteResult } from "../route-contract";
export async function handleOrderTimeline(
  method: string,
  url: string,
  data: any,
  _options: MockRouteOptions,
): Promise<MockRouteResult> {
  if (
    method !== "GET" ||
    ![
      "/orders/me/next",
      "/orders/me/ledger",
      "/orders/admin/ledger",
      "/orders/admin/refunds",
    ].includes(url)
  )
    return { handled: false };
  const mine = url.startsWith("/orders/me/");
  if (!mine) requireMockRole("FRONT_DESK", "FINANCE", "ADMIN", "SUPER_ADMIN");
  const orders = getOrders(),
    who = mockUser();
  if (url.endsWith("/next")) {
    const own = orders.filter((o) => o.memberId === who.id || !o.memberId);
    const upcoming = (o: any) =>
      o.bookings?.[0]?.startsAt ||
      o.gameRegistration?.game?.startsAt ||
      o.eventTeam?.event?.startsAt;
    const pending = own
      .filter(
        (o) =>
          o.status === "PENDING" &&
          Date.now() - new Date(o.createdAt).getTime() < 600000,
      )
      .sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      )[0];
    const next = own
      .filter(
        (o) =>
          ["PAID", "CHECKED_IN"].includes(o.status) &&
          new Date(upcoming(o)).getTime() >= Date.now(),
      )
      .sort(
        (a, b) =>
          new Date(upcoming(a)).getTime() - new Date(upcoming(b)).getTime(),
      )[0];
    return {
      handled: true,
      value: ok(pending || next ? mockOrderResponse(pending || next) : null),
    };
  }
  const refunds = url.endsWith("/refunds"),
    account = mine || data.scope === "ACCOUNTS";
  if (account && !mine) requireMockRole("FINANCE", "ADMIN", "SUPER_ADMIN");
  let rows: any[] = [];
  if (refunds) {
    rows = orders
      .flatMap((o) =>
        (o.refunds || []).map((r: any) => ({
          ...r,
          orderId: o.id,
          at: r.requestedAt,
          order: { title: o.title, orderNo: o.orderNo, member: o.member },
        })),
      )
      .filter((r) =>
        !data.status || data.status === "ACTIVE"
          ? ["REQUESTED", "APPROVED", "PROCESSING", "FAILED"].includes(r.status)
          : data.status === "ALL" || r.status === data.status,
      );
  } else if (account) {
    const accounts = getMemberAccounts();
    const byId = new Map(
      Object.entries(accounts).flatMap(([userId, list]) =>
        (list as any[]).map((a) => [a.id, { ...a, userId }]),
      ),
    );
    rows = getMemberAccountTransactions().flatMap((t: any) => {
      const a: any = byId.get(t.accountId);
      if (!a || (mine && a.userId !== who.id)) return [];
      return [
        {
          id: "account:" + t.id,
          at: t.createdAt,
          orderId: t.orderId,
          memberName: a.userId === who.id ? who.displayName : "会员",
          channel: a.type,
          unit: ["CASH_PRINCIPAL", "GIFT_BALANCE"].includes(a.type)
            ? "CNY"
            : a.type === "BADMINTON_COIN"
              ? "COIN"
              : "POINT",
          amount: t.amount,
          reason: t.reason,
          status: t.kind,
        },
      ];
    });
  } else {
    rows = orders.flatMap((o) => [
      ...(o.payments || [])
        .filter(
          (p: any) =>
            ["SUCCEEDED", "REFUNDED"].includes(p.status) &&
            p.paidAt &&
            ["WECHAT", "OFFLINE_CASH"].includes(p.channel),
        )
        .map((p: any) => ({
          id: "payment:" + p.id,
          at: p.paidAt,
          orderId: o.id,
          orderNo: o.orderNo,
          title: o.title,
          memberName: o.member?.displayName,
          channel: p.channel,
          amount: p.amountCents,
          unit: "CNY",
          reason: "收款",
          status: "SUCCEEDED",
        })),
      ...(o.refunds || [])
        .filter(
          (r: any) =>
            r.status === "SUCCEEDED" &&
            r.completedAt &&
            ["WECHAT", "OFFLINE_CASH"].includes(o.paymentChannel),
        )
        .map((r: any) => ({
          id: "refund:" + r.id,
          at: r.completedAt,
          orderId: o.id,
          orderNo: o.orderNo,
          title: o.title,
          memberName: o.member?.displayName,
          channel: o.paymentChannel,
          amount: -r.amountCents,
          unit: "CNY",
          reason: "退款",
          status: "SUCCEEDED",
        })),
    ]);
  }
  const key = String(data.keyword || "").toLowerCase();
  rows = rows
    .filter(
      (r) =>
        (!data.accountType || r.channel === data.accountType) &&
        (!key ||
          [
            r.title,
            r.orderNo,
            r.memberName,
            r.order?.title,
            r.order?.orderNo,
            r.order?.member?.displayName,
          ].some((x) =>
            String(x || "")
              .toLowerCase()
              .includes(key),
          )) &&
        (!data.dateFrom ||
          new Date(r.at) >= new Date(data.dateFrom + "T00:00:00+08:00")) &&
        (!data.dateTo ||
          new Date(r.at) <
            new Date(
              new Date(data.dateTo + "T00:00:00+08:00").getTime() + 86400000,
            )),
    )
    .sort(
      (a, b) =>
        String(b.at).localeCompare(String(a.at)) ||
        String(b.id).localeCompare(String(a.id)),
    );
  const summary: any[] = [];
  if (!refunds)
    for (const r of rows) {
      let item = summary.find((x) => x.channel === r.channel);
      if (!item) {
        item = {
          channel: r.channel,
          unit: r.unit,
          count: 0,
          incoming: 0,
          outgoing: 0,
        };
        summary.push(item);
      }
      item.count++;
      if (!["FREEZE", "UNFREEZE"].includes(r.status)) {
        item.incoming += Math.max(0, r.amount);
        item.outgoing += Math.max(0, -r.amount);
      }
    }
  const start = data.cursor
      ? Math.max(0, rows.findIndex((x) => x.id === data.cursor) + 1)
      : 0,
    size = Math.min(100, Math.max(1, Number(data.pageSize) || 20)),
    items = rows.slice(start, start + size);
  return {
    handled: true,
    value: ok({
      items,
      total: rows.length,
      summary,
      nextCursor:
        start + size < rows.length ? items[items.length - 1].id : null,
    }),
  };
}
